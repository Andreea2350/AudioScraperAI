"""
Aici se ocupa codul de cartile lungi. Ideea de baza: nu pot trimite un roman intreg
nici la Gemini (loveste plafonul de iesire), nici la motorul TTS dintr-o singura bucata.
Asa ca tai textul brut in bucati, le curat (optional) cu Gemini, apoi fiecare bucata
trece prin TTS si la final lipesc toate MP3-urile intr-un singur fisier.

Motorul TTS implicit e Microsoft Edge (pachetul edge-tts), care suna natural; pot comuta
pe gTTS (Google, neoficial) printr-o variabila de mediu, dar acela e mai sensibil la rate limit.

Variabile utile (toate optionale, citite din mediu):
  TTS_ENGINE          edge sau gtts
  EDGE_TTS_VOICE      ex. ro-RO-AlinaNeural
  GEMINI_CHUNK_CHARS  cat text brut intra intr-un apel Gemini (default 4500)
  GEMINI_WORKERS      cate fire paralele la curatare (default 4)
  TTS_MAX_CHARS       lungime maxima a unui fragment citit la microfon (default 2800)
  TTS_DELAY_SEC       pauza intre fragmente mari (reduce presiunea pe servicii)
  GTTS_WORKERS        la gTTS, paralelismul ridica risc de 429; default 1
  GTTS_SAFE_CHARS     sub aceasta lungime tinem fiecare apel gTTS (Google face multe POST-uri mici)
  GTTS_INTER_PART_DELAY_SEC   pauza intre aceste mini-apeluri in cadrul aceluiasi chunk

La final lipesc MP3-urile cu ffmpeg concat (nu incarca tot audio-ul cartii in RAM). pydub e folosit
mai mult la verificarea duratei pe fisier si ca plan B daca ffmpeg lipseste.
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
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

# Toate constantele de mai jos sunt "reglaje" pe care le pot schimba din variabile de mediu
# fara sa umblu in cod. Pun mereu o valoare implicita rezonabila si o limita minima de siguranta.

# Cat text brut bag intr-un singur apel Gemini. Daca pun prea mult, raspunsul se taie.
GEMINI_CHUNK_CHARS = max(1000, int(os.getenv("GEMINI_CHUNK_CHARS", "4500")))
# Cate bucati curat in paralel la Gemini. Mai multe = mai rapid, dar consum mai mare.
GEMINI_WORKERS = max(1, int(os.getenv("GEMINI_WORKERS", "4")))
# edge = voce neurala prin serviciul Edge; gtts = varianta neoficiala Google (mai sensibila la rate limit).
TTS_ENGINE = (os.getenv("TTS_ENGINE") or "edge").strip().lower()
# Vocea Edge implicita (feminina, romana). UI-ul poate trimite alta, asta e doar fallback.
EDGE_TTS_VOICE = os.getenv("EDGE_TTS_VOICE", "ro-RO-AlinaNeural").strip()
# Timeout mare pe citirea WebSocket de la Edge: altfel se rupe descarcarea pe bucati lungi de audio.
EDGE_TTS_RECEIVE_TIMEOUT = int(os.getenv("EDGE_TTS_RECEIVE_TIMEOUT", "600"))
EDGE_TTS_CONNECT_TIMEOUT = int(os.getenv("EDGE_TTS_CONNECT_TIMEOUT", "30"))
# Lungimea maxima a unui fragment trimis la TTS. Sub 500 n-are sens, deci pun o podea.
TTS_MAX_CHARS = max(500, int(os.getenv("TTS_MAX_CHARS", os.getenv("GTTS_MAX_CHARS", "2800"))))
# La gTTS, mai multe fire duc des la 429 si fisiere goale; implicit merg strict unul dupa altul.
GTTS_WORKERS = max(1, int(os.getenv("GTTS_WORKERS", "1")))
# Cate reincercari fac pe un fragment inainte sa renunt (valabil si la Edge, refolosesc constanta).
GTTS_RETRIES = max(1, int(os.getenv("GTTS_RETRIES", "8")))
# Pauza intre fragmente, ca sa nu bombardez serviciul TTS.
TTS_DELAY_SEC = float(os.getenv("TTS_DELAY_SEC", os.getenv("GTTS_DELAY_SEC", "0.25")))
# Un singur .save() gTTS poate declansa zeci de POST-uri scurte; tin bucatile sub prag si pun pauze.
GTTS_SAFE_CHARS = max(40, min(100, int(os.getenv("GTTS_SAFE_CHARS", "95"))))
GTTS_INTER_PART_DELAY_SEC = float(os.getenv("GTTS_INTER_PART_DELAY_SEC", "0.6"))
# Cat dorm la prima eroare 429 de la gTTS (creste exponential la fiecare incercare).
GTTS_429_BASE_SLEEP_SEC = float(os.getenv("GTTS_429_BASE_SLEEP_SEC", "4.0"))
# Sub atatia octeti, consider ca un MP3 de segment e gol/corupt.
MIN_MP3_PART_BYTES = int(os.getenv("MIN_MP3_PART_BYTES", "400"))
# Sub atatia octeti, consider ca MP3-ul final e gresit (sinteza a esuat in tacere).
MIN_FINAL_MP3_BYTES = int(os.getenv("MIN_FINAL_MP3_BYTES", "1200"))
# Durata minima a MP3-ului final; pragul coboara singur pentru texte foarte scurte (vezi _assert_mp3_final_valid).
MIN_FINAL_DURATION_SEC = float(os.getenv("MIN_FINAL_DURATION_SEC", "0.15"))
# Daca Edge pica (retea, eroare temporara), reincerc acelasi text cu gTTS cand asta e activat.
# Accept mai multe forme de "adevarat", inclusiv string gol (adica implicit pornit).
TTS_FALLBACK_GTTS = os.getenv("TTS_FALLBACK_GTTS", "true").strip().lower() in (
    "1",
    "true",
    "yes",
    "",
)


def _find_best_cut(text: str, start: int, end: int) -> int:
    """
    Caut un loc "frumos" de taiere intre start si end: ideal la sfarsit de propozitie,
    iar daca nu gasesc, macar la un spatiu, ca sa nu rup un cuvant la jumatate.
    """
    # Nu depasesc lungimea textului.
    end = min(end, len(text))
    if end <= start:
        return end
    # Caut doar in a doua jumatate a ferestrei, ca sa nu retez prea devreme si sa pierd text.
    window_start = start + max((end - start) // 2, 1)
    best = start
    # Prefer terminatii de propozitie (punct, exclamare, intrebare, puncte de suspensie).
    for sep in (". ", "! ", "? ", "… "):
        pos = text.rfind(sep, window_start, end)
        if pos > start:
            best = max(best, pos + len(sep))
    # Daca am gasit o terminatie de propozitie, o folosesc.
    if best > start:
        return best
    # Altfel ma multumesc cu ultimul spatiu din fereastra.
    cut = text.rfind(" ", window_start, end)
    if cut <= start:
        # Nici spatiu? Tai brut la end (caz rar, text fara spatii).
        cut = end
    return cut


def chunk_text(text: str, max_size: int) -> list[str]:
    """
    Taie textul in bucati de cel mult max_size caractere, incercand sa rupa la paragrafe.
    Daca un singur paragraf e mai mare decat max_size, il sparg fortat (dar tot pe granite naturale).
    Folosit ca sa trimit la Gemini bucati rezonabile fara sa tai fraze cand pot evita.
    """
    text = text.strip()
    if not text:
        return []
    # Daca tot textul incape, il intorc ca o singura bucata.
    if len(text) <= max_size:
        return [text]

    chunks: list[str] = []
    buf: list[str] = []   # acumulez paragrafe pana ating max_size
    buf_len = 0
    # Sparg pe paragrafe duble (linie goala), pastrand separatorii ca sa nu pierd formatarea.
    parts = re.split(r"(\n\s*\n)", text)
    # Merg din 2 in 2 pentru ca lista alterneaza: paragraf, separator, paragraf, separator...
    for i in range(0, len(parts), 2):
        para = parts[i]
        sep = parts[i + 1] if i + 1 < len(parts) else ""
        piece = para + sep

        # Caz special: paragraful singur depaseste max_size -> trebuie spart bucata cu bucata.
        if len(piece) > max_size:
            # Intai golesc ce aveam adunat in buffer.
            if buf:
                chunks.append("".join(buf))
                buf = []
                buf_len = 0
            pos = 0
            while pos < len(piece):
                chunk_end = min(pos + max_size, len(piece))
                # Daca nu sunt la final, caut o taietura frumoasa in loc sa rup brutal.
                if chunk_end < len(piece):
                    chunk_end = _find_best_cut(piece, pos, chunk_end)
                    if chunk_end <= pos:
                        chunk_end = min(pos + max_size, len(piece))
                chunks.append(piece[pos:chunk_end])
                pos = chunk_end
            continue

        # Caz normal: incape in bufferul curent -> il adaug.
        if buf_len + len(piece) <= max_size:
            buf.append(piece)
            buf_len += len(piece)
        else:
            # Nu mai incape: inchei bucata curenta si incep una noua cu acest paragraf.
            if buf:
                chunks.append("".join(buf))
            buf = [piece]
            buf_len = len(piece)

    # Golesc ce a ramas in buffer la final.
    if buf:
        chunks.append("".join(buf))
    # Arunc eventualele bucati goale.
    return [c for c in chunks if c.strip()]


def count_chars_for_generation(text: str) -> int:
    """Cate caractere are textul DUPA curatarea de control chars; pe asta calculez creditele si limitele."""
    return len(sanitize_text_pentru_tts((text or "").strip()))


def estimate_tts_segment_count(text: str) -> int:
    # Estimez cate segmente vor iesi, ca sa pot arata o bara de progres realista in UI inainte sa incep.
    t = sanitize_text_pentru_tts((text or "").strip())
    if not t:
        return 0
    return len(chunk_text_for_tts(t, TTS_MAX_CHARS))


def prepare_text_for_audio(
    text: str,
    gemini_model=None,
    *,
    use_gemini: bool = True,
    check_cancel: Callable[[], None] | None = None,
) -> str:
    """
    Pregateste textul pentru TTS: intai sanitize (scoate gunoiul), apoi optional curatare cu Gemini.
    Daca nu am model Gemini sau use_gemini e False, intorc doar textul sanitizat.
    """
    # Verific anularea la fiecare pas care poate dura.
    if check_cancel is not None:
        check_cancel()
    text = sanitize_text_pentru_tts((text or "").strip())
    if not text:
        return ""
    if use_gemini and gemini_model is not None:
        if check_cancel is not None:
            check_cancel()
        cleaned = curata_text_cu_gemini(gemini_model, text, check_cancel=check_cancel)
        if check_cancel is not None:
            check_cancel()
        # Daca din vreun motiv curatarea iese goala, ma intorc la textul sanitizat (mai bine ceva decat nimic).
        return cleaned if cleaned else text
    return text


def _prompt_curata_fragment(index: int, total: int, fragment: str) -> str:
    # Promptul prin care ii spun lui Gemini sa pastreze doar continutul de citit si sa arunce reclamele/meniurile.
    return f"""Ești editor pentru cărți audio. Acesta este fragmentul {index} din {total} ale unui text extras de pe web.
Extrage DOAR narativul / conținutul de citit; elimină meniuri, reclame, numere de pagină, boilerplate de site.
Nu scrie titluri de tip „Fragmentul {index}” sau explicații. Returnează strict textul curat al acestui fragment.

---
{fragment}
---
"""


def _gemini_safe_text(raspuns) -> str:
    """Scot .text din raspunsul Gemini; daca ceva e in neregula, intorc string gol in loc sa crap tot procesul."""
    try:
        t = (raspuns.text or "").strip()
        return t
    except Exception:
        return ""


def curata_text_cu_gemini(model, text_brut: str, check_cancel: Callable[[], None] | None = None) -> str:
    """
    Curat textul cu Gemini. Daca incape intr-un singur chunk, fac un singur apel.
    Daca sunt mai multe, le trimit in paralel (cu plafon GEMINI_WORKERS).
    Daca un fragment esueaza, pastrez textul brut al lui ca sa nu pierd toata cartea.
    """
    if check_cancel is not None:
        check_cancel()
    text_brut = (text_brut or "").strip()
    if not text_brut:
        return ""

    chunks = chunk_text(text_brut, GEMINI_CHUNK_CHARS)
    # Cazul simplu: o singura bucata, un singur apel Gemini.
    if len(chunks) == 1:
        if check_cancel is not None:
            check_cancel()
        prompt = _prompt_curata_fragment(1, 1, chunks[0])
        r = model.generate_content(prompt)
        out = _gemini_safe_text(r)
        if check_cancel is not None:
            check_cancel()
        return out if out else chunks[0]

    # Mai multe bucati: le curat in paralel ca sa nu astept secvential.
    def one(idx: int, frag: str) -> tuple[int, str]:
        # Functie rulata pe fiecare fir; intoarce indexul ca sa pot reordona dupa.
        if check_cancel is not None:
            check_cancel()
        p = _prompt_curata_fragment(idx + 1, len(chunks), frag)
        try:
            r = model.generate_content(p)
            cleaned = _gemini_safe_text(r)
            return idx, cleaned if cleaned else frag
        except Exception:
            # Daca pica un fragment, pastrez varianta bruta a lui.
            return idx, frag

    # Pregatesc o lista de rezultate pe care o umplu dupa index, ca sa pastrez ordinea originala.
    results: list[str | None] = [None] * len(chunks)
    with ThreadPoolExecutor(max_workers=min(GEMINI_WORKERS, len(chunks))) as ex:
        futs = [ex.submit(one, i, c) for i, c in enumerate(chunks)]
        for f in as_completed(futs):
            if check_cancel is not None:
                check_cancel()
            i, s = f.result()
            results[i] = s

    # Reasamblez textul curatat, despartit pe paragrafe.
    return "\n\n".join(s for s in results if s)


# Listele de mai jos sunt cuvinte frecvente in engleza/romana, folosite ca sa ghicesc limba unui text
# atunci cand vreau sa generez rezumatul in aceeasi limba ca sursa.
_EN_SUMMARY_STOP = (
    "the", "and", "of", "to", "in", "that", "was", "for", "with", "his", "he", "as",
    "had", "not", "but", "at", "by", "from", "she", "they", "it", "is", "are", "have",
    "which", "or", "an", "their", "said", "her", "there", "would", "one", "all", "upon",
)
_RO_SUMMARY_STOP = (
    "și", "de", "în", "cu", "este", "sau", "din", "pentru", "nu",
    "fi", "fost", "erau", "avea", "după", "prin", "că", "să",
)
# Varianta fara diacritice, pentru texte romanesti scrise fara ă/â/î/ș/ț.
_RO_SUMMARY_STOP_ASCII = (
    "si", "este", "sau", "din", "pentru", "fost", "erau", "avea", "intr", "acest", "aceasta",
)


def _alpha_density(chunk: str) -> float:
    # Cat la suta din bucata sunt litere (vs cifre/simboluri). Folosit ca sa evit zgomotul de PDF.
    if not chunk:
        return 0.0
    letters = sum(1 for c in chunk if c.isalpha())
    return letters / len(chunk)


def _readable_samples_for_language(text: str, window: int = 8000, max_windows: int = 5) -> list[str]:
    """Aleg cateva ferestre din text cu cele mai multe litere (cea mai "curata" zona pentru detectarea limbii)."""
    text = text.strip()
    if not text:
        return []
    # Daca textul e scurt, il iau intreg.
    if len(text) <= window:
        return [text]
    # Ma plimb prin text cu un pas calculat ca sa adun cateva ferestre candidate.
    stride = max(1, (len(text) - window) // max(max_windows * 6, 1))
    ranked: list[tuple[float, int]] = []
    for start in range(0, len(text) - window + 1, stride):
        # Pentru fiecare fereastra retin densitatea de litere si pozitia de start.
        ranked.append((_alpha_density(text[start : start + window]), start))
    # Sortez descrescator dupa densitate ca sa iau ferestrele cele mai "textuale".
    ranked.sort(reverse=True)
    samples: list[str] = []
    used: set[int] = set()
    for _, start in ranked:
        if start in used:
            continue
        used.add(start)
        samples.append(text[start : start + window])
        if len(samples) >= max_windows:
            break
    # Daca n-am gasit nimic, iau inceputul si sfarsitul.
    if not samples:
        samples = [text[:window], text[-window:]]
    return samples


def _language_score_sample(sample: str) -> tuple[int, int, int]:
    # Numar cate cuvinte tipice EN/RO apar si cate diacritice; pe baza lor decid limba.
    s = (sample or "").lower()
    en = sum(len(re.findall(rf"\b{w}\b", s)) for w in _EN_SUMMARY_STOP)
    ro = sum(len(re.findall(rf"\b{w}\b", s)) for w in _RO_SUMMARY_STOP)
    ro += sum(len(re.findall(rf"\b{w}\b", s)) for w in _RO_SUMMARY_STOP_ASCII)
    # Diacriticele romanesti sunt un semnal puternic ca textul e in romana.
    ro_chars = sum(s.count(c) for c in "ăâîșț")
    return en, ro, ro_chars


def _normalize_summary_language_hint(hint: str | None) -> str | None:
    # Daca UI-ul imi spune explicit limba ("en"/"ro"), o normalizez la "English"/"Romanian".
    h = (hint or "").strip().lower()
    if h in ("en", "english", "eng"):
        return "English"
    if h in ("ro", "romanian", "romana", "română", "romana"):
        return "Romanian"
    return None


def _detect_language_langdetect(text: str) -> str | None:
    """Daca am biblioteca langdetect, o folosesc pe ferestrele lizibile ca sa detectez en/ro."""
    try:
        from langdetect import LangDetectException, detect
    except ImportError:
        # Daca nu e instalata, sar peste si las celelalte metode sa decida.
        return None
    samples = _readable_samples_for_language(text)
    blob = "\n".join(samples)[:60000].strip()
    # Sub 80 de caractere detectarea e nesigura, deci renunt.
    if len(blob) < 80:
        return None
    try:
        code = detect(blob)
    except LangDetectException:
        return None
    if code == "en":
        return "English"
    if code == "ro":
        return "Romanian"
    return None


def _infer_summary_output_language(text: str) -> str | None:
    """Plan de rezerva pentru detectarea limbii: numar cuvinte/diacritice EN vs RO si decid."""
    text = (text or "").strip()
    if not text:
        return None
    samples = _readable_samples_for_language(text)
    total_en = total_ro = total_ro_chars = 0
    for sample in samples:
        en, ro, ro_chars = _language_score_sample(sample)
        total_en += en
        total_ro += ro
        total_ro_chars += ro_chars
    # Daca am destule cuvinte englezesti si depasesc romana, zic English.
    if total_en >= 5 and total_en >= total_ro:
        return "English"
    # Diacriticele sau cuvintele romanesti suficiente -> Romanian.
    if total_ro_chars >= 3 or (total_ro >= 5 and total_ro > total_en):
        return "Romanian"
    return None


def _looks_like_english_text(text: str) -> bool:
    return resolve_summary_output_language(text) == "English"


def _looks_like_romanian_text(text: str) -> bool:
    return resolve_summary_output_language(text) == "Romanian"


def resolve_summary_output_language(text: str, hint: str | None = None) -> str | None:
    # Ordinea de incredere: 1) ce zice UI-ul explicit, 2) langdetect, 3) euristica mea de numarat cuvinte.
    explicit = _normalize_summary_language_hint(hint)
    if explicit:
        return explicit
    detected = _detect_language_langdetect(text)
    if detected:
        return detected
    return _infer_summary_output_language(text)


def _summary_looks_romanian(summary: str) -> bool:
    # Verific daca un rezumat GENERAT pare romanesc (ca sa prind cazul cand Gemini a iesit pe limba gresita).
    s = (summary or "").lower()
    if any(c in s for c in "ăâîșț"):
        return True
    markers = (
        " rezumat", " rezumatul", " cartea", " personaj", " este ", " sunt ", " care ",
        " acest", " aceast", " aceasta", " într", " romanul", " povestea", " lui ",
        " într-o", " într-un", " despre ", " dintre ",
    )
    return sum(1 for m in markers if m in s) >= 2


def _summary_looks_english(summary: str) -> bool:
    # Acelasi lucru, dar pentru engleza. Daca are diacritice romanesti, clar nu e engleza.
    s = (summary or "").lower()
    if any(c in s for c in "ăâîșț"):
        return False
    en_hits = sum(len(re.findall(rf"\b{w}\b", s)) for w in ("the", "and", "of", "to", "in", "that", "with", "his", "story"))
    return en_hits >= 4


def _rezumat_language_block(lang: str | None) -> str:
    # Bucata de prompt care ii impune lui Gemini limba in care sa scrie rezumatul.
    if lang == "English":
        return (
            "OUTPUT LANGUAGE (mandatory): Write the entire summary in English only. "
            "Every sentence must be in English. Do not use Romanian."
        )
    if lang == "Romanian":
        return (
            "OUTPUT LANGUAGE (mandatory): Write the entire summary in Romanian only. "
            "Every sentence must be in Romanian."
        )
    # Daca nu stiu limba, ii cer sa pastreze limba sursei.
    return (
        "OUTPUT LANGUAGE (mandatory): Write in the same language as the source text. "
        "Do not translate. Do not default to Romanian unless the source is Romanian."
    )


def _prompt_rezumat_fragment(index: int, total: int, fragment: str, lang: str | None) -> str:
    # Prompt pentru rezumatul partial al unui fragment (cand cartea e prea mare pentru un singur apel).
    lang_block = _rezumat_language_block(lang)
    return f"""Summarize this excerpt ({index} of {total}) from a longer text.

Write 3-6 sentences with the main ideas.

{lang_block}

No headings, no "Fragment {index}", no meta-commentary — only the summary.

---
{fragment}
---
"""


def _prompt_rezumat_final(partiale: list[str], lang: str | None) -> str:
    # Prompt care lipeste rezumatele partiale intr-unul singur, coerent.
    bullets = "\n".join(f"• {p}" for p in partiale if p.strip())
    lang_block = _rezumat_language_block(lang)
    rewrite = ""
    if lang:
        # Daca stiu limba, ii cer explicit sa rescrie totul in limba aia (partialele pot fi pe limbi diferite).
        rewrite = (
            f"\nThe partial summaries below may be in the wrong language. "
            f"Rewrite and merge them into one summary written entirely in {lang}.\n"
        )
    return f"""Merge these partial summaries into one coherent summary of 150-250 words.

{lang_block}{rewrite}
No title — only 1-3 clear paragraphs.

---
{bullets}
---
"""


def _prompt_rezumat_scurt(text: str, lang: str | None) -> str:
    # Prompt pentru cazul simplu: textul incape intr-un singur apel, cer direct rezumatul.
    lang_block = _rezumat_language_block(lang)
    return f"""Summarize the text below in 150-250 words (or proportionally if very short).

{lang_block}

No title, no preamble — only the summary.

---
{text}
---
"""


def _gemini_summary_generate(model, prompt: str, lang: str | None) -> str:
    """Apelez Gemini pentru rezumat. Daca stiu limba, ii dau un system instruction care o fixeaza dur."""
    system: str | None = None
    if lang == "English":
        system = (
            "You write book summaries. Always respond in English only. "
            "Never use Romanian, even if the user message is in Romanian."
        )
    elif lang == "Romanian":
        system = "You write book summaries. Always respond in Romanian only."
    if system:
        try:
            from google import generativeai as genai

            # Creez un model nou cu instructiunea de sistem (forteaza limba mai bine decat doar promptul).
            summary_model = genai.GenerativeModel(model.model_name, system_instruction=system)
            return _gemini_safe_text(summary_model.generate_content(prompt))
        except Exception:
            # Daca nu merge varianta cu system instruction, cad pe apelul normal.
            pass
    return _gemini_safe_text(model.generate_content(prompt))


def rezuma_text_cu_gemini(
    model,
    text: str,
    check_cancel: Callable[[], None] | None = None,
    output_language_hint: str | None = None,
) -> str:
    """
    Genereaza un rezumat textual al cartii. E complet separat de audio: nu reface MP3-ul,
    deci e ieftin si rapid. Pentru texte mari rezum bucata cu bucata, apoi imbin rezumatele.
    """
    if check_cancel is not None:
        check_cancel()
    if model is None:
        return ""
    text = (text or "").strip()
    if not text:
        return ""

    # Aleg limba in care scriu rezumatul (din hint sau detectata din text).
    output_lang = resolve_summary_output_language(text, output_language_hint)

    def generate(prompt: str) -> str:
        # Mic helper ca sa nu repet limba la fiecare apel.
        return _gemini_summary_generate(model, prompt, output_lang)

    # Text mic: un singur apel, gata.
    if len(text) <= 15000:
        if check_cancel is not None:
            check_cancel()
        out = generate(_prompt_rezumat_scurt(text[:50000], output_lang))
        if check_cancel is not None:
            check_cancel()
        # Daca a iesit pe limba gresita, mai incerc o data (vezi _maybe_retry...).
        return _maybe_retry_summary_language(generate, text[:50000], out, output_lang, check_cancel)

    chunks = chunk_text(text, GEMINI_CHUNK_CHARS)
    # Daca taierea a dat tot o singura bucata, tratez ca text mic.
    if len(chunks) == 1:
        if check_cancel is not None:
            check_cancel()
        out = generate(_prompt_rezumat_scurt(chunks[0], output_lang))
        if check_cancel is not None:
            check_cancel()
        return _maybe_retry_summary_language(generate, chunks[0], out, output_lang, check_cancel)

    # Carte mare: rezum fiecare bucata in paralel, apoi imbin partialele.
    def one(idx: int, frag: str) -> tuple[int, str]:
        if check_cancel is not None:
            check_cancel()
        p = _prompt_rezumat_fragment(idx + 1, len(chunks), frag, output_lang)
        try:
            cleaned = generate(p)
            return idx, cleaned if cleaned else ""
        except Exception:
            return idx, ""

    partials: list[str | None] = [None] * len(chunks)
    with ThreadPoolExecutor(max_workers=min(GEMINI_WORKERS, len(chunks))) as ex:
        futs = [ex.submit(one, i, c) for i, c in enumerate(chunks)]
        for f in as_completed(futs):
            if check_cancel is not None:
                check_cancel()
            i, s = f.result()
            partials[i] = s

    # Pastrez doar rezumatele partiale care au iesit cu ceva.
    partiale_ok = [s for s in partials if s]
    if not partiale_ok:
        return ""
    # Daca a iesit un singur partial, ala e rezumatul (cu verificarea de limba).
    if len(partiale_ok) == 1:
        return _maybe_retry_summary_language(
            generate,
            chunks[0] if chunks else text[:50000],
            partiale_ok[0],
            output_lang,
            check_cancel,
        )

    # Imbin toate partialele intr-un rezumat final unitar.
    if check_cancel is not None:
        check_cancel()
    out = generate(_prompt_rezumat_final(partiale_ok, output_lang))
    if check_cancel is not None:
        check_cancel()
    # Daca imbinarea esueaza, lipesc pur si simplu partialele.
    if not out:
        out = "\n\n".join(partiale_ok)
    return _maybe_retry_summary_language(
        lambda p: generate(p),
        "\n\n".join(partiale_ok[:3]),
        out,
        output_lang,
        check_cancel,
    )


def _maybe_retry_summary_language(
    generate: Callable[[str], str],
    source_sample: str,
    summary: str,
    lang: str | None,
    check_cancel: Callable[[], None] | None,
) -> str:
    """Daca rezumatul a iesit clar pe alta limba decat trebuia, il regenerez o singura data cu insistenta."""
    if not summary:
        return summary
    # Daca nu stiam limba dorita, o ghicesc din sursa.
    effective_lang = lang
    if not effective_lang and _looks_like_english_text(source_sample):
        effective_lang = "English"
    elif not effective_lang and _looks_like_romanian_text(source_sample):
        effective_lang = "Romanian"
    if not effective_lang:
        return summary
    # "wrong" = voiam engleza dar a iesit romaneste (sau invers).
    wrong = (
        effective_lang == "English"
        and _summary_looks_romanian(summary)
        and not _summary_looks_english(summary)
    ) or (
        effective_lang == "Romanian"
        and _summary_looks_english(summary)
        and not _summary_looks_romanian(summary)
    )
    if not wrong:
        return summary
    if check_cancel is not None:
        check_cancel()
    # Reincerc cu un prompt strict si un memento in plus despre limba.
    strict = _prompt_rezumat_scurt(source_sample[:12000], effective_lang)
    retry = generate(strict + "\n\nREMINDER: Output language is mandatory as specified above.")
    # Daca reincercarea da ceva, o folosesc; altfel pastrez rezumatul initial.
    return retry if retry.strip() else summary


def sanitize_text_pentru_tts(text: str) -> str:
    """Scot caracterele de control (mai putin newline/tab) si NUL, ca motorul TTS sa nu se inece cu ele."""
    # NUL il inlocuiesc explicit cu spatiu (poate aparea din extrageri PDF urate).
    text = text.replace("\x00", " ")
    out: list[str] = []
    for ch in text:
        cat = unicodedata.category(ch)
        # "Cc" = caracter de control. Pastrez doar newline/tab/carriage return, restul devin spatiu.
        if cat == "Cc" and ch not in "\n\t\r":
            out.append(" ")
        else:
            out.append(ch)
    s = "".join(out)
    # Strang spatiile/taburile multiple intr-unul singur.
    s = re.sub(r"[ \t]+", " ", s)
    # Maxim doua linii goale consecutive (evit gauri uriase intre paragrafe).
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def chunk_text_for_tts(text: str, max_size: int) -> list[str]:
    """Taie textul in fragmente aproape de max_size pentru TTS, preferand spatiul ca loc de taiere."""
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
        # Daca nu sunt la final, caut o taietura frumoasa.
        if end < n:
            end = _find_best_cut(text, start, end)
            if end <= start:
                end = min(start + max_size, n)
        piece = text[start:end].strip()
        if piece:
            out.append(piece)
        # Avansez; daca cumva end nu a crescut, sar direct la final ca sa nu intru in bucla infinita.
        start = end if end > start else n
    return out


def _chunk_hard_for_gtts(text: str, max_size: int) -> list[str]:
    """
    Plan de avarie pentru gTTS: cand textul n-are spatii deloc, taierea "frumoasa" s-ar putea bloca,
    asa ca tai mecanic la fix max_size caractere.
    """
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_size:
        return [text]
    return [text[i : i + max_size] for i in range(0, len(text), max_size)]


def _este_fisier_mp3_valid(path: str) -> bool:
    # Verificare rapida: fisierul exista, are dimensiune rezonabila si incepe cu o semnatura MP3.
    if not os.path.isfile(path) or os.path.getsize(path) < MIN_MP3_PART_BYTES:
        return False
    with open(path, "rb") as f:
        head = f.read(4)
    if len(head) < 2:
        return False
    # "ID3" = tag de metadate la inceputul MP3-ului.
    if head[:3] == b"ID3":
        return True
    # Semnatura de frame MPEG-1/2 Layer III (nu e parser complet, doar verificare rapida).
    if head[0] == 0xFF and (head[1] & 0xE0) == 0xE0:
        return True
    return False


def _durata_mp3_ms(path: str) -> int:
    """Durata in milisecunde: incerc ffprobe, apoi pydub, iar la final estimez din marimea fisierului."""
    dur_sec = _ffprobe_duration_sec(path)
    if dur_sec is not None and dur_sec > 0:
        return int(dur_sec * 1000)
    try:
        from pydub import AudioSegment

        ms = int(len(AudioSegment.from_mp3(path)))
        if ms > 0:
            return ms
    except Exception:
        pass
    # Ultima solutie: daca fisierul pare MP3 valid, estimez durata din numarul de octeti.
    if _este_fisier_mp3_valid(path):
        sz = os.path.getsize(path)
        if sz >= MIN_MP3_PART_BYTES:
            # Estimare conservatoare (~64 kbps) ca sa trec validarea chiar fara ffmpeg instalat.
            return max(500, sz // 8)
    raise RuntimeError(
        "Nu pot citi durata MP3 (instalează ffmpeg în PATH sau verifică fișierul generat)."
    )


def _gtts_e_rate_limit(err: BaseException) -> bool:
    # Verific daca eroarea de la gTTS e de fapt un 429 (prea multe cereri), ca sa stiu sa astept mai mult.
    try:
        from gtts import gTTSError

        if isinstance(err, gTTSError):
            rsp = getattr(err, "rsp", None)
            if rsp is not None and getattr(rsp, "status_code", None) == 429:
                return True
    except Exception:
        pass
    # Daca nu pot inspecta obiectul, caut "429" in textul erorii.
    s = str(err).lower()
    return "429" in s or "too many requests" in s


def _gtts_o_singur_subfragment(text: str, path: str) -> None:
    """Un singur apel scurt catre gTTS. La 429 dorm exponential, pana la GTTS_RETRIES incercari."""
    from gtts import gTTS

    text = text.strip()
    if not text:
        raise ValueError("Sub-fragment gTTS gol.")

    last_err: Exception | None = None
    for attempt in range(GTTS_RETRIES):
        # Sterg eventualul fisier de la incercarea anterioara ca sa nu raman cu unul corupt.
        try:
            if os.path.isfile(path):
                os.remove(path)
        except OSError:
            pass
        try:
            # lang_check=False ca sa nu mai faca un apel in plus de validare a limbii.
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
                # Google ne limiteaza rafalele; backoff mai agresiv decat la erori obisnuite (max 2 minute).
                pause = min(120.0, GTTS_429_BASE_SLEEP_SEC * (2**attempt))
                time.sleep(pause)
            else:
                # Eroare obisnuita: pauza scurta crescatoare.
                time.sleep(min(3.0, 0.5 * (attempt + 1)))
    raise RuntimeError(
        f"gTTS a eșuat după {GTTS_RETRIES} încercări (~{len(text)} caractere). Ultima eroare: {last_err}"
    ) from last_err


def _salveaza_fragment_gtts(chunk: str, path: str) -> None:
    """
    gTTS pe text lung primeste 429, asa ca sparg fragmentul in sub-bucati mici, generez cate un MP3
    pentru fiecare si la final le lipesc. Mai lent, dar mult mai stabil.
    """
    chunk = chunk.strip()
    if not chunk:
        raise ValueError("Fragment TTS gol.")

    sub_parts = chunk_text_for_tts(chunk, GTTS_SAFE_CHARS)
    if not sub_parts:
        raise ValueError("Nu s-au putut tăia sub-fragmente gTTS.")
    # Daca vreo sub-bucata tot e prea lunga (text fara spatii), o sparg fortat.
    flat: list[str] = []
    for p in sub_parts:
        if len(p) <= GTTS_SAFE_CHARS:
            flat.append(p)
        else:
            flat.extend(_chunk_hard_for_gtts(p, GTTS_SAFE_CHARS))
    sub_parts = [x for x in flat if x.strip()]

    # Lucrez intr-un director temporar dedicat ca sa nu amestec fisierele.
    tmpdir = tempfile.mkdtemp(prefix="gtts_sub_")
    sub_paths: list[str] = []
    try:
        for i, sub in enumerate(sub_parts):
            sp = os.path.join(tmpdir, f"s{i}.mp3")
            _gtts_o_singur_subfragment(sub, sp)
            sub_paths.append(sp)
            # Pauza intre mini-apeluri ca sa nu starnesc rate limit-ul.
            if GTTS_INTER_PART_DELAY_SEC > 0 and i < len(sub_parts) - 1:
                time.sleep(GTTS_INTER_PART_DELAY_SEC)

        # O singura sub-bucata: doar copiez fisierul.
        if len(sub_paths) == 1:
            try:
                if os.path.isfile(path):
                    os.remove(path)
            except OSError:
                pass
            shutil.copy2(sub_paths[0], path)
        else:
            # Mai multe: le concatenez.
            try:
                if os.path.isfile(path):
                    os.remove(path)
            except OSError:
                pass
            _concat_mp3_files(sub_paths, path)

        # Verific ca rezultatul final chiar e un MP3 valid si are durata.
        if not _este_fisier_mp3_valid(path):
            raise RuntimeError("gTTS: fișierul concatenat nu pare MP3 valid.")
        ms = _durata_mp3_ms(path)
        if ms <= 0:
            raise RuntimeError("Segment audio are durată 0.")
    finally:
        # Curat sub-fisierele si directorul temporar, indiferent daca a mers sau nu.
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
    edge-tts e async, dar in FastAPI exista deja un event loop pe firul principal, deci nu pot
    pur si simplu asyncio.run(). Solutia: pornesc un fir nou, cu loop nou, si rulez coroutine-ul acolo.
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

    # Astept rezultatul cu un timeout generos (corelat cu timeout-ul de receive de la Edge).
    with ThreadPoolExecutor(max_workers=1) as pool:
        pool.submit(_worker).result(timeout=max(900, EDGE_TTS_RECEIVE_TIMEOUT + 180))


def _tts_config_from_env():
    """Construiesc o configuratie TTS din variabilele de mediu (folosita cand UI-ul nu trimite o voce)."""
    try:
        from tts_voices import DEFAULT_EDGE_VOICE, TtsConfig
    except ModuleNotFoundError:
        from backend.tts_voices import DEFAULT_EDGE_VOICE, TtsConfig
    # Daca TTS_ENGINE e ceva ciudat, ma intorc la "edge".
    engine = TTS_ENGINE if TTS_ENGINE in ("edge", "gtts", "") else "edge"
    return TtsConfig(
        engine=engine or "edge",
        edge_voice=EDGE_TTS_VOICE or DEFAULT_EDGE_VOICE,
        allow_fallback=TTS_FALLBACK_GTTS,
    )


def _salveaza_fragment_edge(chunk: str, path: str, *, voice: str | None = None) -> None:
    """Sintetizez un fragment prin serviciul Edge. De regula da mai putine batai de cap decat gTTS pe text lung."""
    import edge_tts
    from edge_tts.exceptions import NoAudioReceived

    chunk = chunk.strip()
    if not chunk:
        raise ValueError("Fragment TTS gol.")

    try:
        from tts_voices import DEFAULT_EDGE_VOICE
    except ModuleNotFoundError:
        from backend.tts_voices import DEFAULT_EDGE_VOICE
    # Aleg vocea: cea ceruta, apoi cea din mediu, apoi cea implicita.
    voice = (voice or EDGE_TTS_VOICE or DEFAULT_EDGE_VOICE).strip()
    last_err: Exception | None = None

    for attempt in range(GTTS_RETRIES):
        try:
            if os.path.isfile(path):
                os.remove(path)
        except OSError:
            pass
        try:

            async def _save() -> None:
                # Communicate face conexiunea WebSocket cu serviciul Edge si descarca audio-ul.
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
            # Edge a raspuns dar fara audio; reincerc dupa o pauza scurta.
            last_err = e
            time.sleep(min(3.0, 1.0 * (attempt + 1)))
        except Exception as e:
            last_err = e
            time.sleep(min(2.0, 0.6 * (attempt + 1)))
    raise RuntimeError(
        f"Edge TTS a eșuat după {GTTS_RETRIES} încercări (~{len(chunk)} caractere, voce {voice}). "
        f"Ultima eroare: {last_err}"
    ) from last_err


def _salveaza_fragment(chunk: str, path: str, *, tts=None) -> None:
    """Decide ce motor folosesc (Edge sau gTTS) si, daca Edge pica si e permis, cade pe gTTS."""
    cfg = tts or _tts_config_from_env()
    # Daca config-ul cere explicit gTTS, merg direct pe el.
    if cfg.engine == "gtts":
        _salveaza_fragment_gtts(chunk, path)
        return
    # Orice altceva in afara de "edge"/gol e o greseala de configurare.
    if cfg.engine not in ("edge", ""):
        raise RuntimeError(f"TTS_ENGINE necunoscut: {cfg.engine!r}. Folosește 'edge' sau 'gtts'.")
    try:
        _salveaza_fragment_edge(chunk, path, voice=cfg.edge_voice)
    except Exception as e:
        # Daca fallback-ul nu e permis, las eroarea sa urce.
        if not cfg.allow_fallback:
            raise
        print(f"[TTS] Edge a esuat pentru un fragment, folosesc gTTS: {e}")
        _salveaza_fragment_gtts(chunk, path)


def synthesize_preview_bytes(text: str, tts_config) -> bytes:
    """Generez un MP3 scurt direct in memorie, pentru butonul de previzualizare a vocii din UI."""
    text = sanitize_text_pentru_tts((text or "").strip())
    if not text:
        raise ValueError("Text gol pentru previzualizare TTS.")
    # Fisier temporar pe disc, apoi il citesc in memorie si il sterg.
    fd, path = tempfile.mkstemp(suffix=".mp3", prefix="tts_preview_")
    os.close(fd)
    try:
        _salveaza_fragment(text, path, tts=tts_config)
        with open(path, "rb") as f:
            blob = f.read()
        if len(blob) < 256:
            raise RuntimeError("Previzualizarea audio a esuat (fisier prea mic).")
        return blob
    finally:
        try:
            if os.path.isfile(path):
                os.remove(path)
        except OSError:
            pass


@dataclass
class TtsSegmentResult:
    # Un segment TTS gata sintetizat: ce loc are in playlist, textul lui si calea catre MP3-ul temporar.
    index: int     # al catelea segment e
    total: int     # cate segmente sunt in total
    text: str      # textul citit in acest segment
    mp3_path: str  # fisierul audio temporar al acestui segment


def synthesize_ro_with_segments(
    text: str,
    on_segment_complete: Callable[[TtsSegmentResult], None] | None = None,
    tts_config=None,
    check_cancel: Callable[[], None] | None = None,
) -> tuple[str, list[TtsSegmentResult]]:
    """
    Functia centrala de sinteza: imparte textul in fragmente, le trece prin TTS, anunta fiecare segment gata
    (prin on_segment_complete, ca sa apara in playlistul live) si la final lipeste totul intr-un MP3.
    Intoarce calea MP3-ului final si lista de segmente.
    """
    if check_cancel is not None:
        check_cancel()
    text = sanitize_text_pentru_tts((text or "").strip())
    if not text:
        raise ValueError("Text gol pentru TTS.")

    parts = chunk_text_for_tts(text, TTS_MAX_CHARS)
    if not parts:
        raise ValueError("Nu s-au putut împărți fragmente pentru TTS.")

    cfg = tts_config or _tts_config_from_env()

    # Director temporar pentru MP3-urile de segment.
    tmpdir = tempfile.mkdtemp(prefix="tts_parts_")
    part_paths: list[str] = []
    segments: list[TtsSegmentResult] = []
    total = len(parts)

    def genereaza_toate_secvential() -> None:
        # Varianta sigura: un fragment pe rand, cu pauza intre ele.
        for i, chunk in enumerate(parts):
            if check_cancel is not None:
                check_cancel()
            p = os.path.join(tmpdir, f"p{i}.mp3")
            _salveaza_fragment(chunk, p, tts=cfg)
            part_paths.append(p)
            seg = TtsSegmentResult(index=i, total=total, text=chunk, mp3_path=p)
            segments.append(seg)
            # Anunt callback-ul (asta declanseaza evenimentul SSE catre playlist).
            if on_segment_complete is not None:
                on_segment_complete(seg)
            if TTS_DELAY_SEC > 0 and i < len(parts) - 1:
                time.sleep(TTS_DELAY_SEC)

    def genereaza_paralel_limitat() -> None:
        # Varianta paralela (doar pentru gTTS cu GTTS_WORKERS > 1): sintetizez mai multe deodata.
        if check_cancel is not None:
            check_cancel()

        def synth(ic: tuple[int, str]) -> tuple[int, str]:
            i, chunk = ic
            p = os.path.join(tmpdir, f"p{i}.mp3")
            _salveaza_fragment(chunk, p, tts=cfg)
            return i, p

        with ThreadPoolExecutor(max_workers=min(GTTS_WORKERS, len(parts))) as ex:
            ordered = list(ex.map(synth, enumerate(parts)))
        if check_cancel is not None:
            check_cancel()
        # Reordonez dupa index ca segmentele sa ramana in ordinea textului.
        ordered.sort(key=lambda x: x[0])
        for i, chunk in enumerate(parts):
            p = next(pth for idx, pth in ordered if idx == i)
            part_paths.append(p)
            seg = TtsSegmentResult(index=i, total=total, text=chunk, mp3_path=p)
            segments.append(seg)
            if on_segment_complete is not None:
                on_segment_complete(seg)

    try:
        # gTTS: paralel limitat daca am cerut mai multe fire; altfel mereu secvential (si pentru Edge).
        if cfg.engine == "gtts" and GTTS_WORKERS > 1:
            genereaza_paralel_limitat()
        else:
            genereaza_toate_secvential()

        if check_cancel is not None:
            check_cancel()

        # Un singur segment: il copiez direct ca fisier final; mai multe: le concatenez.
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

        # Verific ca MP3-ul final chiar are continut (marime + durata).
        _assert_mp3_final_valid(out_path, len(text))
        return out_path, segments
    finally:
        # Curat fisierele de segment si directorul temporar (MP3-ul final e in alta parte, ramane).
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


def synthesize_ro_to_mp3_path(text: str, tts_config=None) -> str:
    """
    Varianta simpla cand nu ma intereseaza segmentele, doar MP3-ul final.
    Practic deleaga la synthesize_ro_with_segments si arunc lista de segmente.
    """
    out_path, _segments = synthesize_ro_with_segments(text, tts_config=tts_config)
    return out_path


_FFMPEG_EXE_CACHE: str | None | bool = False


def _resolve_ffmpeg_exe() -> str | None:
    """Caut ffmpeg in PATH; daca lipseste (ex. Vercel), folosesc binarul din imageio-ffmpeg."""
    global _FFMPEG_EXE_CACHE
    if _FFMPEG_EXE_CACHE is not False:
        return _FFMPEG_EXE_CACHE or None
    exe = shutil.which("ffmpeg")
    if not exe:
        try:
            import imageio_ffmpeg

            exe = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            exe = None
    if exe and os.path.isfile(exe):
        _FFMPEG_EXE_CACHE = exe
    else:
        _FFMPEG_EXE_CACHE = None
    return _FFMPEG_EXE_CACHE


def _duration_via_ffmpeg_probe(ffmpeg_exe: str, path: str) -> float | None:
    """Durata MP3 parsata din stderr-ul lui ffmpeg -i (fallback cand ffprobe lipseste)."""
    try:
        sub_kw: dict = {"capture_output": True, "text": True, "timeout": 120}
        if os.name == "nt":
            sub_kw["creationflags"] = subprocess.CREATE_NO_WINDOW
        r = subprocess.run(
            [ffmpeg_exe, "-hide_banner", "-i", path, "-f", "null", "-"],
            **sub_kw,
        )
        m = re.search(
            r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)",
            (r.stderr or "") + (r.stdout or ""),
        )
        if not m:
            return None
        h, mi, s = m.groups()
        return int(h) * 3600 + int(mi) * 60 + float(s)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None


def _id3v2_header_size(data: bytes) -> int:
    if len(data) < 10 or data[:3] != b"ID3":
        return 0
    tag_size = (
        ((data[6] & 0x7F) << 21)
        | ((data[7] & 0x7F) << 14)
        | ((data[8] & 0x7F) << 7)
        | (data[9] & 0x7F)
    )
    return 10 + tag_size


def _mp3_bytes_for_concat(path: str, *, first: bool) -> bytes:
    """Pregatesc payload-ul MP3 pentru lipire binara (fara re-encode)."""
    with open(path, "rb") as f:
        data = f.read()
    if not data:
        raise RuntimeError(f"Segment MP3 gol: {path}")
    if first:
        if len(data) >= 128 and data[-128:-125] == b"TAG":
            data = data[:-128]
        return data
    data = data[_id3v2_header_size(data) :]
    if len(data) >= 128 and data[-128:-125] == b"TAG":
        data = data[:-128]
    if not data:
        raise RuntimeError(f"Segment MP3 invalid dupa curatare tag-uri: {path}")
    return data


def _concat_mp3_binary_append(paths: list[str], out_path: str) -> None:
    """Lipire binara a segmentelor MP3 (acelasi motor TTS). Nu necesita ffmpeg."""
    try:
        if os.path.isfile(out_path):
            os.remove(out_path)
    except OSError:
        pass
    with open(out_path, "wb") as out:
        for i, p in enumerate(paths):
            out.write(_mp3_bytes_for_concat(p, first=(i == 0)))


def _ffprobe_duration_sec(path: str) -> float | None:
    """Citesc durata fisierului cu ffprobe. Daca unealta nu e instalata, intorc None (nu e capital)."""
    exe = shutil.which("ffprobe")
    if not exe:
        ffmpeg = _resolve_ffmpeg_exe()
        if ffmpeg:
            return _duration_via_ffmpeg_probe(ffmpeg, path)
        return None
    try:
        sub_kw: dict = {"capture_output": True, "text": True, "timeout": 120}
        # Pe Windows ascund fereastra de consola care altfel ar clipi la fiecare apel.
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
    # Ma asigur ca MP3-ul final exista, nu e suspect de mic si are o durata plauzibila.
    if not os.path.isfile(out_path):
        raise RuntimeError("Fișierul MP3 final lipsește după concatenare.")
    sz = os.path.getsize(out_path)
    if sz < MIN_FINAL_MP3_BYTES:
        raise RuntimeError(
            f"MP3 final prea mic ({sz} octeți). Verifică gTTS / rețeaua sau mărește pauza GTTS_DELAY_SEC."
        )
    dur = _ffprobe_duration_sec(out_path)
    # Fara ffprobe nu pot verifica durata, deci ma opresc aici (am verificat deja marimea).
    if dur is None:
        return
    # Nu cer aceeasi durata minima pentru o propozitie scurta ca pentru un roman intreg.
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
    """Lipesc mai multe MP3-uri: ffmpeg, apoi lipire binara, apoi pydub."""
    if not paths:
        raise RuntimeError("Nu există segmente MP3 de concatenat.")
    # Un singur fisier: doar il copiez.
    if len(paths) == 1:
        shutil.copy2(paths[0], out_path)
        return

    errors: list[str] = []
    ffmpeg = _resolve_ffmpeg_exe()
    if ffmpeg:
        try:
            _concat_mp3_ffmpeg_demuxer(ffmpeg, paths, out_path)
            if os.path.isfile(out_path) and os.path.getsize(out_path) >= MIN_FINAL_MP3_BYTES:
                return
            errors.append("ffmpeg: fisier final prea mic sau lipsa")
        except RuntimeError as e:
            errors.append(str(e))
        try:
            if os.path.isfile(out_path):
                os.remove(out_path)
        except OSError:
            pass

    try:
        _concat_mp3_binary_append(paths, out_path)
        if (
            os.path.isfile(out_path)
            and os.path.getsize(out_path) >= MIN_FINAL_MP3_BYTES
            and _este_fisier_mp3_valid(out_path)
        ):
            return
        errors.append("binary: fisier final invalid")
    except Exception as e:
        errors.append(f"binary: {e}")
    try:
        if os.path.isfile(out_path):
            os.remove(out_path)
    except OSError:
        pass

    ffmpeg = _resolve_ffmpeg_exe()
    if ffmpeg:
        try:
            _concat_mp3_pydub_only(paths, out_path, ffmpeg_exe=ffmpeg)
            return
        except RuntimeError as e:
            errors.append(str(e))

    detail = "; ".join(errors)[:800] if errors else "metode esuate"
    raise RuntimeError(f"Nu s-au putut concatena segmentele MP3. Detalii: {detail}")


def _concat_mp3_ffmpeg_demuxer(ffmpeg_exe: str, paths: list[str], out_path: str) -> None:
    """Folosesc demuxer-ul 'concat' din ffmpeg: scriu o lista de fisiere intr-un .txt si o dau lui ffmpeg."""
    list_fd, list_path = tempfile.mkstemp(suffix=".ffconcat.txt")
    try:
        os.close(list_fd)
        with open(list_path, "w", encoding="utf-8", newline="\n") as lf:
            for raw in paths:
                # Calea trebuie in format posix si cu apostrofurile escapate, altfel ffmpeg se incurca.
                ap = Path(raw).resolve().as_posix()
                ap_esc = ap.replace("'", "'\\''")
                lf.write(f"file '{ap_esc}'\n")

        def run_concat(extra_args: list[str]) -> subprocess.CompletedProcess[str]:
            # Helper care ruleaza ffmpeg cu lista de fisiere; extra_args alege copy vs re-encode.
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

        # Intai incerc remux fara re-encode (-c copy), care e instant.
        r = run_concat(["-c", "copy"])
        # Daca a iesit rau (cod eroare sau fisier prea mic), reincerc cu re-encode prin lame.
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
        # Sterg fisierul-lista temporar.
        try:
            os.unlink(list_path)
        except OSError:
            pass


def _concat_mp3_pydub_only(paths: list[str], out_path: str, *, ffmpeg_exe: str | None = None) -> None:
    """Ultimul fallback: pydub + ffmpeg (re-encode). Consuma mai mult RAM pe carti mari."""
    try:
        from pydub import AudioSegment
    except ImportError as e:
        raise RuntimeError(
            "Lipsește pydub/audioop. Instalează: pip install pydub audioop-lts"
        ) from e

    ffmpeg_exe = ffmpeg_exe or _resolve_ffmpeg_exe()
    if ffmpeg_exe:
        AudioSegment.converter = ffmpeg_exe
        ffprobe = shutil.which("ffprobe")
        if ffprobe:
            AudioSegment.ffprobe = ffprobe

    try:
        combined = AudioSegment.empty()
        for p in paths:
            combined += AudioSegment.from_mp3(p)
        combined.export(out_path, format="mp3")
    except Exception as e:
        raise RuntimeError(
            "Concatenare pydub eșuată. Detalii: " + str(e)
        ) from e
