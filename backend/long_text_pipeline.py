"""
Pipeline pentru carti foarte lungi: intai taiem textul brut in bucati si le trimitem la Gemini
(ca sa nu lovesti plafonul de iesire la un singur apel), apoi fiecare bucata trece prin TTS.

Motorul TTS implicit e Microsoft Edge (pachetul edge-tts); poti comuta pe gTTS prin variabila de mediu.

Variabile utile (toate optionale):
  TTS_ENGINE          edge sau gtts
  EDGE_TTS_VOICE      ex. ro-RO-AlinaNeural
  GEMINI_CHUNK_CHARS  cat text brut intra intr-un apel Gemini (default 4500)
  GEMINI_WORKERS      cate fire paralele la curatare (default 4)
  TTS_MAX_CHARS       lungime maxima a unui fragment citit la microfon (default 2800)
  TTS_DELAY_SEC       pauza intre fragmente mari (reduce presiunea pe servicii)
  GTTS_WORKERS        la gTTS, paralelismul ridica risc de 429; default 1
  GTTS_SAFE_CHARS     sub aceasta lungime tinem fiecare apel gTTS (Google face multe POST-uri mici)
  GTTS_INTER_PART_DELAY_SEC   pauza intre aceste mini-apleuri in cadrul aceluiasi chunk

La final lipim MP3-urile cu ffmpeg concat (nu incarca tot PCM-ul cartii in RAM). pydub e folosit
mai mult la verificarea duratei pe fisier si la planul B daca ffmpeg lipseste.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

GEMINI_CHUNK_CHARS = max(1000, int(os.getenv("GEMINI_CHUNK_CHARS", "4500")))
GEMINI_WORKERS = max(1, int(os.getenv("GEMINI_WORKERS", "4")))
# edge = voce neurala prin serviciul Edge; gtts = varianta neoficiala Google (mai sensibila la rate limit).
TTS_ENGINE = (os.getenv("TTS_ENGINE") or "edge").strip().lower()
EDGE_TTS_VOICE = os.getenv("EDGE_TTS_VOICE", "ro-RO-AlinaNeural").strip()
# Timeout mare pe citirea WebSocket: altfel se rupe citirea la bucati lungi de audio.
EDGE_TTS_RECEIVE_TIMEOUT = int(os.getenv("EDGE_TTS_RECEIVE_TIMEOUT", "600"))
EDGE_TTS_CONNECT_TIMEOUT = int(os.getenv("EDGE_TTS_CONNECT_TIMEOUT", "30"))
TTS_MAX_CHARS = max(500, int(os.getenv("TTS_MAX_CHARS", os.getenv("GTTS_MAX_CHARS", "2800"))))
# La gTTS, thread-uri multiple duc des la 429 si fisiere goale; implicit mergem strict unul dupa altul.
GTTS_WORKERS = max(1, int(os.getenv("GTTS_WORKERS", "1")))
GTTS_RETRIES = max(1, int(os.getenv("GTTS_RETRIES", "8")))
TTS_DELAY_SEC = float(os.getenv("TTS_DELAY_SEC", os.getenv("GTTS_DELAY_SEC", "0.25")))
# Un singur .save() gTTS poate declansa zeci de POST-uri scurte; tinem bucatile sub prag si punem pauze.
GTTS_SAFE_CHARS = max(40, min(100, int(os.getenv("GTTS_SAFE_CHARS", "95"))))
GTTS_INTER_PART_DELAY_SEC = float(os.getenv("GTTS_INTER_PART_DELAY_SEC", "0.6"))
GTTS_429_BASE_SLEEP_SEC = float(os.getenv("GTTS_429_BASE_SLEEP_SEC", "4.0"))
MIN_MP3_PART_BYTES = int(os.getenv("MIN_MP3_PART_BYTES", "400"))
MIN_FINAL_MP3_BYTES = int(os.getenv("MIN_FINAL_MP3_BYTES", "1200"))
# Verificare durata minima a MP3-ului final; pragul coboara singur pentru texte foarte scurte.
MIN_FINAL_DURATION_SEC = float(os.getenv("MIN_FINAL_DURATION_SEC", "0.15"))
# Daca Edge pica (retea, eroare temporara), reincearca acelasi text cu gTTS cand e activat.
TTS_FALLBACK_GTTS = os.getenv("TTS_FALLBACK_GTTS", "true").strip().lower() in (
    "1",
    "true",
    "yes",
    "",
)


def chunk_text(text: str, max_size: int) -> list[str]:
    """
    Taie dupa paragrafe duble cand se poate; daca un paragraf intrece max_size, il fragmentam fix.
    Ajuta la a trimite bucati rezonabile catre Gemini fara sa taiem propozitii la mijloc cand e evitabil.
    """
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_size:
        return [text]

    chunks: list[str] = []
    buf: list[str] = []
    buf_len = 0
    parts = re.split(r"(\n\s*\n)", text)
    for i in range(0, len(parts), 2):
        para = parts[i]
        sep = parts[i + 1] if i + 1 < len(parts) else ""
        piece = para + sep

        if len(piece) > max_size:
            if buf:
                chunks.append("".join(buf))
                buf = []
                buf_len = 0
            for j in range(0, len(piece), max_size):
                chunks.append(piece[j : j + max_size])
            continue

        if buf_len + len(piece) <= max_size:
            buf.append(piece)
            buf_len += len(piece)
        else:
            if buf:
                chunks.append("".join(buf))
            buf = [piece]
            buf_len = len(piece)

    if buf:
        chunks.append("".join(buf))
    return [c for c in chunks if c.strip()]


def _prompt_curata_fragment(index: int, total: int, fragment: str) -> str:
    return f"""Ești editor pentru cărți audio. Acesta este fragmentul {index} din {total} ale unui text extras de pe web.
Extrage DOAR narativul / conținutul de citit; elimină meniuri, reclame, numere de pagină, boilerplate de site.
Nu scrie titluri de tip „Fragmentul {index}” sau explicații. Returnează strict textul curat al acestui fragment.

---
{fragment}
---
"""


def _gemini_safe_text(raspuns) -> str:
    """Extrage .text din raspunsul Gemini; la orice problema intoarce sir gol in loc sa ridice."""
    try:
        t = (raspuns.text or "").strip()
        return t
    except Exception:
        return ""


def curata_text_cu_gemini(model, text_brut: str) -> str:
    """
    Fiecare chunk primeste acelasi tip de instructiuni (scoate reclame, meniuri etc.).
    Daca avem un singur chunk, un singur apel; altfel ThreadPoolExecutor cu plafon GEMINI_WORKERS.
    La esec pe un fragment pastram textul brut al bucatii ca sa nu pierdem cartea intreaga.
    """
    text_brut = (text_brut or "").strip()
    if not text_brut:
        return ""

    chunks = chunk_text(text_brut, GEMINI_CHUNK_CHARS)
    if len(chunks) == 1:
        prompt = _prompt_curata_fragment(1, 1, chunks[0])
        r = model.generate_content(prompt)
        out = _gemini_safe_text(r)
        return out if out else chunks[0]

    def one(idx: int, frag: str) -> tuple[int, str]:
        p = _prompt_curata_fragment(idx + 1, len(chunks), frag)
        try:
            r = model.generate_content(p)
            cleaned = _gemini_safe_text(r)
            return idx, cleaned if cleaned else frag
        except Exception:
            return idx, frag

    results: list[str | None] = [None] * len(chunks)
    with ThreadPoolExecutor(max_workers=min(GEMINI_WORKERS, len(chunks))) as ex:
        futs = [ex.submit(one, i, c) for i, c in enumerate(chunks)]
        for f in as_completed(futs):
            i, s = f.result()
            results[i] = s

    return "\n\n".join(s for s in results if s)


def sanitize_text_pentru_tts(text: str) -> str:
    """Inlatura caractere de control (in afara de newline/tab) si NUL ca motorul TTS sa nu crape."""
    text = text.replace("\x00", " ")
    out: list[str] = []
    for ch in text:
        cat = unicodedata.category(ch)
        if cat == "Cc" and ch not in "\n\t\r":
            out.append(" ")
        else:
            out.append(ch)
    s = "".join(out)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def chunk_text_for_tts(text: str, max_size: int) -> list[str]:
    """Imparte la limite apropiate de max_size, cu preferinta pentru spatiu ca punct de taiere."""
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_size:
        return [text]

    out: list[str] = []
    start = 0
    n = len(text)
    while start < n:
        end = min(start + max_size, n)
        if end < n:
            cut = text.rfind(" ", start + max_size // 2, end)
            if cut <= start:
                cut = end
            end = cut
        piece = text[start:end].strip()
        if piece:
            out.append(piece)
        start = end if end > start else n
    return out


def _chunk_hard_for_gtts(text: str, max_size: int) -> list[str]:
    """
    Cand textul nu are spatii, bucla din chunk_text_for_tts ar putea bloca; aici taiem mecanic la max_size.
    """
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_size:
        return [text]
    return [text[i : i + max_size] for i in range(0, len(text), max_size)]


def _este_fisier_mp3_valid(path: str) -> bool:
    if not os.path.isfile(path) or os.path.getsize(path) < MIN_MP3_PART_BYTES:
        return False
    with open(path, "rb") as f:
        head = f.read(4)
    if len(head) < 2:
        return False
    if head[:3] == b"ID3":
        return True
    # Semnatura de frame MPEG-1/2 Layer III (nu e parser complet, doar verificare rapida).
    if head[0] == 0xFF and (head[1] & 0xE0) == 0xE0:
        return True
    return False


def _durata_mp3_ms(path: str) -> int:
    from pydub import AudioSegment

    seg = AudioSegment.from_mp3(path)
    return int(len(seg))


def _gtts_e_rate_limit(err: BaseException) -> bool:
    try:
        from gtts import gTTSError

        if isinstance(err, gTTSError):
            rsp = getattr(err, "rsp", None)
            if rsp is not None and getattr(rsp, "status_code", None) == 429:
                return True
    except Exception:
        pass
    s = str(err).lower()
    return "429" in s or "too many requests" in s


def _gtts_o_singur_subfragment(text: str, path: str) -> None:
    """Un singur apel scurt catre gTTS; la 429 dormim exponential pana la GTTS_RETRIES incercari."""
    from gtts import gTTS

    text = text.strip()
    if not text:
        raise ValueError("Sub-fragment gTTS gol.")

    last_err: Exception | None = None
    for attempt in range(GTTS_RETRIES):
        try:
            if os.path.isfile(path):
                os.remove(path)
        except OSError:
            pass
        try:
            gTTS(text=text, lang="ro", slow=False, lang_check=False).save(path)
            if not _este_fisier_mp3_valid(path):
                raise RuntimeError("Răspuns gTTS nu pare MP3 valid (prea mic sau HTML eroare).")
            ms = _durata_mp3_ms(path)
            if ms <= 0:
                raise RuntimeError("Segment audio are durată 0.")
            return
        except Exception as e:
            last_err = e
            if _gtts_e_rate_limit(e):
                # Google limiteaza rafalele; backoff mai agresiv decat la erori obisnuite.
                pause = min(120.0, GTTS_429_BASE_SLEEP_SEC * (2**attempt))
                time.sleep(pause)
            else:
                time.sleep(min(3.0, 0.5 * (attempt + 1)))
    raise RuntimeError(
        f"gTTS a eșuat după {GTTS_RETRIES} încercări (~{len(text)} caractere). Ultima eroare: {last_err}"
    ) from last_err


def _salveaza_fragment_gtts(chunk: str, path: str) -> None:
    """
    Impartim chunk-ul in sub-bucati mici, generam cate un MP3 per bucata, apoi le lipim.
    Fara asta, un singur save() pe text lung bombardeaza API-ul si primesti 429.
    """
    chunk = chunk.strip()
    if not chunk:
        raise ValueError("Fragment TTS gol.")

    sub_parts = chunk_text_for_tts(chunk, GTTS_SAFE_CHARS)
    if not sub_parts:
        raise ValueError("Nu s-au putut tăia sub-fragmente gTTS.")
    # Daca tot ramane bucata prea lunga (fara spatii), o spargem fortat.
    flat: list[str] = []
    for p in sub_parts:
        if len(p) <= GTTS_SAFE_CHARS:
            flat.append(p)
        else:
            flat.extend(_chunk_hard_for_gtts(p, GTTS_SAFE_CHARS))
    sub_parts = [x for x in flat if x.strip()]

    tmpdir = tempfile.mkdtemp(prefix="gtts_sub_")
    sub_paths: list[str] = []
    try:
        for i, sub in enumerate(sub_parts):
            sp = os.path.join(tmpdir, f"s{i}.mp3")
            _gtts_o_singur_subfragment(sub, sp)
            sub_paths.append(sp)
            if GTTS_INTER_PART_DELAY_SEC > 0 and i < len(sub_parts) - 1:
                time.sleep(GTTS_INTER_PART_DELAY_SEC)

        if len(sub_paths) == 1:
            try:
                if os.path.isfile(path):
                    os.remove(path)
            except OSError:
                pass
            shutil.copy2(sub_paths[0], path)
        else:
            try:
                if os.path.isfile(path):
                    os.remove(path)
            except OSError:
                pass
            _concat_mp3_files(sub_paths, path)

        if not _este_fisier_mp3_valid(path):
            raise RuntimeError("gTTS: fișierul concatenat nu pare MP3 valid.")
        ms = _durata_mp3_ms(path)
        if ms <= 0:
            raise RuntimeError("Segment audio are durată 0.")
    finally:
        for p in sub_paths:
            try:
                if os.path.isfile(p):
                    os.remove(p)
            except OSError:
                pass
        try:
            os.rmdir(tmpdir)
        except OSError:
            pass


def _run_coroutine_in_fresh_loop(coro) -> None:
    """
    edge-tts e async; in context FastAPI avem deja un loop pe firul principal, deci nu putem asyncio.run().
    Pornim un fir nou, loop nou, rulam coroutine-ul pana la capat si asteptam rezultatul.
    """
    import asyncio

    def _worker() -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(coro)
        finally:
            try:
                loop.close()
            except Exception:
                pass

    with ThreadPoolExecutor(max_workers=1) as pool:
        pool.submit(_worker).result(timeout=max(900, EDGE_TTS_RECEIVE_TIMEOUT + 180))


def _salveaza_fragment_edge(chunk: str, path: str) -> None:
    """Sintetizare prin serviciul Edge: de regula mai putine surprize decat gTTS pe texte lungi."""
    import edge_tts
    from edge_tts.exceptions import NoAudioReceived

    chunk = chunk.strip()
    if not chunk:
        raise ValueError("Fragment TTS gol.")

    voice = EDGE_TTS_VOICE or "ro-RO-AlinaNeural"
    last_err: Exception | None = None

    for attempt in range(GTTS_RETRIES):
        try:
            if os.path.isfile(path):
                os.remove(path)
        except OSError:
            pass
        try:

            async def _save() -> None:
                com = edge_tts.Communicate(
                    chunk,
                    voice=voice,
                    receive_timeout=EDGE_TTS_RECEIVE_TIMEOUT,
                    connect_timeout=EDGE_TTS_CONNECT_TIMEOUT,
                )
                await com.save(path)

            _run_coroutine_in_fresh_loop(_save())
            if not _este_fisier_mp3_valid(path):
                raise RuntimeError("Edge TTS: fișierul nu pare MP3 valid.")
            ms = _durata_mp3_ms(path)
            if ms <= 0:
                raise RuntimeError("Segment audio are durată 0.")
            return
        except NoAudioReceived as e:
            last_err = e
            time.sleep(min(3.0, 1.0 * (attempt + 1)))
        except Exception as e:
            last_err = e
            time.sleep(min(2.0, 0.6 * (attempt + 1)))
    raise RuntimeError(
        f"Edge TTS a eșuat după {GTTS_RETRIES} încercări (~{len(chunk)} caractere, voce {voice}). "
        f"Ultima eroare: {last_err}"
    ) from last_err


def _salveaza_fragment(chunk: str, path: str) -> None:
    """Dispatcheaza catre Edge sau gTTS; la Edge + fallback activ, incearca gTTS daca prima incercare pica."""
    if TTS_ENGINE == "gtts":
        _salveaza_fragment_gtts(chunk, path)
        return
    if TTS_ENGINE not in ("edge", ""):
        raise RuntimeError(f"TTS_ENGINE necunoscut: {TTS_ENGINE!r}. Folosește 'edge' sau 'gtts'.")
    try:
        _salveaza_fragment_edge(chunk, path)
    except Exception as e:
        if not TTS_FALLBACK_GTTS:
            raise
        print(f"[TTS] Edge a eșuat pentru un fragment, folosesc gTTS: {e}")
        _salveaza_fragment_gtts(chunk, path)


def synthesize_ro_to_mp3_path(text: str) -> str:
    """
    Intoarce calea catre un fisier temporar .mp3. Intern: sanitize, taiere la TTS_MAX_CHARS,
    sintetizare per fragment (cu pauza TTS_DELAY_SEC), lipire cu ffmpeg sau pydub.
    """
    text = sanitize_text_pentru_tts((text or "").strip())
    if not text:
        raise ValueError("Text gol pentru TTS.")

    parts = chunk_text_for_tts(text, TTS_MAX_CHARS)
    if not parts:
        raise ValueError("Nu s-au putut împărți fragmente pentru TTS.")

    tmpdir = tempfile.mkdtemp(prefix="tts_parts_")
    part_paths: list[str] = []

    def genereaza_toate_secvential() -> None:
        for i, chunk in enumerate(parts):
            p = os.path.join(tmpdir, f"p{i}.mp3")
            _salveaza_fragment(chunk, p)
            part_paths.append(p)
            if TTS_DELAY_SEC > 0 and i < len(parts) - 1:
                time.sleep(TTS_DELAY_SEC)

    def genereaza_paralel_limitat() -> None:
        """Folosit doar cand motorul e gTTS si ai marit GTTS_WORKERS in cunostinta de cauza."""

        def synth(ic: tuple[int, str]) -> tuple[int, str]:
            i, chunk = ic
            p = os.path.join(tmpdir, f"p{i}.mp3")
            _salveaza_fragment_gtts(chunk, p)
            return i, p

        with ThreadPoolExecutor(max_workers=min(GTTS_WORKERS, len(parts))) as ex:
            ordered = list(ex.map(synth, enumerate(parts)))
        ordered.sort(key=lambda x: x[0])
        part_paths.extend(p for _, p in ordered)

    try:
        if TTS_ENGINE == "gtts" and GTTS_WORKERS > 1:
            genereaza_paralel_limitat()
        else:
            # Cazul fericit: un fragment dupa altul, cel mai predictibil pentru Edge si pentru gTTS default.
            genereaza_toate_secvential()

        if len(parts) == 1:
            single = part_paths[0]
            out_path = os.path.join(tempfile.gettempdir(), f"tts_{int(time.time() * 1000)}.mp3")
            try:
                shutil.copy2(single, out_path)
            except OSError:
                _concat_mp3_files([single], out_path)
        else:
            out_path = os.path.join(tempfile.gettempdir(), f"tts_merged_{int(time.time() * 1000)}.mp3")
            _concat_mp3_files(part_paths, out_path)

        _assert_mp3_final_valid(out_path, len(text))
        return out_path
    finally:
        for p in part_paths:
            try:
                if os.path.isfile(p):
                    os.remove(p)
            except OSError:
                pass
        try:
            os.rmdir(tmpdir)
        except OSError:
            pass


def _ffprobe_duration_sec(path: str) -> float | None:
    """Citeste duration din ffprobe -show_entries format=duration; None daca unealta lipseste."""
    exe = shutil.which("ffprobe")
    if not exe:
        return None
    try:
        sub_kw: dict = {"capture_output": True, "text": True, "timeout": 120}
        if os.name == "nt":
            sub_kw["creationflags"] = subprocess.CREATE_NO_WINDOW
        r = subprocess.run(
            [
                exe,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                path,
            ],
            **sub_kw,
        )
        if r.returncode != 0:
            return None
        data = json.loads(r.stdout or "{}")
        d = (data.get("format") or {}).get("duration")
        return float(d) if d is not None else None
    except (OSError, ValueError, json.JSONDecodeError, subprocess.TimeoutExpired):
        return None


def _assert_mp3_final_valid(out_path: str, approx_source_chars: int) -> None:
    if not os.path.isfile(out_path):
        raise RuntimeError("Fișierul MP3 final lipsește după concatenare.")
    sz = os.path.getsize(out_path)
    if sz < MIN_FINAL_MP3_BYTES:
        raise RuntimeError(
            f"MP3 final prea mic ({sz} octeți). Verifică gTTS / rețeaua sau mărește pauza GTTS_DELAY_SEC."
        )
    dur = _ffprobe_duration_sec(out_path)
    if dur is None:
        return
    # Nu cerem aceeasi durata minima pentru o propozitie scurta ca pentru un roman intreg.
    if approx_source_chars < 400:
        min_dur = 0.05
    elif approx_source_chars < 2500:
        min_dur = max(0.08, MIN_FINAL_DURATION_SEC * 0.5)
    else:
        min_dur = MIN_FINAL_DURATION_SEC
    if dur < min_dur:
        raise RuntimeError(
            f"MP3 final are durată prea mică ({dur:.2f}s, minim {min_dur:.2f}s pentru ~{approx_source_chars} caractere). "
            "Verifică ffmpeg/ffprobe și concatenarea."
        )


def _concat_mp3_files(paths: list[str], out_path: str) -> None:
    """Primul incercam demuxer-ul ffmpeg (stream copy); daca nu exista ffmpeg, incarcam tot in pydub."""
    if not paths:
        raise RuntimeError("Nu există segmente MP3 de concatenat.")
    if len(paths) == 1:
        shutil.copy2(paths[0], out_path)
        return

    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        _concat_mp3_ffmpeg_demuxer(ffmpeg, paths, out_path)
        return

    _concat_mp3_pydub_only(paths, out_path)


def _concat_mp3_ffmpeg_demuxer(ffmpeg_exe: str, paths: list[str], out_path: str) -> None:
    """Genereaza lista de fisiere pentru -f concat -safe 0; calea e escapata pentru apostrofuri."""
    list_fd, list_path = tempfile.mkstemp(suffix=".ffconcat.txt")
    try:
        os.close(list_fd)
        with open(list_path, "w", encoding="utf-8", newline="\n") as lf:
            for raw in paths:
                ap = Path(raw).resolve().as_posix()
                ap_esc = ap.replace("'", "'\\''")
                lf.write(f"file '{ap_esc}'\n")

        def run_concat(extra_args: list[str]) -> subprocess.CompletedProcess[str]:
            cmd = [
                ffmpeg_exe,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                list_path,
                *extra_args,
                out_path,
            ]
            sub_kw: dict = {"capture_output": True, "text": True, "timeout": 7200}
            if os.name == "nt":
                sub_kw["creationflags"] = subprocess.CREATE_NO_WINDOW
            return subprocess.run(cmd, **sub_kw)

        # Incercam mai intai remux fara re-encode (rapid); daca iese rau, reincercam cu lame.
        r = run_concat(["-c", "copy"])
        if (
            r.returncode != 0
            or not os.path.isfile(out_path)
            or os.path.getsize(out_path) < MIN_FINAL_MP3_BYTES
        ):
            try:
                if os.path.isfile(out_path):
                    os.remove(out_path)
            except OSError:
                pass
            r2 = run_concat(["-c:a", "libmp3lame", "-b:a", "128k"])
            if r2.returncode != 0:
                err = (r2.stderr or r.stderr or "ffmpeg concat").strip()
                raise RuntimeError(
                    "ffmpeg nu a putut concatena segmentele MP3. "
                    "Încearcă același sample rate pe toate segmentele sau verifică ffmpeg. "
                    f"Detalii: {err[:800]}"
                )
    finally:
        try:
            os.unlink(list_path)
        except OSError:
            pass


def _concat_mp3_pydub_only(paths: list[str], out_path: str) -> None:
    """Plan B: incarca fiecare segment in AudioSegment si exporta; consuma mult RAM pe carti uriase."""
    try:
        from pydub import AudioSegment
    except ImportError as e:
        raise RuntimeError(
            "Lipsește ffmpeg în PATH și pydub. Instalează ffmpeg sau: pip install pydub"
        ) from e

    try:
        combined = AudioSegment.empty()
        for p in paths:
            combined += AudioSegment.from_mp3(p)
        combined.export(out_path, format="mp3")
    except Exception as e:
        raise RuntimeError(
            "Concatenare pydub eșuată (cărți lungi: folosește ffmpeg în PATH). Detalii: " + str(e)
        ) from e
