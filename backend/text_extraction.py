"""
Aici scot textul din documentele incarcate de utilizator (TXT, PDF) si rezolv cateva belele
clasice: fisiere salvate cu encoding ciudat si PDF-uri romanesti vechi in care diacriticele
apar ca paranteze/simboluri (font fara mapare Unicode corecta). Pentru PDF-urile scanate,
pot apela un OCR (Gemini Vision) primit din afara ca functie.
"""
from __future__ import annotations

import io
import os
import re
from typing import Callable

# Cate pagini de PDF am voie sa trec prin OCR (Gemini Vision) la un document.
# OCR-ul costa timp si bani, deci pun o limita; restul paginilor raman goale in extract.
PDF_OCR_MAX_PAGES = max(0, int(os.getenv("PDF_OCR_MAX_PAGES", "50")))

# In multe PDF-uri romanesti vechi, fontul nu are mapare Unicode corecta, asa ca diacriticele
# ies ca simboluri. Tabelul asta traduce simbolul gresit inapoi in litera romaneasca corecta.
_LEGACY_RO_TRANSLATE = str.maketrans(
    {
        "[": "ă",
        "]": "î",
        "`": "â",
        "{": "ș",
        "}": "ț",
        "|": "Ă",
        "~": "Â",
        "^": "Î",
        "@": "Ș",
        "#": "Ț",
    }
)

# Un alt tipar de PDF stricat: "ț" apare ca backslash urmat de vocala (ex. "\a" in loc de "ța").
_LEGACY_RO_BACKSLASH_VOWEL = re.compile(r"\\([aeiouAEIOU])")


def needs_legacy_romanian_repair(text: str) -> bool:
    # Decid daca merita sa incerc repararea: textul prea scurt nu are sens sa-l ating.
    if not text or len(text) < 8:
        return False
    # Daca gasesc tiparul cu backslash + vocala, clar trebuie reparat.
    if _LEGACY_RO_BACKSLASH_VOWEL.search(text):
        return True
    # Sau daca gasesc un simbol "suspect" prins intre doua litere (semn ca era o diacritica).
    return bool(re.search(r"(?<=[A-Za-zÀ-ÿ])[\[\]`\{\}\|~^@#](?=[A-Za-zÀ-ÿ])", text))


def repair_legacy_romanian_diacritics(text: str) -> str:
    # Daca textul nu pare stricat, il las neatins (ca sa nu stric un text deja corect).
    if not text or not needs_legacy_romanian_repair(text):
        return text

    def _backslash_vowel(m: re.Match[str]) -> str:
        # Inlocuiesc "\vocala" cu "ț"/"Ț" + vocala, pastrand majuscula/minuscula.
        ch = m.group(1)
        if ch in "aeiou":
            return "ț" + ch
        return "Ț" + ch.lower()

    # Intai rezolv backslash-urile, apoi aplic tabelul de traducere a simbolurilor.
    out = _LEGACY_RO_BACKSLASH_VOWEL.sub(_backslash_vowel, text)
    return out.translate(_LEGACY_RO_TRANSLATE)


def decode_plain_text_bytes(raw: bytes) -> str:
    # Decodez un fisier text incercand mai multe encodinguri, in ordinea probabilitatii.
    # Daca incepe cu BOM-ul UTF-8, il sar si decodez direct UTF-8.
    if raw.startswith(b"\xef\xbb\xbf"):
        return raw[3:].decode("utf-8", errors="replace")
    # Incerc pe rand encodingurile uzuale pentru romana; ma opresc la primul care merge.
    for enc in ("utf-8", "cp1250", "iso-8859-2", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    # Daca niciunul nu a mers curat, fortez UTF-8 si inlocuiesc ce nu se poate decoda.
    return raw.decode("utf-8", errors="replace")


def _extract_pdf_pypdf(raw: bytes) -> tuple[list[str], str]:
    # Varianta de rezerva pentru PDF, cu pypdf (cand PyMuPDF nu e disponibil).
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(raw))
    parts: list[str] = []
    for page in reader.pages:
        t = page.extract_text() or ""
        # Daca extragerea normala nu da nimic, incerc modul "layout" (uneori prinde mai mult).
        if not (t and str(t).strip()):
            t = page.extract_text(extraction_mode="layout") or ""
        parts.append(t)
    return parts, "pypdf"


def _extract_pdf_pymupdf(
    raw: bytes,
    ocr_page: Callable[[bytes, int], str] | None = None,
) -> tuple[list[str], str, dict]:
    # Varianta principala pentru PDF, cu PyMuPDF (fitz). Tine si statistici despre pagini.
    import fitz

    # Metadatele astea ajung in UI ca sa arate cate pagini au avut text, cate au fost OCR-uite etc.
    meta = {
        "pages_with_text": 0,
        "pages_ocr": 0,
        "pages_empty": 0,
        "pages_ocr_skipped": 0,
        "ocr_max_pages": PDF_OCR_MAX_PAGES,
    }
    doc = fitz.open(stream=raw, filetype="pdf")
    parts: list[str] = []
    ocr_used = 0  # cate pagini am trecut deja prin OCR (ca sa nu depasesc limita)
    try:
        for i, page in enumerate(doc):
            t = (page.get_text("text") or "").strip()
            # Daca pagina n-are text si am OCR disponibil + mai am buget de pagini, incerc OCR.
            if not t and ocr_page is not None and PDF_OCR_MAX_PAGES > 0 and ocr_used < PDF_OCR_MAX_PAGES:
                try:
                    # Randez pagina ca imagine (la 2x rezolutie pentru claritate) si o trimit la OCR.
                    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                    png = pix.tobytes("png")
                    t = (ocr_page(png, i + 1) or "").strip()
                    if t:
                        meta["pages_ocr"] += 1
                        ocr_used += 1
                except Exception:
                    # Daca OCR-ul pica pe o pagina, o las goala si merg mai departe.
                    pass
            if t:
                meta["pages_with_text"] += 1
                parts.append(t)
            else:
                meta["pages_empty"] += 1
                parts.append("")
    finally:
        doc.close()
    # Daca au ramas pagini goale pe care nu le-am putut OCR-ui (am atins limita), le notez.
    if meta["pages_empty"] > 0 and ocr_page is not None and PDF_OCR_MAX_PAGES > 0:
        remaining = meta["pages_empty"] - meta["pages_ocr"]
        if remaining > 0 and meta["pages_ocr"] >= PDF_OCR_MAX_PAGES:
            meta["pages_ocr_skipped"] = remaining
    return parts, "pymupdf", meta


def extract_pdf_text(
    raw: bytes,
    ocr_page: Callable[[bytes, int], str] | None = None,
) -> tuple[str, dict]:
    """Scot textul dintr-un PDF: incerc intai PyMuPDF, cad pe pypdf daca trebuie, apoi repar diacriticele."""
    page_parts: list[str] = []
    engine = "pypdf"
    pdf_meta: dict = {"page_count": 0, "pages_with_text": 0, "pages_ocr": 0, "pages_empty": 0}

    try:
        # Calea preferata: PyMuPDF (cu OCR optional).
        page_parts, engine, pdf_meta = _extract_pdf_pymupdf(raw, ocr_page=ocr_page)
    except ImportError:
        # PyMuPDF nu e instalat -> cad pe pypdf si construiesc metadatele de mana.
        page_parts, engine = _extract_pdf_pypdf(raw)
        pdf_meta = {
            "page_count": len(page_parts),
            "pages_with_text": sum(1 for p in page_parts if (p or "").strip()),
            "pages_empty": sum(1 for p in page_parts if not (p or "").strip()),
            "pages_ocr": 0,
            "pages_ocr_skipped": 0,
            "ocr_max_pages": PDF_OCR_MAX_PAGES,
        }
    except Exception:
        # Orice alta eroare la PyMuPDF (PDF corupt etc.) -> tot pypdf ca plan B.
        page_parts, engine = _extract_pdf_pypdf(raw)
        pdf_meta = {
            "page_count": len(page_parts),
            "pages_with_text": sum(1 for p in page_parts if (p or "").strip()),
            "pages_empty": sum(1 for p in page_parts if not (p or "").strip()),
            "pages_ocr": 0,
            "pages_ocr_skipped": 0,
            "ocr_max_pages": PDF_OCR_MAX_PAGES,
        }

    # Completez numarul de pagini si motorul folosit in metadate.
    pdf_meta["page_count"] = pdf_meta.get("page_count") or len(page_parts)
    pdf_meta["engine"] = engine
    # Lipesc paginile cu text, separate prin linie goala.
    text = "\n\n".join(p for p in page_parts if p)
    # Daca a iesit gol (toate paginile goale), lipesc oricum tot, ca sa nu pierd structura.
    if not text.strip():
        text = "\n".join(page_parts)
    # La final repar eventualele diacritice legacy.
    text = repair_legacy_romanian_diacritics(text)
    return text, pdf_meta


def normalize_extracted_document_text(text: str) -> str:
    # Normalizez textul extras: uniformizez sfarsiturile de linie si strang spatiile/liniile goale.
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def build_extract_meta(text: str, source_type: str, extra: dict | None = None) -> dict:
    """Pregatesc metadatele pe care UI-ul le arata dupa extragere (tip sursa, numar caractere, fragment preview)."""
    clean = normalize_extracted_document_text(text)
    # Iau primele 400 de caractere ca preview, inlocuind newline-urile cu spatiu ca sa incapa pe un rand.
    preview = clean[:400].replace("\n", " ")
    if len(clean) > 400:
        preview += "…"
    meta = {
        "source_type": source_type,
        "char_count": len(clean),
        "extract_preview": preview,
    }
    # Daca am primit metadate suplimentare (ex. statistici PDF), le adaug.
    if extra:
        meta.update(extra)
    return meta
