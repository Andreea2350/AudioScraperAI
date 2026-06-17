"""
Anulare cooperativa a job-urilor de generare audio (SSE).
"""
from __future__ import annotations

import threading
import uuid
from typing import Callable


class GenerationCancelled(Exception):
    """Ridicata cand utilizatorul anuleaza sau se inchide conexiunea SSE."""


class GenerationJob:
    """Context per job: flag anulare + fisiere incarcate de sters la cancel."""

    def __init__(self, job_id: str, owner_key: str) -> None:
        self.job_id = job_id
        self.owner_key = owner_key
        self._cancelled = threading.Event()
        self._uploads: list[str] = []
        self._lock = threading.Lock()

    def cancel(self) -> None:
        self._cancelled.set()

    def is_cancelled(self) -> bool:
        return self._cancelled.is_set()

    def check(self) -> None:
        if self.is_cancelled():
            raise GenerationCancelled()

    def track_upload(self, public_url: str) -> None:
        if not public_url:
            return
        with self._lock:
            self._uploads.append(public_url)

    def cleanup_uploads(self, get_supabase: Callable) -> None:
        with self._lock:
            urls = list(self._uploads)
            self._uploads.clear()
        for url in urls:
            name = url.split("/")[-1].split("?")[0]
            if not name:
                continue
            try:
                get_supabase().storage.from_("audio-books").remove([name])
            except Exception:
                pass


_jobs: dict[str, GenerationJob] = {}
_registry_lock = threading.Lock()


def owner_key_from_user(user: dict | None) -> str:
    if not user:
        return "anon"
    gs = (user.get("guest_session_id") or "").strip()
    if gs:
        return f"guest:{gs}"
    uid = user.get("id")
    if uid is not None:
        return f"user:{uid}"
    sub = (user.get("sub") or "").strip().lower()
    rol = user.get("rol") or ""
    return f"sub:{sub}:{rol}"


def create_generation_job(user: dict | None) -> GenerationJob:
    job_id = str(uuid.uuid4())
    job = GenerationJob(job_id, owner_key_from_user(user))
    with _registry_lock:
        _jobs[job_id] = job
    return job


def get_generation_job(job_id: str) -> GenerationJob | None:
    with _registry_lock:
        return _jobs.get(job_id)


def release_generation_job(job_id: str) -> None:
    with _registry_lock:
        _jobs.pop(job_id, None)


def cancel_generation_job(job_id: str, user: dict) -> bool:
    job = get_generation_job(job_id)
    if not job:
        return False
    if job.owner_key != owner_key_from_user(user):
        raise PermissionError("Nu poți anula generarea altui utilizator.")
    job.cancel()
    return True
