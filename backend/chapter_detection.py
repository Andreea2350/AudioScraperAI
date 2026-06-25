"""
Cand un text e foarte lung (o carte intreaga), nu vreau un playlist cu zeci de "parti" anonime,
ci unul organizat pe capitole. Aici detectez capitolele uitandu-ma la liniile care arata a titlu
("Capitolul 3", "Chapter 5" etc.). Daca textul e mic sau nu are structura, il tratez ca un singur bloc.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass

# Peste atatea caractere trec din modul "parti" in modul "capitole".
# Minimul de 10.000 e o plasa de siguranta ca sa nu cobor pragul absurd din variabila de mediu.
BOOK_MODE_CHAR_THRESHOLD = max(
    10_000, int(os.getenv("BOOK_MODE_CHAR_THRESHOLD", "50000"))
)

# Expresia regulata care recunoaste un rand de tip titlu de capitol, in romana si engleza.
# Ordinea alternativelor conteaza: pun tiparele mai specifice inaintea celor generale.
_CHAPTER_LINE = re.compile(
    r"^(?:"
    r"(?:capitol(?:ul)?|partea|part)\s*(?:[ivxlc\d]+|\d+)"  # Capitol/Capitolul/Partea/Part + numar (roman sau arab)
    r"|chapter\s+\d+"                                        # Chapter 12
    r"|chapitre\s+\d+"                                       # Chapitre 12 (franceza, ca bonus)
    r"|book\s+\d+"                                           # Book 2
    r"|section\s+\d+"                                        # Section 4
    r"|\d{1,3}\s*[\.\)]\s+[A-ZĂÂÎȘȚÄÖÜ][\w\s\-'’]{2,60}"     # "3. Titlu Cu Majuscula"
    r")"
    r"[\s\.:\-–—]*"  # eventuale separatoare dupa numar (punct, doua puncte, liniuta)
    r"(.*)$",         # restul randului = titlul propriu-zis
    re.IGNORECASE | re.UNICODE,
)


@dataclass
class ChapterSlice:
    """Un capitol detectat: pozitia lui in ordine, titlul si textul care ii apartine."""
    index: int
    title: str
    text: str


def _clean_line(line: str) -> str:
    """Strang spatiile multiple dintr-un titlu intr-unul singur si tai marginile."""
    return re.sub(r"\s+", " ", (line or "").strip())


def detect_chapters(text: str) -> list[ChapterSlice]:
    """
    Impart textul in capitole dupa liniile care par titluri. Daca gasesc sub doua titluri,
    consider ca textul n-are structura clara si il intorc ca un singur capitol.
    """
    text = (text or "").strip()
    if not text:
        return []

    # Parcurg textul linie cu linie si retin unde incepe fiecare antet de capitol.
    lines = text.split("\n")
    headers: list[tuple[int, str, str]] = []
    offset = 0  # pozitia in caractere a inceputului liniei curente
    for line in lines:
        stripped = line.strip()
        if stripped:
            m = _CHAPTER_LINE.match(stripped)
            # Cer ca linia sa fie scurta (<120), altfel probabil e un paragraf normal, nu un titlu.
            if m and len(stripped) < 120:
                title_bit = _clean_line(m.group(0))
                headers.append((offset, title_bit, stripped))
        # Avansez offset-ul cu lungimea liniei + 1 pentru newline-ul scos de split.
        offset += len(line) + 1

    # Prea putine titluri (0 sau 1): nu am structura, deci tot textul = un capitol.
    if len(headers) < 2:
        return [ChapterSlice(0, "Capitol 1", text)]

    # Tai textul intre fiecare antet si urmatorul.
    slices: list[ChapterSlice] = []
    for i, (start, title, _raw) in enumerate(headers):
        # Capitolul tine pana la inceputul urmatorului antet (sau pana la final, pentru ultimul).
        end = headers[i + 1][0] if i + 1 < len(headers) else len(text)
        body = text[start:end].strip()
        if not body:
            continue
        slices.append(ChapterSlice(len(slices), title, body))

    # Daca, in mod ciudat, n-a iesit niciun capitol cu continut, ma intorc la varianta cu un singur bloc.
    if not slices:
        return [ChapterSlice(0, "Capitol 1", text)]
    return slices


def playlist_mode_for_length(char_count: int) -> str:
    """Decid modul playlistului in functie de lungime: 'chapters' pentru carti, 'parts' pentru restul."""
    return "chapters" if char_count >= BOOK_MODE_CHAR_THRESHOLD else "parts"
