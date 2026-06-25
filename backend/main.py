"""
Asta e fisierul principal al backend-ului. Aici stau toate rutele API: scot text din pagini web sau din
fisiere (PDF, EPUB, DOCX, TXT, imagini), trec textul prin curatare AI + sinteza vocala (TTS),
salvez rezultatul in Supabase si gestionez autentificarea cu JWT in functie de rol.

Fiecare carte tine minte cine a creat-o (prin user_id / created_by_email / guest_session_id),
ca sa pot afisa fiecarui utilizator doar biblioteca lui.

Textele lungi nu trec dintr-o data prin Gemini: modulul long_text_pipeline le sparge in bucati,
le curata pe rand, le citeste cu TTS si le lipeste intr-un singur MP3.
"""

# Importuri din biblioteca standard si din pachete externe (FastAPI, Supabase, Gemini, JWT etc.).
import asyncio
import io
import sys

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field, field_validator
import requests
from bs4 import BeautifulSoup
import os
import json
import queue
import threading
from dotenv import load_dotenv
import google.generativeai as genai
from supabase import create_client, Client
import time
import bcrypt as bcrypt_lib
from jose import JWTError, jwt
from datetime import datetime, timedelta, timezone

# Importurile modulelor mele au doua variante: cand rulez local din folderul backend modulul e
# "long_text_pipeline", iar cand rulez ca pachet (Vercel) e "backend.long_text_pipeline".
# Incerc intai varianta locala; daca nu o gaseste, cad pe varianta de pachet.
try:
    # Varianta cand rulez din folderul backend (ex. `python __main__.py`).
    from long_text_pipeline import (
        MIN_FINAL_MP3_BYTES,
        TtsSegmentResult,
        curata_text_cu_gemini,
        resolve_summary_output_language,
        rezuma_text_cu_gemini,
        synthesize_ro_to_mp3_path,
    )
    from guest_credits import (
        GUEST_CREDITS_PER_JOB,
        assert_guest_can_generate,
        deduct_guest_credits,
        ensure_guest_session,
        guest_credits_snapshot,
        guest_session_id_din_jwt,
        normalize_guest_session_id,
        probe_guest_tables,
    )
    from generation_stream import run_audio_generation
    from generation_cancel import (
        GenerationCancelled,
        GenerationJob,
        cancel_generation_job,
        create_generation_job,
        release_generation_job,
    )
    from tts_voices import (
        preview_locale_for_voice,
        resolve_voice_id,
        sample_text_for_voice,
        tts_config_from_voice_id,
        voice_catalog_for_api,
    )
    from long_text_pipeline import synthesize_preview_bytes
    from text_extraction import (
        build_extract_meta,
        decode_plain_text_bytes,
        extract_pdf_text,
        normalize_extracted_document_text,
        repair_legacy_romanian_diacritics,
    )
except ModuleNotFoundError:
    # Varianta cand sunt importat ca pachet (ex. Vercel: `from backend.main import app`).
    from backend.long_text_pipeline import (
        MIN_FINAL_MP3_BYTES,
        TtsSegmentResult,
        curata_text_cu_gemini,
        resolve_summary_output_language,
        rezuma_text_cu_gemini,
        synthesize_ro_to_mp3_path,
    )
    from backend.guest_credits import (
        GUEST_CREDITS_PER_JOB,
        assert_guest_can_generate,
        deduct_guest_credits,
        ensure_guest_session,
        guest_credits_snapshot,
        guest_session_id_din_jwt,
        normalize_guest_session_id,
        probe_guest_tables,
    )
    from backend.generation_stream import run_audio_generation
    from backend.generation_cancel import (
        GenerationCancelled,
        GenerationJob,
        cancel_generation_job,
        create_generation_job,
        release_generation_job,
    )
    from backend.tts_voices import (
        preview_locale_for_voice,
        resolve_voice_id,
        sample_text_for_voice,
        tts_config_from_voice_id,
        voice_catalog_for_api,
    )
    from backend.long_text_pipeline import synthesize_preview_bytes
    from backend.text_extraction import (
        build_extract_meta,
        decode_plain_text_bytes,
        extract_pdf_text,
        normalize_extracted_document_text,
        repair_legacy_romanian_diacritics,
    )


# Citesc variabilele din fisierul .env (chei API, URL Supabase, secret JWT etc.).
load_dotenv()

# Pe Windows consola foloseste des cp1252; fortez UTF-8 pe stdout/stderr ca sa nu crape
# la print sau la loguri cand apar caractere romanesti speciale.
if sys.platform == "win32":
    for _stream in (sys.stdout, sys.stderr):
        try:
            if _stream is not None and hasattr(_stream, "reconfigure"):
                _stream.reconfigure(encoding="utf-8", errors="replace")
        except (OSError, ValueError, AttributeError):
            pass

# Configurez Gemini doar daca am cheia. Fara ea, "model" ramane None si functiile AI sunt dezactivate.
_gemini_key = os.getenv("GEMINI_API_KEY")
if _gemini_key:
    genai.configure(api_key=_gemini_key)
model = genai.GenerativeModel("gemini-2.5-flash") if _gemini_key else None

# Clientul Supabase il creez lenes (la prima folosire), nu la pornire, ca sa nu pice importul
# daca lipsesc variabilele de mediu. Tot aici tin in cache daca schema are anumite coloane.
_supabase_client: Client | None = None
_carti_has_user_id: bool | None = None
_carti_has_guest_session: bool | None = None


def get_supabase() -> Client:
    # Intorc clientul Supabase, creandu-l prima data cand e cerut.
    global _supabase_client
    if _supabase_client is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_KEY")
        # Fara URL si cheie nu pot lucra cu baza de date -> mesaj clar de configurare.
        if not url or not key:
            raise HTTPException(
                status_code=503,
                detail="Lipsesc SUPABASE_URL sau SUPABASE_KEY. Copiaza backend/.env.example in backend/.env si completeaza valorile.",
            )
        _supabase_client = create_client(url, key)
    return _supabase_client


def has_carti_user_id_column() -> bool:
    """
    Verific o singura data daca tabelul carti are coloana user_id (rezultatul ramane in cache).
    Asta imi permite sa functionez si pe baze unde migrarea inca nu a fost aplicata.
    """
    global _carti_has_user_id
    if _carti_has_user_id is not None:
        return _carti_has_user_id
    try:
        get_supabase().table("carti").select("user_id").limit(1).execute()
        _carti_has_user_id = True
    except Exception as e:
        msg = str(e)
        # Daca eroarea spune clar ca lipseste coloana, notez asta; altfel las eroarea sa urce.
        if "column carti.user_id does not exist" in msg or "42703" in msg:
            _carti_has_user_id = False
        else:
            raise
    return _carti_has_user_id


def has_carti_guest_session_column() -> bool:
    # Acelasi tip de verificare, dar pentru coloana guest_session_id.
    global _carti_has_guest_session
    if _carti_has_guest_session is not None:
        return _carti_has_guest_session
    try:
        get_supabase().table("carti").select("guest_session_id").limit(1).execute()
        _carti_has_guest_session = True
    except Exception as e:
        msg = str(e)
        if "guest_session_id" in msg and ("does not exist" in msg or "42703" in msg):
            _carti_has_guest_session = False
        else:
            raise
    return _carti_has_guest_session


def _apply_owner_scope(q, user: dict):
    """Adaug pe interogare filtrul de proprietar: adminul vede tot, userul doar ce e al lui, oaspetele pe sesiunea lui."""
    rol = user.get("rol")
    # Adminul nu primeste niciun filtru: vede toate cartile.
    if rol == "admin":
        return q
    if rol == "guest":
        # Oaspete: filtrez pe guest_session_id daca exista coloana.
        gs = guest_session_id_din_jwt(user)
        if gs and has_carti_guest_session_column():
            return q.eq("guest_session_id", gs)
        # Fallback pentru randuri vechi: dupa created_by_email.
        owner = proprietar_din_jwt(user)
        if owner is not None:
            return q.eq("created_by_email", owner)
        return q
    # User normal: prefer filtrarea pe user_id (mai sigura), cu fallback pe email.
    owner_id = user_id_din_jwt(user)
    if owner_id is not None and has_carti_user_id_column():
        return q.eq("user_id", owner_id)
    owner = proprietar_din_jwt(user)
    if owner is not None:
        return q.eq("created_by_email", owner)
    return q

# Configurarea autentificarii: secretul de semnare JWT, algoritmul si durata de viata a token-ului.
SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-schimba-in-productie")
ALGORITHM = "HS256"
TOKEN_EXPIRE_ORE = 24

app = FastAPI(title="Motor AI Audiobooks", version="1.0")

# Frontend-ul Next.js ruleaza pe alt port decat API-ul, deci browserul cere CORS.
# Pornesc cu originile de dezvoltare si adaug optional altele din CORS_EXTRA_ORIGINS (ex. domeniul de productie).
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
    # Originile extra vin separate prin virgula; le curat si le adaug.
    _cors_origins.extend(p.strip() for p in _cors_extra.split(",") if p.strip())

# Inregistrez middleware-ul CORS: permite apeluri cu credentiale de la originile de mai sus.
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def decode_token_safe(token: str) -> dict | None:
    """Incerc sa citesc payload-ul JWT; daca semnatura e gresita sau e expirat, intorc None (fara exceptie)."""
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None


async def get_current_user_optional(
    authorization: str | None = Header(None),
) -> dict | None:
    """Ca get_current_user, dar relaxat: daca lipseste tokenul sau e invalid, intorc None (rute publice cu bonus daca esti logat)."""
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    # Scot "Bearer " din fata si decodez ce ramane.
    return decode_token_safe(authorization[7:].strip())


async def get_current_user(
    authorization: str | None = Header(None),
) -> dict:
    """Pretind un Bearer token valid; altfel 401. Folosit pe rutele protejate (istoric, stergere, redenumire)."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Autentificare necesară.")
    payload = decode_token_safe(authorization[7:].strip())
    if not payload:
        raise HTTPException(status_code=401, detail="Token invalid sau expirat.")
    return payload


def proprietar_din_jwt(user: dict | None) -> str | None:
    """
    Intorc stringul care trebuie sa coincida cu created_by_email pe randul cartii.
    Pentru oaspeti, sub e "guest", deci toate cartile anonime se grupeaza la fel.
    """
    if not user:
        return None
    if user.get("rol") == "guest":
        return "guest"
    sub = (user.get("sub") or "").strip()
    return sub.lower() if sub else None


def user_id_din_jwt(user: dict | None) -> int | None:
    """Scot id-ul numeric al utilizatorului din token (cheia din tabelul utilizatori)."""
    if not user:
        return None
    raw = user.get("id")
    try:
        uid = int(raw)
    except (TypeError, ValueError):
        return None
    # Un id <= 0 nu e valid (oaspetii au 0).
    return uid if uid > 0 else None


def campuri_proprietar_nou(user: dict | None) -> dict:
    """Cand inserez o carte noua, pregatesc campurile de proprietar (email + eventual user_id / guest_session_id)."""
    base = {
        "created_by_email": proprietar_din_jwt(user),
    }
    # Adaug user_id doar daca schema il are.
    if has_carti_user_id_column():
        base["user_id"] = user_id_din_jwt(user)
    # Adaug guest_session_id daca e oaspete si schema are coloana.
    gs = guest_session_id_din_jwt(user)
    if gs and has_carti_guest_session_column():
        base["guest_session_id"] = gs
    return base


def _email_proprietar_db(val: str | None) -> str | None:
    """Normalizez emailul venit din baza (poate avea alt caz decat in token) la acelasi format ca in JWT."""
    if val is None:
        return None
    s = str(val).strip()
    return s.lower() if s else None


def assert_poate_edita_cartea(user: dict, carte: dict) -> None:
    """Verific daca utilizatorul are dreptul sa modifice cartea. Adminul poate tot; restul doar pe cartile lor."""
    rol = user.get("rol")
    if rol == "admin":
        return
    if rol == "guest":
        # Oaspete: are drept daca guest_session_id-ul cartii coincide cu al lui.
        gs = guest_session_id_din_jwt(user)
        carte_gs = carte.get("guest_session_id")
        if gs and carte_gs and str(carte_gs) == str(gs):
            return
    # User normal: compar pe user_id daca ambele exista.
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
    # Fallback pentru randuri vechi fara user_id: compar pe email.
    owner = proprietar_din_jwt(user)
    created = _email_proprietar_db(carte.get("created_by_email"))
    if created is None:
        raise HTTPException(
            status_code=403,
            detail="Cartea nu are proprietar inregistrat; doar administratorul poate edita.",
        )
    if created != owner:
        raise HTTPException(status_code=403, detail="Nu poți edita cartea altui utilizator.")


async def incarca_cartea_dupa_id(carte_id: int) -> dict:
    """Citesc o carte dupa id; daca nu exista, 404. O folosesc inainte de patch/delete ca sa am randul la indemana."""
    raspuns = get_supabase().table("carti").select("*").eq("id", carte_id).limit(1).execute()
    if not raspuns.data:
        raise HTTPException(status_code=404, detail="Cartea nu există.")
    return raspuns.data[0]


def sterge_carte_si_fisier(carte_id: int, audio_link: str | None, user: dict | None = None) -> None:
    """Sterg intai fisierul audio din bucket (dupa numele din URL), apoi randul din tabelul carti."""
    if audio_link:
        # Numele fisierului e ultima bucata din URL.
        nume_fisier = audio_link.split("/")[-1]
        try:
            get_supabase().storage.from_("audio-books").remove([nume_fisier])
        except Exception:
            # Daca fisierul nu mai e in storage, nu opresc stergerea randului.
            pass
    q = get_supabase().table("carti").delete().eq("id", carte_id)
    # Daca nu e admin, adaug un filtru de proprietar ca sa nu poata sterge cartea altcuiva nici teoretic.
    if user and user.get("rol") != "admin":
        owner_id = user_id_din_jwt(user)
        if owner_id is not None and has_carti_user_id_column():
            q = q.eq("user_id", owner_id)
        else:
            owner = proprietar_din_jwt(user)
            if owner is not None:
                q = q.eq("created_by_email", owner)
    q.execute()


# Modelele Pydantic descriu si valideaza body-ul JSON al cererilor POST/PATCH/PUT.


class CerereExtragere(BaseModel):
    url: str = Field(..., min_length=1, max_length=8000)
    # Daca e True, ignor cache-ul din DB si regenerez text + audio chiar daca URL-ul exista deja.
    force_regenerate: bool = False
    # Vocea Edge TTS aleasa in UI (ex. ro-RO-AlinaNeural); fara fallback automat la gTTS.
    tts_voice: str | None = None

    @field_validator("url", mode="before")
    @classmethod
    def strip_url(cls, v: object) -> object:
        # Curat spatiile din URL inainte de validare.
        return v.strip() if isinstance(v, str) else v

class CerereExtragereText(BaseModel):
    """Body pentru /extrage_url_text: cer doar titlu + text brut, fara generare audio."""
    url: str = Field(..., min_length=1, max_length=8000)

    @field_validator("url", mode="before")
    @classmethod
    def strip_url(cls, v: object) -> object:
        return v.strip() if isinstance(v, str) else v


class TextLiberRequest(BaseModel):
    """Body pentru /genereaza_text: titlu scurt + text (oricat de lung, pipeline-ul il sparge intern)."""
    titlu: str = Field(..., min_length=1, max_length=500)
    text: str = Field(..., min_length=1)
    curata_cu_gemini: bool = False
    tts_voice: str | None = None
    source_label: str | None = None

    @field_validator("titlu", "text", mode="before")
    @classmethod
    def strip_spatii(cls, v: object) -> object:
        return v.strip() if isinstance(v, str) else v

    @field_validator("source_label", mode="before")
    @classmethod
    def strip_source_label(cls, v: object) -> object | None:
        # source_label e optional: string gol il transform in None.
        if v is None:
            return None
        if isinstance(v, str):
            s = v.strip()
            return s if s else None
        return v


def _sse_payload(data: dict) -> str:
    # Formatez un dict in formatul cerut de Server-Sent Events: "data: {json}\n\n".
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def _upload_mp3_bytes_retryable(nume_fisier: str, blob: bytes) -> None:
    """Urc MP3-ul in Supabase Storage, reincercand la erori tranzitorii de retea (ex. WinError 10035 pe Windows)."""
    max_attempts = 5
    last_err: Exception | None = None
    for attempt in range(max_attempts):
        try:
            get_supabase().storage.from_("audio-books").upload(
                nume_fisier,
                blob,
                file_options={"content-type": "audio/mpeg"},
            )
            return
        except Exception as e:
            last_err = e
            err_s = str(e).lower()
            # Decid daca eroarea merita reincercata (probleme temporare de retea, nu erori logice).
            retryable = (
                "10035" in str(e)
                or "winerror" in err_s
                or "timeout" in err_s
                or "timed out" in err_s
                or "connection" in err_s
                or "temporarily unavailable" in err_s
                or "reset by peer" in err_s
            )
            if attempt < max_attempts - 1 and retryable:
                # Backoff exponential, plafonat la 8 secunde.
                time.sleep(min(2**attempt, 8))
                continue
            break
    raise HTTPException(
        status_code=503,
        detail=f"Încărcare audio în Supabase eșuată: {last_err}",
    ) from last_err


def _upload_mp3_bytes(nume_fisier: str, blob: bytes) -> str:
    # Urc un MP3 si intorc URL-ul public. Intai verific ca nu e suspect de mic.
    if len(blob) < MIN_FINAL_MP3_BYTES:
        raise HTTPException(
            status_code=503,
            detail=f"Fișierul audio generat e prea mic ({len(blob)} B); generarea a eșuat înainte de încărcare.",
        )
    _upload_mp3_bytes_retryable(nume_fisier, blob)
    return get_supabase().storage.from_("audio-books").get_public_url(nume_fisier)


def _incarca_segment_mp3(seg: TtsSegmentResult, prefix: str) -> str:
    # Citesc fisierul de segment de pe disc si il urc cu un nume care include indexul segmentului.
    with open(seg.mp3_path, "rb") as f:
        blob = f.read()
    nume = f"{prefix}_seg_{seg.index}.mp3"
    return _upload_mp3_bytes(nume, blob)


def _salveaza_segmente_db(carte_id: int, segmente: list[dict]) -> None:
    # Salvez toate segmentele unei carti in tabelul carti_segmente.
    if not segmente:
        return
    # Atasez carte_id la fiecare rand de segment.
    rows = [{**s, "carte_id": carte_id} for s in segmente]
    try:
        get_supabase().table("carti_segmente").insert(rows).execute()
    except Exception as e:
        msg = str(e).lower()
        # Daca tabelul lipseste cu totul (schema veche), renunt silentios la salvarea segmentelor.
        if "carti_segmente" in msg and ("does not exist" in msg or "42p01" in msg):
            return
        # Daca lipsesc doar coloanele de capitol, reincerc fara ele.
        if "chapter_index" in msg or "chapter_title" in msg:
            slim = [
                {k: v for k, v in r.items() if k not in ("chapter_index", "chapter_title")}
                for r in rows
            ]
            get_supabase().table("carti_segmente").insert(slim).execute()
            return
        raise


def _verifica_credite_guest(user: dict, char_count: int) -> None:
    # Verific creditele inainte de generare, dar doar pentru oaspeti (userii normali sunt nelimitati).
    if user.get("rol") != "guest":
        return
    if char_count > GUEST_CREDITS_PER_JOB:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Textul depășește limita de {GUEST_CREDITS_PER_JOB} caractere per generare "
                f"(ai {char_count}). Scurtează textul sau creează cont."
            ),
        )
    gs = guest_session_id_din_jwt(user)
    if not gs:
        return
    # Doar daca tabelele de guest exista verific si creditele ramase in DB.
    if probe_guest_tables(get_supabase):
        assert_guest_can_generate(get_supabase, gs, char_count)


def _deduce_credite_guest(user: dict, char_count: int) -> dict | None:
    # Scad creditele dupa generare; pentru userii normali intorc None (nu au credite).
    if user.get("rol") != "guest":
        return None
    gs = guest_session_id_din_jwt(user)
    if not gs or not probe_guest_tables(get_supabase):
        return None
    return deduct_guest_credits(get_supabase, gs, char_count)


def _insert_carte_row(user: dict, fields: dict) -> int | None:
    # Inserez randul de carte, adaugand campurile de proprietar. Intorc id-ul nou.
    rand = {**fields, **campuri_proprietar_nou(user)}
    try:
        ins = get_supabase().table("carti").insert(rand).execute()
    except Exception as e:
        msg = str(e).lower()
        # Schema veche fara coloanele optionale: le scot si reincerc insert-ul.
        if any(k in msg for k in ("is_guest_preview", "playlist_mode", "source_char_total")):
            for k in ("is_guest_preview", "source_char_total", "playlist_mode"):
                rand.pop(k, None)
            ins = get_supabase().table("carti").insert(rand).execute()
        else:
            raise
    return ins.data[0]["id"] if ins.data else None


# Obiect-santinela folosit ca sa deosebesc "coada a expirat timeout-ul" de "coada a trimis None (final)".
_SSE_WAIT_SENTINEL = object()


def _queue_get_or_sentinel(q: queue.Queue, timeout: float):
    # Incerc sa scot un element din coada; daca expira timeout-ul, intorc santinela in loc sa arunc exceptie.
    try:
        return q.get(timeout=timeout)
    except queue.Empty:
        return _SSE_WAIT_SENTINEL


async def _async_sse_stream(
    event_queue: queue.Queue,
    job: GenerationJob,
    request: Request,
):
    """Generatorul async care trimite evenimentele catre browser. Daca clientul se deconecteaza, anuleaza jobul."""
    loop = asyncio.get_running_loop()
    while True:
        # Daca browserul a inchis conexiunea, opresc generarea (anulare cooperativa).
        if await request.is_disconnected():
            job.cancel()
            break
        # Astept un eveniment din coada, dar fara sa blochez event loop-ul (rulez get-ul intr-un executor).
        item = await loop.run_in_executor(None, _queue_get_or_sentinel, event_queue, 0.25)
        if item is _SSE_WAIT_SENTINEL:
            # N-a venit nimic in 0.25s: trimit un keepalive ca sa tin conexiunea vie.
            yield ": keepalive\n\n"
            continue
        if item is None:
            # None = semnal de final, inchei stream-ul.
            break
        yield _sse_payload(item)


def _start_sse_worker(worker_fn, user: dict, request: Request) -> StreamingResponse:
    # Pornesc un job SSE: creez coada de evenimente, jobul, si lansez munca grea intr-un thread separat.
    event_queue: queue.Queue = queue.Queue()
    job = create_generation_job(user)
    # Primul eveniment trimite job_id-ul, ca frontend-ul sa stie ce sa anuleze daca apasa Stop.
    event_queue.put({"type": "job", "job_id": job.job_id})

    def thread_worker() -> None:
        # Acest thread ruleaza pipeline-ul ca sa nu blocheze worker-ul async al serverului.
        try:
            worker_fn(event_queue, job)
        except GenerationCancelled:
            # Anulat: curat fisierele deja urcate si anunt frontend-ul.
            job.cleanup_uploads(get_supabase)
            event_queue.put({"type": "cancelled"})
        except HTTPException as e:
            # Eroare "asteptata" (cu status): o trimit ca atare.
            event_queue.put({"type": "error", "detail": e.detail, "status_code": e.status_code})
        except Exception as e:
            # Orice alta eroare: o raportez ca 500.
            event_queue.put({"type": "error", "detail": str(e), "status_code": 500})
        finally:
            # None semnaleaza finalul stream-ului; scot jobul din registru.
            event_queue.put(None)
            release_generation_job(job.job_id)

    threading.Thread(target=thread_worker, daemon=True).start()
    return StreamingResponse(
        _async_sse_stream(event_queue, job, request),
        media_type="text/event-stream",
        # X-Accel-Buffering: no impiedica proxy-urile sa buffereze stream-ul (altfel evenimentele ar veni in rafale).
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _ruleaza_generare_text(
    user: dict,
    titlu: str,
    raw_text: str,
    *,
    curata_cu_gemini: bool = False,
    source_label: str = "Text Adăugat Manual",
    event_queue: queue.Queue | None = None,
    tts_voice: str | None = None,
    job: GenerationJob | None = None,
) -> dict:
    # Punctul comun pentru toate generarile. Construiesc functiile auxiliare si le dau lui run_audio_generation.
    def emit(evt: dict) -> None:
        # Trimit un eveniment in coada SSE, daca avem una (la varianta sincrona event_queue e None).
        if event_queue is not None:
            event_queue.put(evt)

    def check_cancel() -> None:
        # Las pipeline-ul sa intrebe daca s-a cerut anulare.
        if job is not None:
            job.check()

    def upload_mp3_tracked(nume: str, blob: bytes) -> str:
        # Urc MP3-ul final si il inregistrez la job, ca sa-l pot sterge daca se anuleaza dupa upload.
        check_cancel()
        url = _upload_mp3_bytes(nume, blob)
        if job is not None:
            job.track_upload(url)
        return url

    def upload_segment_tracked(seg: TtsSegmentResult, prefix: str) -> str:
        # La fel, dar pentru segmente.
        check_cancel()
        url = _incarca_segment_mp3(seg, prefix)
        if job is not None:
            job.track_upload(url)
        return url

    # Transform vocea aleasa in UI intr-o configuratie concreta de TTS.
    tts_cfg = tts_config_from_voice_id(tts_voice)

    # Predau tot pipeline-ului: ii dau ce model AI sa foloseasca si toate functiile de upload/salvare/credite.
    return run_audio_generation(
        user=user,
        titlu=titlu,
        raw_text=raw_text,
        source_label=source_label,
        curata_cu_gemini=curata_cu_gemini,
        gemini_model=model,
        tts_config=tts_cfg,
        emit=emit,
        upload_mp3=upload_mp3_tracked,
        upload_segment=upload_segment_tracked,
        insert_carte=lambda fields: _insert_carte_row(user, fields),
        save_segments=_salveaza_segmente_db,
        verify_guest_credits=lambda n: _verifica_credite_guest(user, n),
        deduct_guest=lambda n: _deduce_credite_guest(user, n),
        check_cancel=check_cancel,
    )


@app.get("/")
async def salut_licenta():
    """Ruta de "health check": ma asigur din browser sau dintr-un monitor ca procesul asculta."""
    return {"mesaj": "Salut! Serverul functioneaza.", "status": "Activ"}


# Cache in memorie pentru previzualizarile de voce, ca sa nu regenerez acelasi MP3 demo de fiecare data.
_preview_mp3_cache: dict[str, bytes] = {}


@app.get("/tts/voices")
async def lista_voci_tts(locale: str = "ro"):
    """Intorc lista vocilor pentru dropdown-ul din UI (nume, trasatura, limba, text demo), localizate."""
    loc = "en" if locale == "en" else "ro"
    return {"status": "success", "data": voice_catalog_for_api(loc)}


@app.get("/tts/preview")
async def previzualizare_voce(voice: str = "", locale: str = "ro"):
    """Generez (si pun in cache) un MP3 scurt cu vocea aleasa, ca utilizatorul s-o auda inainte sa o aleaga."""
    vid = resolve_voice_id(voice)
    loc = preview_locale_for_voice(vid)
    # Cheia de cache combina vocea cu limba demo.
    cache_key = f"{vid}:{loc}"
    if cache_key not in _preview_mp3_cache:
        cfg = tts_config_from_voice_id(vid)
        text = sample_text_for_voice(vid, loc)
        try:
            _preview_mp3_cache[cache_key] = synthesize_preview_bytes(text, cfg)
        except Exception as e:
            raise HTTPException(status_code=503, detail=str(e)) from e
    return Response(content=_preview_mp3_cache[cache_key], media_type="audio/mpeg")


@app.post("/extrage")
async def extrage_text(
    cerere: CerereExtragere,
    user: dict = Depends(get_current_user),
):
    # Varianta veche, fara streaming: extrage din URL si intoarce un singur raspuns JSON la final.
    try:
        # Refolosesc o carte din DB doar daca e in biblioteca utilizatorului curent (nu partajez intre conturi).
        q = get_supabase().table("carti").select("*").eq("url", cerere.url)
        q = _apply_owner_scope(q, user)
        raspuns_db = q.limit(1).execute()
        cartea_exista = len(raspuns_db.data) > 0

        # Daca exista deja si nu s-a cerut regenerare, o intorc instant din "memorie".
        if cartea_exista and not cerere.force_regenerate:
            print("Cartea a fost gasita in memorie! Se returneaza instant.")
            carte_gasita = raspuns_db.data[0]

            return {
                "status": "Succes (Din Memorie). Daca textul a fost actualizat pe site, bifati 'force_regenerate'.",
                "id": carte_gasita["id"],
                "titlu": carte_gasita.get("titlu"),
                "lungime_text_curatat_ai": len(carte_gasita["text_curatat"]),
                "link_ascultare": carte_gasita["audio_link"],
                "text_final_audio": carte_gasita["text_curatat"],
            }

        # De aici am nevoie de Gemini pentru curatare; fara cheie nu pot continua.
        if model is None:
            raise HTTPException(
                status_code=503,
                detail="Lipseste GEMINI_API_KEY in .env (necesar pentru curatarea textului cu AI).",
            )

        # Ajung aici daca URL-ul e nou sau utilizatorul a cerut regenerare fortata.
        if cerere.force_regenerate and cartea_exista:
            print(f"Utilizatorul a fortat regenerarea! Rescriem datele pentru: {cerere.url}")
        else:
            print(f"Link nou detectat. Se incepe procesarea: {cerere.url}")

        # Descarc pagina; User-Agent de browser ca sa nu fiu respins de unele site-uri.
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
        response = requests.get(cerere.url, headers=headers)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, 'html.parser')

        # Titlul de rezerva: tag-ul <title> al paginii.
        titlu_pagina = soup.title.string.strip() if soup.title and soup.title.string else "Articol Web"

        # Pas 1: scot din HTML elementele inutile (scripturi, meniuri, footer) ca sa raman cu textul.
        for element_inutil in soup(["script", "style", "header", "footer", "nav", "aside"]):
            element_inutil.extract()

        text_brut = soup.get_text(separator=' ', strip=True)

        # Pas 2: curat textul cu Gemini (pe bucati, in modul).
        text_curat_ai = curata_text_cu_gemini(model, text_brut)

        # Pas 3: cer lui Gemini sa-mi dea un titlu curat din inceputul textului; daca nu reuseste, folosesc <title>.
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

        # Uneori modelul pune ghilimele in jurul titlului; le scot si limitez lungimea pentru DB.
        titlu_ai_curat = titlu_ai_curat.replace('"', '').replace('„', '').replace('”', '')[:300]

        # Pas 4: sinteza vocala -> MP3 temporar.
        try:
            tts_cfg = tts_config_from_voice_id(cerere.tts_voice)
            temp_mp3 = synthesize_ro_to_mp3_path(text_curat_ai, tts_config=tts_cfg)
        except RuntimeError as e:
            raise HTTPException(
                status_code=503,
                detail=str(e),
            ) from e

        nume_fisier_cloud = f"carte_{int(time.time())}.mp3"

        try:
            # Citesc tot fisierul in memorie inainte de upload (read complet evita bug-uri cu handle pe Windows).
            with open(temp_mp3, "rb") as fisier_audio:
                blob_audio = fisier_audio.read()
            if len(blob_audio) < MIN_FINAL_MP3_BYTES:
                raise HTTPException(
                    status_code=503,
                    detail=f"Audio generat prea mic ({len(blob_audio)} B); încărcarea a fost oprită.",
                )
            try:
                _upload_mp3_bytes_retryable(nume_fisier_cloud, blob_audio)
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(
                    status_code=503,
                    detail=f"Încărcare audio în Supabase eșuată: {e}",
                ) from e
        finally:
            # Sterg fisierul temporar indiferent daca upload-ul a reusit.
            if os.path.exists(temp_mp3):
                os.remove(temp_mp3)

        link_public = get_supabase().storage.from_("audio-books").get_public_url(nume_fisier_cloud)

        date_carte = {
            "titlu": titlu_ai_curat,
            "url": cerere.url,
            "text_curatat": text_curat_ai,
            "audio_link": link_public,
        }

        # Daca regenerez o carte existenta, fac update; altfel insert nou cu campurile de proprietar.
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
            "lungime_text_curatat_ai": len(text_curat_ai),
            "link_audio": link_public,
            "text_final_audio": text_curat_ai,
        }

    except HTTPException:
        # Erorile HTTP le las sa urce ca atare.
        raise
    except Exception as eroare:
        # Orice alta eroare o intorc intr-un format simplu de status (ruta veche, nu arunca 500).
        return {"status": "Eroare", "detalii": str(eroare)}


@app.post("/genereaza_text")
async def genereaza_din_text(
    req: TextLiberRequest,
    user: dict = Depends(get_current_user),
):
    # Generare din text liber, varianta sincrona (un singur raspuns la final, fara playlist live).
    try:
        return _ruleaza_generare_text(
            user,
            req.titlu,
            req.text,
            curata_cu_gemini=req.curata_cu_gemini,
            source_label=req.source_label or "Text Adăugat Manual",
            tts_voice=req.tts_voice,
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"Eroare la generarea textului liber: {e}")
        return {"status": "error", "message": str(e)}


@app.post("/genereaza_text/stream")
async def genereaza_din_text_stream(
    req: TextLiberRequest,
    request: Request,
    user: dict = Depends(get_current_user),
):
    """Varianta SSE: emite segmentele pe masura ce sunt sintetizate, ca sa apara playlistul in timp real."""

    def work(event_queue: queue.Queue, job: GenerationJob) -> None:
        # Munca grea care ruleaza in thread-ul SSE.
        _ruleaza_generare_text(
            user,
            req.titlu,
            req.text,
            curata_cu_gemini=req.curata_cu_gemini,
            source_label=req.source_label or "Text Adăugat Manual",
            tts_voice=req.tts_voice,
            event_queue=event_queue,
            job=job,
        )

    return _start_sse_worker(work, user, request)


@app.post("/extrage_url_text")
async def extrage_url_text(
    cerere: CerereExtragereText,
    user: dict = Depends(get_current_user),
):
    # Doar extrag textul din URL (titlu + text brut), fara sa generez audio.
    # Folosit de lista de redare cu surse multiple, unde generarea vine separat.
    try:
        titlu_pagina, text_brut = _extrage_text_brut_din_url(cerere.url)
        if not text_brut.strip():
            raise HTTPException(status_code=422, detail="Nu s-a putut extrage text din URL.")
        # Daca am Gemini, cer un titlu mai bun; altfel folosesc tag-ul <title>.
        if model is not None:
            titlu = _titlu_din_text_si_pagina(text_brut, titlu_pagina)
        else:
            titlu = titlu_pagina[:300]
        return {"status": "success", "titlu": titlu, "text": text_brut}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


def _extrage_text_brut_din_url(url: str) -> tuple[str, str]:
    """Descarc o pagina si scot (titlu_pagina, text_brut) din ea. Refolosit si de ruta /extrage/stream."""
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    response = requests.get(url, headers=headers, timeout=60)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    titlu_pagina = (
        soup.title.string.strip() if soup.title and soup.title.string else "Articol Web"
    )
    # Scot elementele care nu sunt continut de citit.
    for element_inutil in soup(["script", "style", "header", "footer", "nav", "aside"]):
        element_inutil.extract()
    text_brut = soup.get_text(separator=" ", strip=True)
    return titlu_pagina, text_brut


def _titlu_din_text_si_pagina(text_brut: str, titlu_pagina: str) -> str:
    # Cer lui Gemini un titlu curat din inceputul textului; daca nu reuseste, ma intorc la <title>.
    if model is None:
        return titlu_pagina[:300]
    prompt_titlu = f"""
        Citeste inceputul acestui text si extrage DOAR titlul principal al cartii sau articolului.
        Nu include numele autorului, numele site-ului sau alte texte.
        Returneaza STRICT titlul, fara ghilimele.

        Text:
        {text_brut[:2000]}
        """
    try:
        raspuns = model.generate_content(prompt_titlu)
        titlu = (raspuns.text or "").strip()
        if titlu:
            return titlu.replace('"', "").replace("„", "").replace("”", "")[:300]
    except Exception:
        pass
    return titlu_pagina[:300]


@app.post("/extrage/stream")
async def extrage_din_url_stream(
    cerere: CerereExtragere,
    request: Request,
    user: dict = Depends(get_current_user),
):
    """SSE: extrage din URL si genereaza audio intr-un singur job, cu playlist live."""

    def work(event_queue: queue.Queue, job: GenerationJob) -> None:
        def emit(evt: dict) -> None:
            event_queue.put(evt)

        job.check()
        # Verific intai daca am deja cartea in biblioteca utilizatorului (cache).
        q = get_supabase().table("carti").select("*").eq("url", cerere.url)
        q = _apply_owner_scope(q, user)
        if not cerere.force_regenerate:
            existing = q.limit(1).execute()
            if existing.data:
                # O am deja: trimit direct "done" din cache, fara sa regenerez.
                carte = existing.data[0]
                emit(
                    {
                        "type": "done",
                        "status": "Succes (Din Memorie)",
                        "id": carte.get("id"),
                        "titlu": carte.get("titlu"),
                        "link_audio": carte.get("audio_link"),
                        "text_final_audio": carte.get("text_curatat"),
                        "from_cache": True,
                    }
                )
                return

        if model is None:
            raise HTTPException(
                status_code=503,
                detail="Lipsește GEMINI_API_KEY în .env (necesar pentru curățarea textului cu AI).",
            )
        # Anunt faza de extragere, scot textul, apoi pornesc generarea (cu curatare Gemini activata).
        emit({"type": "phase", "phase": "extracting"})
        job.check()
        titlu_pagina, text_brut = _extrage_text_brut_din_url(cerere.url)
        if not text_brut.strip():
            raise HTTPException(status_code=422, detail="Nu s-a putut extrage text din URL.")
        job.check()
        titlu = _titlu_din_text_si_pagina(text_brut, titlu_pagina)
        _ruleaza_generare_text(
            user,
            titlu,
            text_brut,
            curata_cu_gemini=True,
            source_label=cerere.url,
            tts_voice=cerere.tts_voice,
            event_queue=event_queue,
            job=job,
        )

    return _start_sse_worker(work, user, request)


class CerereCancelGenerare(BaseModel):
    job_id: str = Field(..., min_length=8, max_length=64)


@app.post("/generare/cancel")
async def anuleaza_generare(
    body: CerereCancelGenerare,
    user: dict = Depends(get_current_user),
):
    """Anulez un job SSE de generare, doar daca cel care cere e chiar cel care l-a pornit."""
    try:
        cancelled = cancel_generation_job(body.job_id.strip(), user)
    except PermissionError:
        raise HTTPException(
            status_code=403,
            detail="Nu poți anula generarea altui utilizator.",
        )
    return {"status": "success", "cancelled": cancelled}


@app.get("/guest/credits")
async def get_guest_credits(user: dict = Depends(get_current_user)):
    # Intorc creditele trial ale oaspetelui curent (cate caractere mai are).
    if user.get("rol") != "guest":
        raise HTTPException(status_code=403, detail="Doar oaspeții au credite trial.")
    gs = guest_session_id_din_jwt(user)
    if not gs:
        raise HTTPException(status_code=400, detail="Sesiune guest invalidă.")
    # Daca migrarea pentru tabelele de guest nu e aplicata, raspund cu valori nule + un flag.
    if not probe_guest_tables(get_supabase):
        return {
            "guest_session_id": gs,
            "credits_remaining": None,
            "credits_total": None,
            "credits_per_job_max": None,
            "migration_required": True,
        }
    return guest_credits_snapshot(get_supabase, gs)


@app.get("/carti/{carte_id}/segmente")
async def lista_segmente_carte(carte_id: int, user: dict = Depends(get_current_user)):
    # Intorc segmentele unei carti (pentru playlistul pe capitole/parti).
    carte = await incarca_cartea_dupa_id(carte_id)
    assert_poate_edita_cartea(user, carte)
    try:
        resp = (
            get_supabase()
            .table("carti_segmente")
            .select(
                "segment_index,text_fragment,audio_link,char_count,"
                "chapter_index,chapter_title,creat_la"
            )
            .eq("carte_id", carte_id)
            .order("segment_index")
            .execute()
        )
        return {"status": "success", "data": resp.data or []}
    except Exception as e:
        msg = str(e).lower()
        # Daca tabelul de segmente nu exista (schema veche), intorc o lista goala in loc de eroare.
        if "carti_segmente" in msg and ("does not exist" in msg or "42p01" in msg):
            return {"status": "success", "data": []}
        raise


# Limita de marime pentru fisierele incarcate (ca sa nu umplu RAM-ul cu un upload urias).
MAX_UPLOAD_BYTES = 15 * 1024 * 1024


def _is_image_upload(name: str, ctype: str) -> bool:
    # Verific daca fisierul e o imagine, dupa extensie sau dupa content-type.
    n = (name or "").lower()
    c = (ctype or "").lower()
    return n.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif")) or c.startswith("image/")


def _ocr_pdf_page_png(png_bytes: bytes, page_num: int) -> str:
    """OCR pe o pagina PDF deja rasterizata in PNG, folosind Gemini Vision. Intorc text gol la orice eroare."""
    if model is None:
        return ""
    try:
        from PIL import Image

        img = Image.open(io.BytesIO(png_bytes))
        # Gemini vrea RGB; convertesc daca imaginea are canal alfa sau e paletizata.
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        prompt = (
            f"Extrage tot textul vizibil din pagina {page_num} a acestei carti. "
            "Pastreaza ordinea naturala de citire. Returneaza doar textul, fara comentarii."
        )
        raspuns = model.generate_content([prompt, img])
        return (raspuns.text or "").strip()
    except Exception:
        return ""


def _extract_text_from_bytes(
    raw: bytes, name: str, ctype: str, user: dict
) -> tuple[str, str, dict]:
    """Scot text din bytes-ii unui fisier incarcat. Intorc (titlu_sugerat, text, metadate pentru preview)."""
    # Resping fisierele prea mari.
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Fișier prea mare (maxim 15 MB).")
    name_l = (name or "document").lower()
    ctype_l = (ctype or "").lower()
    # OCR pe imagini e doar pentru useri cu cont (consuma resurse AI).
    if _is_image_upload(name_l, ctype_l) and user.get("rol") == "guest":
        raise HTTPException(
            status_code=403,
            detail="Extragerea textului din imagini necesită un cont. Creează cont sau autentifică-te.",
        )
    # Formatul .doc vechi (binar) nu e suportat; cer DOCX.
    if name_l.endswith(".doc") and not name_l.endswith(".docx"):
        raise HTTPException(
            status_code=400,
            detail="Formatul .doc vechi nu este suportat. Salvați documentul ca DOCX.",
        )
    text = ""
    extract_meta: dict = {}
    # Aleg parserul potrivit dupa extensie / content-type.
    if name_l.endswith(".txt") or ctype_l == "text/plain":
        # TXT: decodez bytes-ii incercand mai multe encodinguri.
        text = decode_plain_text_bytes(raw)
        extract_meta = build_extract_meta(text, "txt")
    elif name_l.endswith(".pdf") or ctype_l == "application/pdf":
        # PDF: dau OCR-ul doar la userii cu cont (oaspetii primesc None = fara OCR).
        ocr_fn = None if user.get("rol") == "guest" else _ocr_pdf_page_png
        text, pdf_meta = extract_pdf_text(raw, ocr_page=ocr_fn)
        extract_meta = build_extract_meta(text, "pdf", pdf_meta)
    elif name_l.endswith(".epub") or ctype_l in ("application/epub+zip", "application/x-epub+zip"):
        # EPUB: parcurg documentele HTML din interior si scot textul din fiecare.
        import ebooklib
        from ebooklib import epub

        book = epub.read_epub(io.BytesIO(raw))
        html_parts: list[str] = []
        for item in book.get_items():
            if item.get_type() == ebooklib.ITEM_DOCUMENT:
                try:
                    # Incerc sa iau continutul direct; daca e gol, apelez metoda dedicata.
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
                    # Sar peste capitolele care nu se pot parsa.
                    continue
        text = "\n\n".join(html_parts)
        extract_meta = build_extract_meta(text, "epub")
    elif name_l.endswith(".docx") or "wordprocessingml" in ctype_l:
        # DOCX: lipesc textul tuturor paragrafelor.
        from docx import Document

        doc = Document(io.BytesIO(raw))
        text = "\n".join(p.text for p in doc.paragraphs)
        extract_meta = build_extract_meta(text, "docx")
    elif name_l.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif")) or ctype_l.startswith("image/"):
        # Imagine: am nevoie de Gemini Vision ca sa scot textul.
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
        extract_meta = build_extract_meta(text, "image")
    else:
        # Tip de fisier necunoscut.
        raise HTTPException(
            status_code=400,
            detail="Format nesuportat. Folosiți PDF, EPUB, DOCX, TXT sau imagini (PNG, JPG, WEBP).",
        )
    # Daca nu am scos nimic util, anunt clar (poate e un PDF scanat fara text).
    if not text or not str(text).strip():
        raise HTTPException(
            status_code=422,
            detail="Nu s-a putut extrage text din fișier (conținut gol sau scanat fără text).",
        )
    # Titlul sugerat e numele fisierului fara extensie.
    base_name = name or "Document"
    titlu_sugerat = (base_name.rsplit(".", 1)[0] if "." in base_name else base_name)[:200]
    # Repar diacriticele legacy si normalizez textul.
    text = normalize_extracted_document_text(repair_legacy_romanian_diacritics(str(text)))
    # Daca nu am metadate, le construiesc; altfel le actualizez cu numarul real de caractere + preview.
    if not extract_meta:
        extract_meta = build_extract_meta(text, "unknown")
    else:
        extract_meta["char_count"] = len(text)
        preview = text[:400].replace("\n", " ")
        extract_meta["extract_preview"] = preview + ("…" if len(text) > 400 else "")
    return titlu_sugerat, text, extract_meta


@app.post("/genereaza_fisier/stream")
async def genereaza_din_fisier_stream(
    request: Request,
    file: UploadFile = File(...),
    titlu: str = Form(""),
    curata_cu_gemini: bool = Form(False),
    tts_voice: str = Form(""),
    user: dict = Depends(get_current_user),
):
    """SSE: extrag textul dintr-un fisier incarcat, apoi generez audio cu playlist live."""

    # Citesc fisierul inainte sa pornesc thread-ul (UploadFile e legat de cererea async).
    raw = await file.read()
    name = file.filename or "document"
    ctype = file.content_type or ""

    def work(event_queue: queue.Queue, job: GenerationJob) -> None:
        def emit(evt: dict) -> None:
            event_queue.put(evt)

        emit({"type": "phase", "phase": "extracting"})
        job.check()
        titlu_sugerat, text, _meta = _extract_text_from_bytes(raw, name, ctype, user)
        # Daca utilizatorul a dat un titlu, il folosesc; altfel pe cel sugerat din numele fisierului.
        titlu_final = (titlu or titlu_sugerat).strip()[:500]
        job.check()
        _ruleaza_generare_text(
            user,
            titlu_final,
            text,
            curata_cu_gemini=curata_cu_gemini,
            source_label=f"Fișier: {name}",
            tts_voice=tts_voice.strip() or None,
            event_queue=event_queue,
            job=job,
        )

    return _start_sse_worker(work, user, request)


@app.post("/extrage_fisier")
async def extrage_fisier(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """
    Upload unic care doar extrage textul (fara audio): detectez tipul si intorc text + titlu sugerat.
    PDF prin PyMuPDF/pypdf, EPUB prin ebooklib + BeautifulSoup, DOCX prin python-docx, imagini prin Gemini Vision.
    """
    try:
        raw = await file.read()
        name = file.filename or "document"
        ctype = file.content_type or ""
        titlu_sugerat, text, extract_meta = _extract_text_from_bytes(raw, name, ctype, user)
        return {
            "status": "success",
            "text": text,
            "titlu_sugerat": titlu_sugerat,
            "extract_meta": extract_meta,
        }
    except HTTPException:
        raise
    except UnicodeEncodeError as e:
        # Eroare tipica de consola pe Windows cand apar diacritice.
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
    Biblioteca personala: adminul vede tot, ceilalti doar cartile lor (filtrate prin _apply_owner_scope).
    Sortez dupa ultima accesare, apoi dupa data crearii, ambele descrescator.
    """
    try:
        q = get_supabase().table("carti").select("*")
        q = _apply_owner_scope(q, user)
        response = q.order("ultima_accesare", desc=True).order("creat_la", desc=True).execute()

        return {"status": "success", "data": response.data}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Eroare la preluarea istoricului din Supabase: {e}")
        return {"status": "error", "message": str(e)}


class CerereRedenumire(BaseModel):
    titlu_nou: str


class CerereRezumat(BaseModel):
    """Limba dorita pentru rezumat: en, ro sau auto (cand e omisa)."""
    language: str | None = None


@app.patch("/carti/{carte_id}/acces")
async def inregistreaza_acces_carte(carte_id: int, user: dict = Depends(get_current_user)):
    """Actualizez ultima_accesare cand cartea e deschisa, ca sortarea bibliotecii dupa recenta sa fie corecta."""
    try:
        carte = await incarca_cartea_dupa_id(carte_id)
        assert_poate_edita_cartea(user, carte)
        acum = datetime.now(timezone.utc).isoformat()
        get_supabase().table("carti").update({"ultima_accesare": acum}).eq("id", carte_id).execute()
        return {"status": "success", "ultima_accesare": acum}
    except HTTPException:
        raise
    except Exception as e:
        msg = str(e).lower()
        # Daca lipseste coloana, e o problema de migrare, nu o ascund.
        if "ultima_accesare" in msg:
            raise HTTPException(
                status_code=503,
                detail="Coloana ultima_accesare lipsește — rulează migrarea Supabase.",
            ) from e
        return {"status": "error", "mesaj": str(e)}


@app.put("/redenumeste/{carte_id}")
async def redenumeste_carte(
    carte_id: int,
    cerere: CerereRedenumire,
    user: dict = Depends(get_current_user),
):
    """Schimb titlul cartii, dupa ce verific ca utilizatorul are dreptul."""
    try:
        carte = await incarca_cartea_dupa_id(carte_id)
        assert_poate_edita_cartea(user, carte)
        get_supabase().table("carti").update({"titlu": cerere.titlu_nou}).eq("id", carte_id).execute()
        return {"status": "success", "mesaj": "Titlu actualizat"}
    except HTTPException:
        raise
    except Exception as e:
        return {"status": "error", "mesaj": str(e)}


@app.post("/carti/{carte_id}/rezumat")
async def genereaza_rezumat_carte(
    carte_id: int,
    language: str | None = Query(None),
    cerere: CerereRezumat = CerereRezumat(),
    user: dict = Depends(get_current_user),
):
    """Generez un rezumat AI al textului cartii. E o operatie separata: NU atinge fisierul audio existent."""
    if model is None:
        raise HTTPException(status_code=503, detail="Serviciul AI nu este configurat (GEMINI_API_KEY).")
    try:
        carte = await incarca_cartea_dupa_id(carte_id)
        assert_poate_edita_cartea(user, carte)
        text = (carte.get("text_curatat") or "").strip()
        if not text:
            raise HTTPException(status_code=422, detail="Cartea nu are text pentru rezumat.")
        # Detectez limba doar pentru log (rezumatul isi detecteaza singur limba intern).
        output_lang = resolve_summary_output_language(text, None)
        print(f"[rezumat] carte_id={carte_id} limba_detectata={output_lang!r} chars={len(text)}")
        # Rulez rezumarea intr-un thread separat ca sa nu blochez event loop-ul (e operatie lunga).
        rezumat = await asyncio.to_thread(
            rezuma_text_cu_gemini,
            model,
            text,
            None,
            None,
        )
        if not rezumat.strip():
            raise HTTPException(status_code=502, detail="Nu s-a putut genera rezumatul.")
        return {"status": "success", "rezumat": rezumat.strip()}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.delete("/sterge/{carte_id}")
async def sterge_carte(carte_id: int, user: dict = Depends(get_current_user)):
    """Sterg cartea si fisierul audio, daca utilizatorul are drept pe ea (sau e admin)."""
    try:
        carte = await incarca_cartea_dupa_id(carte_id)
        assert_poate_edita_cartea(user, carte)
        sterge_carte_si_fisier(carte_id, carte.get("audio_link"), user=user)
        return {"status": "success", "mesaj": "Carte și fișier șterse"}
    except HTTPException:
        raise
    except Exception as e:
        return {"status": "error", "mesaj": str(e)}


def hash_parola(parola: str) -> str:
    # Hash-uiesc parola cu bcrypt (cu salt generat automat) inainte sa o salvez in DB.
    return bcrypt_lib.hashpw(parola.encode("utf-8"), bcrypt_lib.gensalt()).decode("utf-8")

def verifica_parola(parola: str, parola_hash: str) -> bool:
    # Compar parola introdusa cu hash-ul stocat.
    return bcrypt_lib.checkpw(parola.encode("utf-8"), parola_hash.encode("utf-8"))

def creeaza_token(email: str, rol: str, user_id: int, guest_session_id: str | None = None) -> str:
    # Construiesc un JWT semnat cu data de expirare si campurile de identitate.
    expire = datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_ORE)
    # Pentru oaspete sub ramane "guest"; altfel normalizez emailul.
    sub = email if email == "guest" else (email or "").strip().lower()
    payload = {"sub": sub, "rol": rol, "id": user_id, "exp": expire}
    # Adaug guest_session_id in payload doar pentru oaspeti.
    if guest_session_id:
        payload["guest_session_id"] = guest_session_id
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def decodifica_token(token: str) -> dict:
    """Wrapper peste jwt.decode: orice problema de semnatura / expirare devine un 401 uniform."""
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Token invalid sau expirat.")


# Body-urile pentru rutele de autentificare.

class CerereLogin(BaseModel):
    email: str = ""
    parola: str = ""
    rol: str  # admin | user | guest
    guest_session_id: str | None = None

class CerereInregistrare(BaseModel):
    email: str
    parola: str

class CerereVerificareToken(BaseModel):
    token: str


@app.post("/login")
async def login(cerere: CerereLogin):
    """
    Autentificare: verific utilizatorul in tabelul utilizatori sau emit un token de oaspete (fara cont).
    Token-ul expira dupa TOKEN_EXPIRE_ORE si contine sub, rol, id.
    """
    if cerere.rol not in ("admin", "user", "guest"):
        raise HTTPException(status_code=400, detail="Rol invalid. Folosiți: admin, user sau guest.")

    email_trim = (cerere.email or "").strip()
    parola_trim = (cerere.parola or "").strip()

    # Fluxul "continua fara cont": nu caut nimic in DB, doar emit un JWT cu sub=guest.
    if cerere.rol == "guest" and not email_trim and not parola_trim:
        guest_sid = normalize_guest_session_id(cerere.guest_session_id)
        # Daca tabelele de guest exista, ma asigur ca sesiunea e creata (cu credite).
        if probe_guest_tables(get_supabase):
            ensure_guest_session(get_supabase, guest_sid)
        token = creeaza_token("guest", "guest", 0, guest_session_id=guest_sid)
        return {
            "status": "success",
            "token": token,
            "rol": "guest",
            "email": "",
            "guest_session_id": guest_sid,
        }

    # Daca cineva cere rol guest dar cu email/parola, il indrum spre fluxul corect.
    if cerere.rol == "guest":
        raise HTTPException(
            status_code=400,
            detail="Oaspeții nu au cont. Folosiți „Continuă fără cont”.",
        )

    if not email_trim or not parola_trim:
        raise HTTPException(status_code=400, detail="Email și parola sunt obligatorii.")

    try:
        # Caut utilizatorul: ilike (case-insensitive) + escape la % si _ ca input-ul sa nu sparga pattern-ul.
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

    # Mesaj generic la lipsa contului (nu dezvalui daca emailul exista sau nu).
    if not rezultat.data:
        raise HTTPException(status_code=401, detail="Email, parolă sau rol incorect.")

    utilizator = rezultat.data[0]

    # Verific parola cu bcrypt; acelasi mesaj generic la esec.
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
    Inregistrare publica: creez un cont cu rol "user" si parola hash-uita.
    """
    email_norm = (cerere.email or "").strip().lower()
    if not email_norm:
        raise HTTPException(status_code=400, detail="Email invalid.")

    parola_trim = (cerere.parola or "").strip()
    if not parola_trim:
        raise HTTPException(status_code=400, detail="Parola este obligatorie.")

    try:
        # Verific intai ca emailul nu e deja folosit.
        existent = (
            get_supabase().table("utilizatori").select("id").ilike("email", email_norm).execute()
        )
        if existent.data:
            raise HTTPException(status_code=409, detail="Emailul este deja înregistrat.")

        get_supabase().table("utilizatori").insert({
            "email": email_norm,
            "parola_hash": hash_parola(parola_trim),
            "rol": "user",  # la inregistrarea publica permit doar rolul user
        }).execute()

        return {
            "status": "success",
            "mesaj": f"Contul '{email_norm}' a fost creat. Te poți autentifica acum.",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/verifica-token")
async def verifica_token(cerere: CerereVerificareToken):
    """Decodez token-ul (401 daca e invalid) si intorc campurile utile clientului, ca sa stie cine e logat."""
    payload = decodifica_token(cerere.token)
    return {
        "status": "valid",
        "email": payload.get("sub"),
        "rol": payload.get("rol"),
        "id": payload.get("id"),
    }
