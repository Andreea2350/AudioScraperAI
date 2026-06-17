"""
Extragere si reparare text din documente: encoding TXT, PDF cu diacritice legacy.
"""
from __future__ import annotations

import io
import os
import re
from typing import Callable

# Limita pagini OCR (Gemini vision) per PDF — restul ramane gol in extract.
PDF_OCR_MAX_PAGES = max(0, int(os.getenv("PDF_OCR_MAX_PAGES", "50")))

# Mapare frecventa in PDF-uri vechi romanesti (font fara ToUnicode corect):
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

_LEGACY_RO_BACKSLASH_VOWEL = re.compile(r"\\([aeiouAEIOU])")


def needs_legacy_romanian_repair(text: str) -> bool:
    if not text or len(text) < 8:
        return False
    if _LEGACY_RO_BACKSLASH_VOWEL.search(text):
        return True
    return bool(re.search(r"(?<=[A-Za-zÀ-ÿ])[\[\]`\{\}\|~^@#](?=[A-Za-zÀ-ÿ])", text))


def repair_legacy_romanian_diacritics(text: str) -> str:
    if not text or not needs_legacy_romanian_repair(text):
        return text

    def _backslash_vowel(m: re.Match[str]) -> str:
        ch = m.group(1)
        if ch in "aeiou":
            return "ț" + ch
        return "Ț" + ch.lower()

    out = _LEGACY_RO_BACKSLASH_VOWEL.sub(_backslash_vowel, text)
    return out.translate(_LEGACY_RO_TRANSLATE)


def decode_plain_text_bytes(raw: bytes) -> str:
    if raw.startswith(b"\xef\xbb\xbf"):
        return raw[3:].decode("utf-8", errors="replace")
    for enc in ("utf-8", "cp1250", "iso-8859-2", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _extract_pdf_pypdf(raw: bytes) -> tuple[list[str], str]:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(raw))
    parts: list[str] = []
    for page in reader.pages:
        t = page.extract_text() or ""
        if not (t and str(t).strip()):
            t = page.extract_text(extraction_mode="layout") or ""
        parts.append(t)
    return parts, "pypdf"


def _extract_pdf_pymupdf(
    raw: bytes,
    ocr_page: Callable[[bytes, int], str] | None = None,
) -> tuple[list[str], str, dict]:
    import fitz

    meta = {
        "pages_with_text": 0,
        "pages_ocr": 0,
        "pages_empty": 0,
        "pages_ocr_skipped": 0,
        "ocr_max_pages": PDF_OCR_MAX_PAGES,
    }
    doc = fitz.open(stream=raw, filetype="pdf")
    parts: list[str] = []
    ocr_used = 0
    try:
        for i, page in enumerate(doc):
            t = (page.get_text("text") or "").strip()
            if not t and ocr_page is not None and PDF_OCR_MAX_PAGES > 0 and ocr_used < PDF_OCR_MAX_PAGES:
                try:
                    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                    png = pix.tobytes("png")
                    t = (ocr_page(png, i + 1) or "").strip()
                    if t:
                        meta["pages_ocr"] += 1
                        ocr_used += 1
                except Exception:
                    pass
            if t:
                meta["pages_with_text"] += 1
                parts.append(t)
            else:
                meta["pages_empty"] += 1
                parts.append("")
    finally:
        doc.close()
    if meta["pages_empty"] > 0 and ocr_page is not None and PDF_OCR_MAX_PAGES > 0:
        remaining = meta["pages_empty"] - meta["pages_ocr"]
        if remaining > 0 and meta["pages_ocr"] >= PDF_OCR_MAX_PAGES:
            meta["pages_ocr_skipped"] = remaining
    return parts, "pymupdf", meta


def extract_pdf_text(
    raw: bytes,
    ocr_page: Callable[[bytes, int], str] | None = None,
) -> tuple[str, dict]:
    """Extrag text din PDF; prefer PyMuPDF; repar diacritice legacy."""
    page_parts: list[str] = []
    engine = "pypdf"
    pdf_meta: dict = {"page_count": 0, "pages_with_text": 0, "pages_ocr": 0, "pages_empty": 0}

    try:
        page_parts, engine, pdf_meta = _extract_pdf_pymupdf(raw, ocr_page=ocr_page)
    except ImportError:
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
        page_parts, engine = _extract_pdf_pypdf(raw)
        pdf_meta = {
            "page_count": len(page_parts),
            "pages_with_text": sum(1 for p in page_parts if (p or "").strip()),
            "pages_empty": sum(1 for p in page_parts if not (p or "").strip()),
            "pages_ocr": 0,
            "pages_ocr_skipped": 0,
            "ocr_max_pages": PDF_OCR_MAX_PAGES,
        }

    pdf_meta["page_count"] = pdf_meta.get("page_count") or len(page_parts)
    pdf_meta["engine"] = engine
    text = "\n\n".join(p for p in page_parts if p)
    if not text.strip():
        text = "\n".join(page_parts)
    text = repair_legacy_romanian_diacritics(text)
    return text, pdf_meta


def normalize_extracted_document_text(text: str) -> str:
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def build_extract_meta(text: str, source_type: str, extra: dict | None = None) -> dict:
    """Metadate pentru preview in UI dupa extragere."""
    clean = normalize_extracted_document_text(text)
    preview = clean[:400].replace("\n", " ")
    if len(clean) > 400:
        preview += "…"
    meta = {
        "source_type": source_type,
        "char_count": len(clean),
        "extract_preview": preview,
    }
    if extra:
        meta.update(extra)
    return meta
