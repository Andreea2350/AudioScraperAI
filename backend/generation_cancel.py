"""
Mecanismul prin care utilizatorul poate opri o generare audio in curs ("Stop").
E o anulare "cooperativa": nu omor brutal nimic, ci pun un steag pe job, iar pipeline-ul
verifica din cand in cand steagul si se opreste singur frumos. Tot aici tin minte ce fisiere
am urcat deja, ca sa le pot sterge daca utilizatorul anuleaza la mijloc.
"""
from __future__ import annotations

import threading
import uuid
from typing import Callable


class GenerationCancelled(Exception):
    """O arunc atunci cand userul a apasat Stop sau s-a inchis conexiunea SSE; pipeline-ul o prinde si iese."""


class GenerationJob:
    """Tine contextul unui singur job de generare: steagul de anulare si fisierele urcate (de sters la cancel)."""

    def __init__(self, job_id: str, owner_key: str) -> None:
        self.job_id = job_id          # id-ul unic al jobului (UUID)
        self.owner_key = owner_key    # cui apartine jobul, ca sa nu poata altcineva sa-l anuleze
        self._cancelled = threading.Event()  # steag thread-safe: setat = "anuleaza"
        self._uploads: list[str] = []        # URL-urile fisierelor urcate pana acum
        self._lock = threading.Lock()        # protejez lista de uploads (se scrie din mai multe fire)

    def cancel(self) -> None:
        # Ridic steagul; pipeline-ul il va observa la urmatorul check().
        self._cancelled.set()

    def is_cancelled(self) -> bool:
        return self._cancelled.is_set()

    def check(self) -> None:
        # Apelat des de pipeline; daca s-a cerut anulare, arunca exceptia care opreste totul.
        if self.is_cancelled():
            raise GenerationCancelled()

    def track_upload(self, public_url: str) -> None:
        # Notez un fisier urcat ca sa-l pot sterge daca jobul e anulat dupa upload.
        if not public_url:
            return
        with self._lock:
            self._uploads.append(public_url)

    def cleanup_uploads(self, get_supabase: Callable) -> None:
        # Sterg din Supabase Storage toate fisierele urcate de jobul asta (apelat la anulare).
        with self._lock:
            # Iau o copie a listei si o golesc sub lock, ca sa nu se interfereze cu alte fire.
            urls = list(self._uploads)
            self._uploads.clear()
        for url in urls:
            # Din URL scot doar numele fisierului (ultima bucata, fara query string).
            name = url.split("/")[-1].split("?")[0]
            if not name:
                continue
            try:
                get_supabase().storage.from_("audio-books").remove([name])
            except Exception:
                # Daca stergerea unui fisier pica, nu blochez restul curatarii.
                pass


# Registru global de joburi active, indexat dupa job_id. Lock-ul il protejeaza intre cereri.
_jobs: dict[str, GenerationJob] = {}
_registry_lock = threading.Lock()


def owner_key_from_user(user: dict | None) -> str:
    # Construiesc o "cheie de proprietar" unica pe baza identitatii din JWT.
    # Asa pot verifica mai tarziu ca cine anuleaza jobul e chiar cel care l-a pornit.
    if not user:
        return "anon"
    # Oaspetii sunt identificati prin sesiunea de guest.
    gs = (user.get("guest_session_id") or "").strip()
    if gs:
        return f"guest:{gs}"
    # Userii inregistrati prin id-ul lor din baza de date.
    uid = user.get("id")
    if uid is not None:
        return f"user:{uid}"
    # Fallback: combinatie email + rol.
    sub = (user.get("sub") or "").strip().lower()
    rol = user.get("rol") or ""
    return f"sub:{sub}:{rol}"


def create_generation_job(user: dict | None) -> GenerationJob:
    # Creez un job nou cu id unic si il inregistrez in registrul global.
    job_id = str(uuid.uuid4())
    job = GenerationJob(job_id, owner_key_from_user(user))
    with _registry_lock:
        _jobs[job_id] = job
    return job


def get_generation_job(job_id: str) -> GenerationJob | None:
    # Caut un job dupa id (None daca nu exista / a fost deja eliberat).
    with _registry_lock:
        return _jobs.get(job_id)


def release_generation_job(job_id: str) -> None:
    # Scot jobul din registru cand s-a terminat (reusit sau anulat), ca sa nu se adune in memorie.
    with _registry_lock:
        _jobs.pop(job_id, None)


def cancel_generation_job(job_id: str, user: dict) -> bool:
    # Cer anularea unui job: intai verific ca exista si ca apartine celui care cere.
    job = get_generation_job(job_id)
    if not job:
        return False
    if job.owner_key != owner_key_from_user(user):
        raise PermissionError("Nu poți anula generarea altui utilizator.")
    job.cancel()
    return True
