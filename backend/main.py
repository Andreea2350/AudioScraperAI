"""
Backend AudioScraperAI: scoate text din pagini web sau din fisiere (PDF, EPUB, DOCX...),
face sinteza vocala (TTS), salveaza in Supabase si emite JWT in functie de rol.

La fiecare carte tinem minte cine a creat-o (created_by_email) si daca e vizibila in
catalogul public (is_public), ca sa separem biblioteca personala de ce apare pe landing.

Textele foarte lungi nu trec dintr-o data prin Gemini: modulul long_text_pipeline le sparge,
le curata bucata cu bucata, apoi le citeste la fel cu TTS si le lipeste intr-un singur MP3.
"""
import io
import sys

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
import requests
from bs4 import BeautifulSoup
import os
from dotenv import load_dotenv
import google.generativeai as genai
from supabase import create_client, Client
import time
import bcrypt as bcrypt_lib
from jose import JWTError, jwt
from datetime import datetime, timedelta, timezone

try:
    # Ruleaza din folderul backend (ex. `python __main__.py`).
    from long_text_pipeline import (
        MIN_FINAL_MP3_BYTES,
        curata_text_cu_gemini,
        synthesize_ro_to_mp3_path,
    )
except ModuleNotFoundError:
    # Import de pachet (ex. Vercel: `from backend.main import app`).
    from backend.long_text_pipeline import (
        MIN_FINAL_MP3_BYTES,
        curata_text_cu_gemini,
        synthesize_ro_to_mp3_path,
    )


# Citeste variabile din fisierul .env (chei API, URL Supabase, secret JWT etc.).
load_dotenv()

# Pe Windows consola foloseste des cp1252; fortam UTF-8 pe stdout/stderr ca sa nu pice
# la print sau la loguri cand apar caractere speciale romanesti.
if sys.platform == "win32":
    for _stream in (sys.stdout, sys.stderr):
        try:
            if _stream is not None and hasattr(_stream, "reconfigure"):
                _stream.reconfigure(encoding="utf-8", errors="replace")
        except (OSError, ValueError, AttributeError):
            pass

_gemini_key = os.getenv("GEMINI_API_KEY")
if _gemini_key:
    genai.configure(api_key=_gemini_key)
model = genai.GenerativeModel("gemini-2.5-flash") if _gemini_key else None

# Client Supabase creat la prima folosire: asa poti deschide proiectul in IDE chiar daca .env
# nu e complet, fara sa crape importul la pornire.
_supabase_client: Client | None = None
_carti_has_user_id: bool | None = None


def get_supabase() -> Client:
    global _supabase_client
    if _supabase_client is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_KEY")
        if not url or not key:
            raise HTTPException(
                status_code=503,
                detail="Lipsesc SUPABASE_URL sau SUPABASE_KEY. Copiaza backend/.env.example in backend/.env si completeaza valorile.",
            )
        _supabase_client = create_client(url, key)
    return _supabase_client


def has_carti_user_id_column() -> bool:
    """
    Detecteaza o singura data daca schema curenta are `carti.user_id`.
    Permite fallback pe proiecte unde migrarea inca nu a fost aplicata.
    """
    global _carti_has_user_id
    if _carti_has_user_id is not None:
        return _carti_has_user_id
    try:
        get_supabase().table("carti").select("user_id").limit(1).execute()
        _carti_has_user_id = True
    except Exception as e:
        msg = str(e)
        if "column carti.user_id does not exist" in msg or "42703" in msg:
            _carti_has_user_id = False
        else:
            raise
    return _carti_has_user_id

# ── Auth config ──────────────────────────────────────────────────────────────
SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-schimba-in-productie")
ALGORITHM = "HS256"
TOKEN_EXPIRE_ORE = 24
# Pentru POST /register: trebuie sa coincida cu ce trimite clientul; altfel refuzam crearea contului.
ADMIN_KEY = os.getenv("ADMIN_KEY", "")

app = FastAPI(title="Motor AI Audiobooks", version="1.0")

# Origini implicite (dev) + optional CORS_EXTRA_ORIGINS (ex. domeniu productie sau apel direct la API).
_cors_default = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:3002",
]
_cors_extra = os.getenv("CORS_EXTRA_ORIGINS", "").strip()
_cors_origins = list(_cors_default)
if _cors_extra:
    _cors_origins.extend(p.strip() for p in _cors_extra.split(",") if p.strip())

# Browserul (Next.js) ruleaza pe alt port decat API-ul; CORS permite apeluri cu cookie/credentiale.
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── JWT si verificari de drepturi (folosite cu Depends pe rutele protejate) ───
def decode_token_safe(token: str) -> dict | None:
    """Incearca sa citeasca payload-ul JWT; la semnatura gresita sau expirat returneaza None, fara exceptie."""
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None


async def get_current_user_optional(
    authorization: str | None = Header(None),
) -> dict | None:
    """La fel ca get_current_user, dar optional: lipseste header-ul sau token invalid => None (rute publice cu bonus daca esti logat)."""
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    return decode_token_safe(authorization[7:].strip())


async def get_current_user(
    authorization: str | None = Header(None),
) -> dict:
    """Cere neaparat Bearer token valid; altfel 401. Folosit la istoric, publicare, stergere, redenumire."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Autentificare necesară.")
    payload = decode_token_safe(authorization[7:].strip())
    if not payload:
        raise HTTPException(status_code=401, detail="Token invalid sau expirat.")
    return payload


def proprietar_din_jwt(user: dict | None) -> str | None:
    """
    Intoarce stringul care trebuie sa coincida cu created_by_email pe randul din tabelul carti.

    Oaspete fara cont: in JWT sub e 'guest', deci toate cartile anonime se grupeaza la fel.
    Oaspete cu email sau user normal: folosim emailul din sub, mereu lower case, ca sa se potriveasca
    cu ce a scris scriptul assign_books_to_user si cu filtrul din GET /istoric.
    """
    if not user:
        return None
    sub = (user.get("sub") or "").strip()
    if user.get("rol") == "guest":
        if not sub or sub == "guest":
            return "guest"
        return sub.lower()
    return sub.lower() if sub else None


def user_id_din_jwt(user: dict | None) -> int | None:
    """Extrage id-ul numeric al utilizatorului din token-ul backend (tabel utilizatori)."""
    if not user:
        return None
    raw = user.get("id")
    try:
        uid = int(raw)
    except (TypeError, ValueError):
        return None
    return uid if uid > 0 else None


def campuri_proprietar_nou(user: dict | None) -> dict:
    """La insert carte noua: seteaza proprietarul (user_id + email fallback) si lasa cartea nepublicata."""
    base = {
        "created_by_email": proprietar_din_jwt(user),
        "is_public": False,
    }
    if has_carti_user_id_column():
        base["user_id"] = user_id_din_jwt(user)
    return base


def _email_proprietar_db(val: str | None) -> str | None:
    """Normalizeaza ce vine din baza (uneori email cu alt caz decat in token) la acelasi format ca in JWT."""
    if val is None:
        return None
    s = str(val).strip()
    return s.lower() if s else None


def assert_poate_edita_cartea(user: dict, carte: dict) -> None:
    """Admin poate tot. Restul doar pe cartile care au acelasi user_id (fallback: created_by_email pentru randuri legacy)."""
    rol = user.get("rol")
    if rol == "admin":
        return
    owner_id = user_id_din_jwt(user)
    carte_user_id = carte.get("user_id")
    try:
        carte_user_id_int = int(carte_user_id) if carte_user_id is not None else None
    except (TypeError, ValueError):
        carte_user_id_int = None
    if owner_id is not None and carte_user_id_int is not None:
        if carte_user_id_int != owner_id:
            raise HTTPException(status_code=403, detail="Nu poți edita cartea altui utilizator.")
        return
    owner = proprietar_din_jwt(user)
    created = _email_proprietar_db(carte.get("created_by_email"))
    if created is None:
        raise HTTPException(
            status_code=403,
            detail="Cartea nu are proprietar inregistrat; doar administratorul poate edita.",
        )
    if created != owner:
        raise HTTPException(status_code=403, detail="Nu poți edita cartea altui utilizator.")


def assert_poate_seta_public(user: dict, carte: dict) -> None:
    """Oaspetii nu pot bifa public. Userul doar la cartile lui. Admin la orice carte."""
    rol = user.get("rol")
    if rol == "guest":
        raise HTTPException(status_code=403, detail="Oaspeții nu pot publica cărți în catalog.")
    if rol == "admin":
        return
    owner_id = user_id_din_jwt(user)
    carte_user_id = carte.get("user_id")
    try:
        carte_user_id_int = int(carte_user_id) if carte_user_id is not None else None
    except (TypeError, ValueError):
        carte_user_id_int = None
    if owner_id is not None and carte_user_id_int is not None:
        if carte_user_id_int != owner_id:
            raise HTTPException(status_code=403, detail="Nu poți modifica vizibilitatea cărții altcuiva.")
        return
    owner = proprietar_din_jwt(user)
    created = _email_proprietar_db(carte.get("created_by_email"))
    if created is None:
        raise HTTPException(status_code=403, detail="Doar administratorul poate publica această carte.")
    if created != owner:
        raise HTTPException(status_code=403, detail="Nu poți modifica vizibilitatea cărții altcuiva.")


async def incarca_cartea_dupa_id(carte_id: int) -> dict:
    """Select pe carti dupa id; daca nu exista randul, HTTP 404 (folosit inainte de patch/delete)."""
    raspuns = get_supabase().table("carti").select("*").eq("id", carte_id).limit(1).execute()
    if not raspuns.data:
        raise HTTPException(status_code=404, detail="Cartea nu există.")
    return raspuns.data[0]


def sterge_carte_si_fisier(carte_id: int, audio_link: str | None, user: dict | None = None) -> None:
    """Scoate fisierul din bucket-ul audio-books (dupa nume din URL), apoi sterge randul din tabelul carti."""
    if audio_link:
        nume_fisier = audio_link.split("/")[-1]
        try:
            get_supabase().storage.from_("audio-books").remove([nume_fisier])
        except Exception:
            pass
    q = get_supabase().table("carti").delete().eq("id", carte_id)
    if user and user.get("rol") != "admin":
        owner_id = user_id_din_jwt(user)
        if owner_id is not None and has_carti_user_id_column():
            q = q.eq("user_id", owner_id)
        else:
            owner = proprietar_din_jwt(user)
            if owner is not None:
                q = q.eq("created_by_email", owner)
    q.execute()


# --- Modele Pydantic pentru body JSON pe rute POST/PATCH/PUT ---


class CerereExtragere(BaseModel):
    url: str = Field(..., min_length=1, max_length=8000)
    # Daca e True, ignora cache-ul din DB si regenereaza text + audio chiar daca URL-ul exista deja.
    force_regenerate: bool = False

    @field_validator("url", mode="before")
    @classmethod
    def strip_url(cls, v: object) -> object:
        return v.strip() if isinstance(v, str) else v

class TextLiberRequest(BaseModel):
    """Body pentru /genereaza_text: titlu scurt + text oarecat de lung (TTS il sparge intern daca trebuie)."""
    titlu: str = Field(..., min_length=1, max_length=500)
    text: str = Field(..., min_length=1)

    @field_validator("titlu", "text", mode="before")
    @classmethod
    def strip_spatii(cls, v: object) -> object:
        return v.strip() if isinstance(v, str) else v

@app.get("/")
async def salut_licenta():
    """Raspuns trivial ca sa verifici din browser sau din monitor ca procesul asculta."""
    return {"mesaj": "Salut! Serverul functioneaza.", "status": "Activ"}

@app.post("/extrage")
async def extrage_text(
    cerere: CerereExtragere,
    user: dict = Depends(get_current_user),
):
    try:
        # Reutilizam doar in biblioteca utilizatorului curent; nu partajam cache intre utilizatori diferiti.
        q = get_supabase().table("carti").select("*").eq("url", cerere.url)
        if user.get("rol") != "admin":
            owner_id = user_id_din_jwt(user)
            if owner_id is not None and has_carti_user_id_column():
                q = q.eq("user_id", owner_id)
            else:
                owner = proprietar_din_jwt(user)
                if owner is not None:
                    q = q.eq("created_by_email", owner)
        raspuns_db = q.limit(1).execute()
        cartea_exista = len(raspuns_db.data) > 0

        if cartea_exista and not cerere.force_regenerate:
            print("Cartea a fost gasita in memorie! Se returneaza instant.")
            carte_gasita = raspuns_db.data[0]

            return {
                "status": "Succes (Din Memorie). Daca textul a fost actualizat pe site, bifati 'force_regenerate'.",
                "id": carte_gasita["id"],
                "titlu": carte_gasita.get("titlu"),
                "is_public": bool(carte_gasita.get("is_public")),
                "lungime_text_curatat_ai": len(carte_gasita["text_curatat"]),
                "link_ascultare": carte_gasita["audio_link"],
                "text_final_audio": carte_gasita["text_curatat"],
            }

        if model is None:
            raise HTTPException(
                status_code=503,
                detail="Lipseste GEMINI_API_KEY in .env (necesar pentru curatarea textului cu AI).",
            )

        # De aici in jos: URL nou sau utilizatorul a cerut regenerare fortata.
        if cerere.force_regenerate and cartea_exista:
            print(f"Utilizatorul a fortat regenerarea! Rescriem datele pentru: {cerere.url}")
        else:
            print(f"Link nou detectat. Se incepe procesarea: {cerere.url}")

        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
        response = requests.get(cerere.url, headers=headers)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, 'html.parser')

        titlu_pagina = soup.title.string.strip() if soup.title and soup.title.string else "Articol Web"

        # Scoatem blocuri care nu sunt continut de citit (meniuri, scripturi) ca sa nu umplem contextul AI.
        for element_inutil in soup(["script", "style", "header", "footer", "nav", "aside"]):
            element_inutil.extract()

        text_brut = soup.get_text(separator=' ', strip=True)

        # Curatare cu Gemini pe bucati (limita de iesire per apel), apoi un singur lant TTS -> un MP3.
        text_curat_ai = curata_text_cu_gemini(model, text_brut)

        # Titlul frumos: doar inceputul textului brut, ca apelul sa fie rapid; fallback la <title> HTML.
        prompt_titlu = f"""
        Citeste inceputul acestui text si extrage DOAR titlul principal al cartii sau articolului.
        Nu include numele autorului, numele site-ului sau alte texte (precum "Cărți pe care le puteți citi...").
        Returneaza STRICT titlul, fara ghilimele si fara alte explicatii.
        
        Text:
        {text_brut[:2000]}
        """
        try:
            raspuns_ai_titlu = model.generate_content(prompt_titlu)
            try:
                titlu_ai_curat = (raspuns_ai_titlu.text or "").strip()
            except Exception:
                titlu_ai_curat = ""
            if not titlu_ai_curat:
                titlu_ai_curat = titlu_pagina
        except Exception:
            titlu_ai_curat = titlu_pagina

        # Uneori modelul pune ghilimele in jurul titlului; le scoatem si limitam lungimea pentru DB.
        titlu_ai_curat = titlu_ai_curat.replace('"', '').replace('„', '').replace('”', '')[:300]

        try:
            temp_mp3 = synthesize_ro_to_mp3_path(text_curat_ai)
        except RuntimeError as e:
            raise HTTPException(
                status_code=503,
                detail=str(e),
            ) from e

        nume_fisier_cloud = f"carte_{int(time.time())}.mp3"

        try:
            # Citim fisierul intreg in memorie inainte de upload (read complet evita bug-uri cu handle pe Windows).
            with open(temp_mp3, "rb") as fisier_audio:
                blob_audio = fisier_audio.read()
            if len(blob_audio) < MIN_FINAL_MP3_BYTES:
                raise HTTPException(
                    status_code=503,
                    detail=f"Audio generat prea mic ({len(blob_audio)} B); încărcarea a fost oprită.",
                )
            try:
                get_supabase().storage.from_("audio-books").upload(
                    nume_fisier_cloud,
                    blob_audio,
                    file_options={"content-type": "audio/mpeg"},
                )
            except Exception as e:
                raise HTTPException(
                    status_code=503,
                    detail=f"Încărcare audio în Supabase eșuată: {e}",
                ) from e
        finally:
            if os.path.exists(temp_mp3):
                os.remove(temp_mp3)

        link_public = get_supabase().storage.from_("audio-books").get_public_url(nume_fisier_cloud)

        date_carte = {
            "titlu": titlu_ai_curat,
            "url": cerere.url,
            "text_curatat": text_curat_ai,
            "audio_link": link_public,
        }

        if cartea_exista:
            id_vechi = raspuns_db.data[0]["id"]
            get_supabase().table("carti").update(date_carte).eq("id", id_vechi).execute()
            id_nou = id_vechi
        else:
            rand = {**date_carte, **campuri_proprietar_nou(user)}
            ins = get_supabase().table("carti").insert(rand).execute()
            id_nou = ins.data[0]["id"] if ins.data else None

        return {
            "status": "Succes, cartea a fost generata si salvata in Cloud!",
            "id": id_nou,
            "titlu": titlu_ai_curat,
            "is_public": False,
            "lungime_text_curatat_ai": len(text_curat_ai),
            "link_audio": link_public,
            "text_final_audio": text_curat_ai,
        }

    except HTTPException:
        raise
    except Exception as eroare:
        return {"status": "Eroare", "detalii": str(eroare)}

@app.post("/genereaza_text")
async def genereaza_din_text(
    req: TextLiberRequest,
    user: dict = Depends(get_current_user),
):
    nume_fisier = f"carte_text_{int(time.time())}.mp3"
    temp_mp3: str | None = None
    try:
        try:
            temp_mp3 = synthesize_ro_to_mp3_path(req.text)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e
        except RuntimeError as e:
            raise HTTPException(status_code=503, detail=str(e)) from e

        # Citim tot fisierul dintr-o data (mai sigur pe Windows decat citiri partiale pe acelasi handle).
        with open(temp_mp3, "rb") as f:
            blob_audio = f.read()
        if len(blob_audio) < MIN_FINAL_MP3_BYTES:
            raise HTTPException(
                status_code=503,
                detail=f"Fișierul audio generat e prea mic ({len(blob_audio)} B); generarea a eșuat înainte de încărcare.",
            )
        try:
            get_supabase().storage.from_("audio-books").upload(
                nume_fisier,
                blob_audio,
                file_options={"content-type": "audio/mpeg"},
            )
        except Exception as e:
            raise HTTPException(
                status_code=503,
                detail=f"Încărcare audio în Supabase eșuată: {e}",
            ) from e

        link_public = get_supabase().storage.from_("audio-books").get_public_url(nume_fisier)

        rand_carti = {
            "titlu": req.titlu,
            "url": "Text Adăugat Manual",
            "text_curatat": req.text,
            "audio_link": link_public,
            **campuri_proprietar_nou(user),
        }
        ins = get_supabase().table("carti").insert(rand_carti).execute()
        id_nou = ins.data[0]["id"] if ins.data else None

        return {
            "status": "Succes (Generare Directă)",
            "id": id_nou,
            "titlu": req.titlu,
            "is_public": False,
            "link_audio": link_public,
            "text_final_audio": req.text,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"Eroare la generarea textului liber: {e}")
        return {"status": "error", "message": str(e)}
    finally:
        if temp_mp3 and os.path.isfile(temp_mp3):
            try:
                os.remove(temp_mp3)
            except OSError:
                pass


# Limita de marime pentru upload la /extrage_fisier (evita incarcare RAM excesiva).
MAX_UPLOAD_BYTES = 15 * 1024 * 1024


@app.post("/extrage_fisier")
async def extrage_fisier(file: UploadFile = File(...)):
    """
    Upload unic: detecteaza tipul dupa extensie / content-type si intoarce text simplu + titlu sugerat.
    PDF: pypdf. EPUB: ebooklib + BeautifulSoup pe HTML-ul din interior. DOCX: python-docx.
    Imagini: Gemini vision daca e setata cheia.
    """
    try:
        raw = await file.read()
        # Tot continutul e in memorie odata; de aceea plafonam marimea.
        if len(raw) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Fișier prea mare (maxim 15 MB).")

        name = (file.filename or "document").lower()
        ctype = (file.content_type or "").lower()

        if name.endswith(".doc") and not name.endswith(".docx"):
            raise HTTPException(
                status_code=400,
                detail="Formatul .doc vechi nu este suportat. Salvați documentul ca DOCX.",
            )

        text = ""

        if name.endswith(".txt") or ctype == "text/plain":
            text = raw.decode("utf-8", errors="replace")
        elif name.endswith(".pdf") or ctype == "application/pdf":
            # Unele pagini PDF nu dau text in modul default; incercam si layout ca fallback.
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(raw))
            parts: list[str] = []
            for page in reader.pages:
                t = page.extract_text() or ""
                if not (t and str(t).strip()):
                    t = page.extract_text(extraction_mode="layout") or ""
                parts.append(t)
            text = "\n".join(parts)
        elif name.endswith(".epub") or ctype in ("application/epub+zip", "application/x-epub+zip"):
            import ebooklib
            from ebooklib import epub

            book = epub.read_epub(io.BytesIO(raw))
            html_parts: list[str] = []
            for item in book.get_items():
                if item.get_type() == ebooklib.ITEM_DOCUMENT:
                    try:
                        # Preferam bytes-ii din arhiva; get_content() reconstruieste XHTML prin lxml si pe Windows
                        # au fost cazuri cu encoding stricat. BeautifulSoup pe brut e mai tolerant.
                        raw_doc = getattr(item, "content", None)
                        if raw_doc is None or (
                            isinstance(raw_doc, (bytes, bytearray)) and len(raw_doc) == 0
                        ):
                            raw_doc = item.get_content()
                        if raw_doc is None or (
                            isinstance(raw_doc, (bytes, bytearray)) and len(raw_doc) == 0
                        ):
                            continue
                        soup = BeautifulSoup(raw_doc, "html.parser")
                        html_parts.append(soup.get_text(separator="\n", strip=True))
                    except Exception:
                        continue
            text = "\n\n".join(html_parts)
        elif name.endswith(".docx") or "wordprocessingml" in ctype:
            from docx import Document

            doc = Document(io.BytesIO(raw))
            text = "\n".join(p.text for p in doc.paragraphs)
        elif name.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif")) or ctype.startswith("image/"):
            if model is None:
                raise HTTPException(
                    status_code=503,
                    detail="Lipsește GEMINI_API_KEY pentru extragerea textului din imagini.",
                )
            from PIL import Image

            img = Image.open(io.BytesIO(raw))
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
            prompt = (
                "Extrage tot textul vizibil din această imagine. "
                "Returnează doar textul extras, fără comentarii sau introduceri."
            )
            raspuns = model.generate_content([prompt, img])
            text = (raspuns.text or "").strip()
        else:
            raise HTTPException(
                status_code=400,
                detail="Format nesuportat. Folosiți PDF, EPUB, DOCX, TXT sau imagini (PNG, JPG, WEBP).",
            )

        if not text or not str(text).strip():
            raise HTTPException(
                status_code=422,
                detail="Nu s-a putut extrage text din fișier (conținut gol sau scanat fără text).",
            )

        base_name = file.filename or "Document"
        titlu_sugerat = (base_name.rsplit(".", 1)[0] if "." in base_name else base_name)[:200]

        return {
            "status": "success",
            "text": str(text).strip(),
            "titlu_sugerat": titlu_sugerat,
        }
    except HTTPException:
        raise
    except UnicodeEncodeError as e:
        raise HTTPException(
            status_code=500,
            detail=(
                "Eroare de codare pe Windows (ex. litere românești). "
                "Repornește backend-ul sau setează PYTHONUTF8=1 pentru consolă UTF-8."
            ),
        ) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/istoric")
async def get_istoric(user: dict = Depends(get_current_user)):
    """
    Biblioteca personalizata: admin vede tot, ceilalti doar randurile unde created_by_email se potriveste
    cu ce scoatem din JWT (ilike cu escape pentru % si _ in PostgREST).
    """
    try:
        rol = user.get("rol")
        q = get_supabase().table("carti").select("*")
        if rol != "admin":
            owner_id = user_id_din_jwt(user)
            if owner_id is not None and has_carti_user_id_column():
                q = q.eq("user_id", owner_id)
            else:
                owner = proprietar_din_jwt(user)
                if owner is not None:
                    q = q.eq("created_by_email", owner)
        response = q.order("creat_la", desc=True).execute()

        return {"status": "success", "data": response.data}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Eroare la preluarea istoricului din Supabase: {e}")
        return {"status": "error", "message": str(e)}


class CerereRedenumire(BaseModel):
    titlu_nou: str


class SetarePublicBody(BaseModel):
    is_public: bool


@app.get("/carti/publice")
async def lista_carti_publice():
    """Fara login: lista cartilor bifate public, ordonate desc dupa data crearii (pagina de start / intro)."""
    try:
        response = (
            get_supabase()
            .table("carti")
            .select("id,titlu,url,audio_link,creat_la,text_curatat")
            .eq("is_public", True)
            .order("creat_la", desc=True)
            .execute()
        )
        return {"status": "success", "data": response.data or []}
    except Exception as e:
        print(f"Eroare carti publice: {e}")
        return {"status": "error", "message": str(e)}


@app.patch("/carti/{carte_id}/public")
async def seteaza_public(
    carte_id: int,
    body: SetarePublicBody,
    user: dict = Depends(get_current_user),
):
    """PATCH is_public: verifica mai intai assert_poate_seta_public, apoi update pe randul respectiv."""
    carte = await incarca_cartea_dupa_id(carte_id)
    assert_poate_seta_public(user, carte)
    get_supabase().table("carti").update({"is_public": body.is_public}).eq("id", carte_id).execute()
    return {"status": "success", "is_public": body.is_public}


@app.delete("/admin/carti-publice/{carte_id}")
async def admin_sterge_carte_publica(carte_id: int, user: dict = Depends(get_current_user)):
    """
    Moderare: sterge cartea din DB si MP3-ul din storage. Cere rol admin; cartea trebuia sa fie deja publica.
    """
    if user.get("rol") != "admin":
        raise HTTPException(status_code=403, detail="Doar administratorul poate șterge din catalogul public.")
    carte = await incarca_cartea_dupa_id(carte_id)
    if not carte.get("is_public"):
        raise HTTPException(status_code=400, detail="Cartea nu este marcată ca publică.")
    sterge_carte_si_fisier(carte_id, carte.get("audio_link"), user=user)
    return {"status": "success", "mesaj": "Cartea a fost ștearsă."}


@app.put("/redenumeste/{carte_id}")
async def redenumeste_carte(
    carte_id: int,
    cerere: CerereRedenumire,
    user: dict = Depends(get_current_user),
):
    """Update campul titlu dupa verificare assert_poate_edita_cartea."""
    try:
        carte = await incarca_cartea_dupa_id(carte_id)
        assert_poate_edita_cartea(user, carte)
        get_supabase().table("carti").update({"titlu": cerere.titlu_nou}).eq("id", carte_id).execute()
        return {"status": "success", "mesaj": "Titlu actualizat"}
    except HTTPException:
        raise
    except Exception as e:
        return {"status": "error", "mesaj": str(e)}


@app.delete("/sterge/{carte_id}")
async def sterge_carte(carte_id: int, user: dict = Depends(get_current_user)):
    """Sterge randul si fisierul audio daca utilizatorul are drept pe acea carte (sau e admin)."""
    try:
        carte = await incarca_cartea_dupa_id(carte_id)
        assert_poate_edita_cartea(user, carte)
        sterge_carte_si_fisier(carte_id, carte.get("audio_link"), user=user)
        return {"status": "success", "mesaj": "Carte și fișier șterse"}
    except HTTPException:
        raise
    except Exception as e:
        return {"status": "error", "mesaj": str(e)}


# --- Parole (bcrypt) si fabricare JWT ---



def hash_parola(parola: str) -> str:
    return bcrypt_lib.hashpw(parola.encode("utf-8"), bcrypt_lib.gensalt()).decode("utf-8")

def verifica_parola(parola: str, parola_hash: str) -> bool:
    return bcrypt_lib.checkpw(parola.encode("utf-8"), parola_hash.encode("utf-8"))

def creeaza_token(email: str, rol: str, user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_ORE)
    sub = email if email == "guest" else (email or "").strip().lower()
    payload = {"sub": sub, "rol": rol, "id": user_id, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def decodifica_token(token: str) -> dict:
    """Wrapper peste jwt.decode: orice problema de semnatura / expirare => 401 uniform."""
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Token invalid sau expirat.")


# --- Body-uri pentru login, register, verificare token ---

class CerereLogin(BaseModel):
    email: str = ""
    parola: str = ""
    rol: str  # admin | user | guest

class CerereInregistrare(BaseModel):
    email: str
    parola: str
    rol: str
    cheie_admin: str

class CerereVerificareToken(BaseModel):
    token: str


@app.post("/login")
async def login(cerere: CerereLogin):
    """
    Verifica utilizatorul in tabelul utilizatori (sau emite token de oaspete anonim fara rand in DB).
    Token-ul expira dupa TOKEN_EXPIRE_ORE; payload contine sub, rol, id.

    Schema Supabase tipica: utilizatori (id, email unique, parola_hash, rol, creat_la).
    """
    if cerere.rol not in ("admin", "user", "guest"):
        raise HTTPException(status_code=400, detail="Rol invalid. Folosiți: admin, user sau guest.")

    email_trim = (cerere.email or "").strip()
    parola_trim = (cerere.parola or "").strip()

    # Flux "continua fara cont": nu cautam nimic in DB, doar generam JWT cu sub=guest.
    if cerere.rol == "guest" and not email_trim and not parola_trim:
        token = creeaza_token("guest", "guest", 0)
        return {
            "status": "success",
            "token": token,
            "rol": "guest",
            "email": "",
        }

    if cerere.rol == "guest" and (not email_trim or not parola_trim):
        raise HTTPException(
            status_code=400,
            detail="Pentru cont oaspete cu email, completați ambele câmpuri. Sau folosiți „Continuă fără cont”.",
        )

    if cerere.rol != "guest" and (not email_trim or not parola_trim):
        raise HTTPException(status_code=400, detail="Email și parola sunt obligatorii.")

    try:
        # ilike + escape: email case-insensitive si fara ca % din input sa sparga pattern-ul.
        rezultat = (
            get_supabase().table("utilizatori")
            .select("*")
            .ilike("email", email_trim.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_"))
            .eq("rol", cerere.rol)
            .execute()
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Eroare baza de date: {str(e)}")

    if not rezultat.data:
        raise HTTPException(status_code=401, detail="Email, parolă sau rol incorect.")

    utilizator = rezultat.data[0]

    if not verifica_parola(parola_trim, utilizator["parola_hash"]):
        raise HTTPException(status_code=401, detail="Email, parolă sau rol incorect.")

    email_db = (utilizator.get("email") or "").strip().lower()
    token = creeaza_token(email_db, utilizator["rol"], utilizator["id"])

    return {
        "status": "success",
        "token": token,
        "rol": utilizator["rol"],
        "email": email_db,
    }


@app.post("/register")
async def inregistreaza_utilizator(cerere: CerereInregistrare):
    """
    Inserare in utilizatori cu parola hash-uita. Doar daca cheie_admin == ADMIN_KEY din mediu.
    Folosit din frontend la ecranul de inregistrare (sau manual la setup).
    """
    if not ADMIN_KEY or cerere.cheie_admin != ADMIN_KEY:
        raise HTTPException(status_code=403, detail="Cheie admin invalidă.")

    if cerere.rol not in ("admin", "user", "guest"):
        raise HTTPException(status_code=400, detail="Rol invalid. Folosiți: admin, user sau guest.")

    email_norm = (cerere.email or "").strip().lower()
    if not email_norm:
        raise HTTPException(status_code=400, detail="Email invalid.")

    try:
        existent = (
            get_supabase().table("utilizatori").select("id").ilike("email", email_norm).execute()
        )
        if existent.data:
            raise HTTPException(status_code=409, detail="Emailul este deja înregistrat.")

        get_supabase().table("utilizatori").insert({
            "email": email_norm,
            "parola_hash": hash_parola(cerere.parola),
            "rol": cerere.rol,
        }).execute()

        return {
            "status": "success",
            "mesaj": f"Utilizatorul '{email_norm}' cu rolul '{cerere.rol}' a fost creat.",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/verifica-token")
async def verifica_token(cerere: CerereVerificareToken):
    """Decodeaza token-ul (ridica 401 daca e invalid) si intoarce campurile utile pentru client."""
    payload = decodifica_token(cerere.token)
    return {
        "status": "valid",
        "email": payload.get("sub"),
        "rol": payload.get("rol"),
        "id": payload.get("id"),
    }