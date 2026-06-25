"""
Sistemul de credite pentru oaspeti (useri fara cont). Un oaspete are un numar limitat de
caractere pe care le poate transforma in audio, legat de un guest_session_id (un UUID din JWT).
Aici creez/actualizez sesiunea in Supabase, verific daca mai are credite si i le scad dupa fiecare job.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

# Limitele se pot regla din .env, dar tin un minim de 500 ca sa nu fie inutil de mici.
GUEST_CREDITS_TOTAL = max(500, int(os.getenv("GUEST_CREDITS_TOTAL", "5000")))     # cat primeste in total un oaspete
GUEST_CREDITS_PER_JOB = max(500, int(os.getenv("GUEST_CREDITS_PER_JOB", "5000"))) # maximul intr-o singura generare
GUEST_PREVIEW_CHARS = max(500, int(os.getenv("GUEST_PREVIEW_CHARS", "5000")))     # cate caractere din text procesez la preview
GUEST_SESSION_TTL_DAYS = max(1, int(os.getenv("GUEST_SESSION_TTL_DAYS", "7")))    # dupa cate zile expira sesiunea

# Cache: vreau sa verific o singura data daca tabelele de guest exista in Supabase,
# ca sa nu intreb baza de date la fiecare cerere. None = inca nu am verificat.
_guest_tables_ready: bool | None = None


def guest_session_id_din_jwt(user: dict | None) -> str | None:
    """Scot guest_session_id din token; intorc None daca nu e oaspete sau nu are sesiune."""
    if not user or user.get("rol") != "guest":
        return None
    raw = (user.get("guest_session_id") or "").strip()
    return raw if raw else None


def _valid_uuid(val: str) -> bool:
    """Verific daca un string e un UUID valid (ca sa nu accept id-uri inventate de client)."""
    try:
        uuid.UUID(str(val))
        return True
    except (TypeError, ValueError):
        return False


def normalize_guest_session_id(val: str | None) -> str:
    """Daca primesc un UUID valid, il pastrez (normalizat); altfel generez unul nou pentru sesiune."""
    if val and _valid_uuid(val):
        return str(uuid.UUID(val))
    return str(uuid.uuid4())


def mark_guest_tables_ready(ok: bool) -> None:
    """Setez manual flag-ul de existenta a tabelelor (util in teste, ca sa nu lovesc baza reala)."""
    global _guest_tables_ready
    _guest_tables_ready = ok


def guest_tables_available() -> bool:
    """True doar daca am confirmat deja ca tabelul guest_sessions exista."""
    return _guest_tables_ready is True


def probe_guest_tables(get_supabase) -> bool:
    """Verific o singura data daca tabelul guest_sessions exista; rezultatul ramane in cache."""
    global _guest_tables_ready
    # Daca am verificat deja, intorc raspunsul memorat.
    if _guest_tables_ready is not None:
        return _guest_tables_ready
    try:
        # Un select minimal: daca merge, tabelul exista.
        get_supabase().table("guest_sessions").select("id").limit(1).execute()
        _guest_tables_ready = True
    except Exception as e:
        msg = str(e).lower()
        # Daca eroarea spune clar ca tabelul nu exista (cod 42P01), notez ca lipseste migrarea.
        if "guest_sessions" in msg and ("does not exist" in msg or "42p01" in msg):
            _guest_tables_ready = False
        else:
            # Orice alta eroare (retea, permisiuni) o las sa urce, nu o ascund.
            raise
    return _guest_tables_ready


def ensure_guest_session(get_supabase, session_id: str) -> dict:
    """Ma asigur ca exista un rand guest_sessions pentru acest id: il citesc daca exista, altfel il creez."""
    # Fara migrare nu pot lucra cu oaspeti -> mesaj clar catre dev.
    if not probe_guest_tables(get_supabase):
        raise HTTPException(
            status_code=503,
            detail="Migrarea guest_sessions lipseste. Ruleaza backend/migrations/003_guest_sessions_and_segments.sql.",
        )
    sid = normalize_guest_session_id(session_id)
    # Calculez momentul de expirare pornind de la acum + TTL-ul configurat.
    expires = (datetime.now(timezone.utc) + timedelta(days=GUEST_SESSION_TTL_DAYS)).isoformat()
    existing = get_supabase().table("guest_sessions").select("*").eq("id", sid).limit(1).execute()
    if existing.data:
        row = existing.data[0]
        # Daca dintr-o eroare anterioara au ramas credite negative, le aduc la 0.
        if int(row.get("credits_remaining") or 0) < 0:
            get_supabase().table("guest_sessions").update(
                {"credits_remaining": 0}
            ).eq("id", sid).execute()
        return row
    # Prima vizita a acestei sesiuni: inserez un rand nou cu creditele initiale.
    ins = (
        get_supabase()
        .table("guest_sessions")
        .insert(
            {
                "id": sid,
                "credits_remaining": GUEST_CREDITS_TOTAL,
                "credits_used": 0,
                "jobs_count": 0,
                "expires_at": expires,
            }
        )
        .execute()
    )
    # Daca insert-ul intoarce randul, il folosesc; altfel construiesc un dict minimal de rezerva.
    return ins.data[0] if ins.data else {"id": sid, "credits_remaining": GUEST_CREDITS_TOTAL}


def guest_credits_snapshot(get_supabase, session_id: str) -> dict:
    """Intorc starea curenta a creditelor, exact ce afiseaza UI-ul la GET /guest/credits."""
    row = ensure_guest_session(get_supabase, session_id)
    remaining = int(row.get("credits_remaining") or 0)
    used = int(row.get("credits_used") or 0)
    return {
        "guest_session_id": row.get("id") or session_id,
        "credits_remaining": remaining,
        "credits_total": GUEST_CREDITS_TOTAL,
        "credits_per_job_max": GUEST_CREDITS_PER_JOB,
        "credits_used": used,
        "jobs_count": int(row.get("jobs_count") or 0),
    }


def assert_guest_can_generate(get_supabase, session_id: str, char_count: int) -> None:
    """Verific inainte de generare ca oaspetele are dreptul; daca nu, arunc eroarea potrivita."""
    # Text gol -> 422 (nimic de procesat).
    if char_count <= 0:
        raise HTTPException(status_code=422, detail="Text gol dupa curatare.")
    # Peste limita per job -> 422, cu sugestia de a scurta sau crea cont.
    if char_count > GUEST_CREDITS_PER_JOB:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Textul depaseste limita de {GUEST_CREDITS_PER_JOB} caractere per generare "
                f"(ai {char_count}). Scurteaza textul sau creeaza cont."
            ),
        )
    # Nu mai are destule credite ramase -> 402 (Payment Required, semantic potrivit pentru "epuizat").
    snap = guest_credits_snapshot(get_supabase, session_id)
    if char_count > snap["credits_remaining"]:
        raise HTTPException(
            status_code=402,
            detail=(
                f"Credite guest epuizate. Ramase: {snap['credits_remaining']} caractere, "
                f"necesare: {char_count}. Creeaza cont pentru generare nelimitata."
            ),
        )


def deduct_guest_credits(get_supabase, session_id: str, char_count: int) -> dict:
    """Dupa o generare reusita, scad creditele consumate si intorc noua stare."""
    # Verific din nou ca are dreptul (defensiv, in caz ca ceva s-a schimbat intre timp).
    assert_guest_can_generate(get_supabase, session_id, char_count)
    row = ensure_guest_session(get_supabase, session_id)
    remaining = int(row.get("credits_remaining") or 0)
    used = int(row.get("credits_used") or 0)
    jobs = int(row.get("jobs_count") or 0)
    # Nu las creditele ramase sa scada sub 0.
    new_remaining = max(0, remaining - char_count)
    get_supabase().table("guest_sessions").update(
        {
            "credits_remaining": new_remaining,
            "credits_used": used + char_count,
            "jobs_count": jobs + 1,
        }
    ).eq("id", row["id"]).execute()
    return {
        "credits_remaining": new_remaining,
        "credits_used": used + char_count,
        "jobs_count": jobs + 1,
    }
