"""
Detectare capitole in texte lungi (carti, PDF extrase, articole structurate).
Folosesc modul capitole cand textul depaseste BOOK_MODE_CHAR_THRESHOLD.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass

# Pragul de caractere peste care trec din mod "parti" in mod "capitole"
BOOK_MODE_CHAR_THRESHOLD = max(
    10_000, int(os.getenv("BOOK_MODE_CHAR_THRESHOLD", "50000"))
)

# Regex pentru anteturi tip carte (RO + EN); ordinea conteaza (mai specific primele)
_CHAPTER_LINE = re.compile(
    r"^(?:"
    r"(?:capitol(?:ul)?|partea|part)\s*(?:[ivxlc\d]+|\d+)"
    r"|chapter\s+\d+"
    r"|chapitre\s+\d+"
    r"|book\s+\d+"
    r"|section\s+\d+"
    r"|\d{1,3}\s*[\.\)]\s+[A-ZĂÂÎȘȚÄÖÜ][\w\s\-'’]{2,60}"
    r")"
    r"[\s\.:\-–—]*"
    r"(.*)$",
    re.IGNORECASE | re.UNICODE,
)


@dataclass
class ChapterSlice:
    """Reprezinta un capitol detectat: index, titlu si textul asociat."""
    index: int
    title: str
    text: str


def _clean_line(line: str) -> str:
    """Normalizez spatiile dintr-o linie de titlu."""
    return re.sub(r"\s+", " ", (line or "").strip())


def detect_chapters(text: str) -> list[ChapterSlice]:
    """
    Impart textul in capitole dupa linii care arata ca titluri de capitol.
    Daca nu gasesc structura, intorc un singur capitol cu tot textul.
    """
    text = (text or "").strip()
    if not text:
        return []

    # Parcurg liniile si colectez pozitiile anteturilor de capitol
    lines = text.split("\n")
    headers: list[tuple[int, str, str]] = []
    offset = 0
    for line in lines:
        stripped = line.strip()
        if stripped:
            m = _CHAPTER_LINE.match(stripped)
            if m and len(stripped) < 120:
                title_bit = _clean_line(m.group(0))
                headers.append((offset, title_bit, stripped))
        offset += len(line) + 1

    # Prea putine anteturi => tratez totul ca un singur capitol
    if len(headers) < 2:
        return [ChapterSlice(0, "Capitol 1", text)]

    # Tai textul intre anteturi consecutive
    slices: list[ChapterSlice] = []
    for i, (start, title, _raw) in enumerate(headers):
        end = headers[i + 1][0] if i + 1 < len(headers) else len(text)
        body = text[start:end].strip()
        if not body:
            continue
        slices.append(ChapterSlice(len(slices), title, body))

    if not slices:
        return [ChapterSlice(0, "Capitol 1", text)]
    return slices


def playlist_mode_for_length(char_count: int) -> str:
    """Aleg modul playlist: capitole pentru texte foarte lungi, altfel parti."""
    return "chapters" if char_count >= BOOK_MODE_CHAR_THRESHOLD else "parts"
