"""
Credite pentru sesiuni guest: limita caractere per job si total, legate de guest_session_id.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

GUEST_CREDITS_TOTAL = max(500, int(os.getenv("GUEST_CREDITS_TOTAL", "5000")))
GUEST_CREDITS_PER_JOB = max(500, int(os.getenv("GUEST_CREDITS_PER_JOB", "5000")))
GUEST_PREVIEW_CHARS = max(500, int(os.getenv("GUEST_PREVIEW_CHARS", "5000")))
GUEST_SESSION_TTL_DAYS = max(1, int(os.getenv("GUEST_SESSION_TTL_DAYS", "7")))

_guest_tables_ready: bool | None = None


def guest_session_id_din_jwt(user: dict | None) -> str | None:
    if not user or user.get("rol") != "guest":
        return None
    raw = (user.get("guest_session_id") or "").strip()
    return raw if raw else None


def _valid_uuid(val: str) -> bool:
    try:
        uuid.UUID(str(val))
        return True
    except (TypeError, ValueError):
        return False


def normalize_guest_session_id(val: str | None) -> str:
    if val and _valid_uuid(val):
        return str(uuid.UUID(val))
    return str(uuid.uuid4())


def mark_guest_tables_ready(ok: bool) -> None:
    global _guest_tables_ready
    _guest_tables_ready = ok


def guest_tables_available() -> bool:
    return _guest_tables_ready is True


def probe_guest_tables(get_supabase) -> bool:
    """Detecteaza o singura data daca tabelele guest_sessions / carti_segmente exista."""
    global _guest_tables_ready
    if _guest_tables_ready is not None:
        return _guest_tables_ready
    try:
        get_supabase().table("guest_sessions").select("id").limit(1).execute()
        _guest_tables_ready = True
    except Exception as e:
        msg = str(e).lower()
        if "guest_sessions" in msg and ("does not exist" in msg or "42p01" in msg):
            _guest_tables_ready = False
        else:
            raise
    return _guest_tables_ready


def ensure_guest_session(get_supabase, session_id: str) -> dict:
    if not probe_guest_tables(get_supabase):
        raise HTTPException(
            status_code=503,
            detail="Migrarea guest_sessions lipsește. Rulează backend/migrations/003_guest_sessions_and_segments.sql.",
        )
    sid = normalize_guest_session_id(session_id)
    expires = (datetime.now(timezone.utc) + timedelta(days=GUEST_SESSION_TTL_DAYS)).isoformat()
    existing = get_supabase().table("guest_sessions").select("*").eq("id", sid).limit(1).execute()
    if existing.data:
        row = existing.data[0]
        if int(row.get("credits_remaining") or 0) < 0:
            get_supabase().table("guest_sessions").update(
                {"credits_remaining": 0}
            ).eq("id", sid).execute()
        return row
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
    return ins.data[0] if ins.data else {"id": sid, "credits_remaining": GUEST_CREDITS_TOTAL}


def guest_credits_snapshot(get_supabase, session_id: str) -> dict:
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
    if char_count <= 0:
        raise HTTPException(status_code=422, detail="Text gol după curățare.")
    if char_count > GUEST_CREDITS_PER_JOB:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Textul depășește limita de {GUEST_CREDITS_PER_JOB} caractere per generare "
                f"(ai {char_count}). Scurtează textul sau creează cont."
            ),
        )
    snap = guest_credits_snapshot(get_supabase, session_id)
    if char_count > snap["credits_remaining"]:
        raise HTTPException(
            status_code=402,
            detail=(
                f"Credite guest epuizate. Rămase: {snap['credits_remaining']} caractere, "
                f"necesare: {char_count}. Creează cont pentru generare nelimitată."
            ),
        )


def deduct_guest_credits(get_supabase, session_id: str, char_count: int) -> dict:
    assert_guest_can_generate(get_supabase, session_id, char_count)
    row = ensure_guest_session(get_supabase, session_id)
    remaining = int(row.get("credits_remaining") or 0)
    used = int(row.get("credits_used") or 0)
    jobs = int(row.get("jobs_count") or 0)
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
