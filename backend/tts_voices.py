"""
Catalog vocile disponibile in UI (Edge neural + gTTS) si helper pentru validare.
"""
from __future__ import annotations

from dataclasses import dataclass

DEFAULT_EDGE_VOICE = "ro-RO-AlinaNeural"
DEFAULT_VOICE_ID = DEFAULT_EDGE_VOICE
GTTS_VOICE_ID = "gtts-ro"

# Lista curata pentru picker. Camp "engine": edge (implicit) sau gtts.
VOICE_CATALOG: list[dict] = [
    {
        "id": "ro-RO-AlinaNeural",
        "engine": "edge",
        "name": "Alina",
        "gender": "female",
        "trait_ro": "Calda, clara",
        "trait_en": "Warm, bright",
        "language_ro": "Romana",
        "language_en": "Romanian",
        "sample_text_ro": "Bună! Aceasta este vocea mea pentru cărți audio în limba română.",
        "sample_text_en": "Bună! Aceasta este vocea mea pentru cărți audio în limba română.",
    },
    {
        "id": "ro-RO-EmilNeural",
        "engine": "edge",
        "name": "Emil",
        "gender": "male",
        "trait_ro": "Sigur, echilibrat",
        "trait_en": "Confident, steady",
        "language_ro": "Romana",
        "language_en": "Romanian",
        "sample_text_ro": "Bună! Aceasta este vocea mea pentru cărți audio în limba română.",
        "sample_text_en": "Bună! Aceasta este vocea mea pentru cărți audio în limba română.",
    },
    {
        "id": "en-US-JennyNeural",
        "engine": "edge",
        "name": "Jenny",
        "gender": "female",
        "trait_ro": "Prietenoasa, clara",
        "trait_en": "Friendly, clear",
        "language_ro": "Engleza (SUA)",
        "language_en": "English (US)",
        "demo_locale": "en",
        "sample_text_ro": "Hello! This is my voice for audiobooks in American English.",
        "sample_text_en": "Hello! This is my voice for audiobooks in American English.",
    },
    {
        "id": "en-GB-SoniaNeural",
        "engine": "edge",
        "name": "Sonia",
        "gender": "female",
        "trait_ro": "Eleganta, echilibrata",
        "trait_en": "Elegant, balanced",
        "language_ro": "Engleza (UK)",
        "language_en": "English (UK)",
        "demo_locale": "en",
        "sample_text_ro": "Hello! This is my voice for audiobooks in British English.",
        "sample_text_en": "Hello! This is my voice for audiobooks in British English.",
    },
    {
        "id": "en-AU-NatashaNeural",
        "engine": "edge",
        "name": "Natasha",
        "gender": "female",
        "trait_ro": "Calda, naturala",
        "trait_en": "Warm, natural",
        "language_ro": "Engleza (Australia)",
        "language_en": "English (Australia)",
        "demo_locale": "en",
        "sample_text_ro": "Hello! This is my voice for audiobooks in Australian English.",
        "sample_text_en": "Hello! This is my voice for audiobooks in Australian English.",
    },
    {
        "id": GTTS_VOICE_ID,
        "engine": "gtts",
        "name": "Google",
        "gender": "neutral",
        "trait_ro": "Voce simpla (gTTS)",
        "trait_en": "Simple voice (gTTS)",
        "language_ro": "Romana",
        "language_en": "Romanian",
        "sample_text_ro": "Bună! Aceasta este vocea mea pentru cărți audio în limba română.",
        "sample_text_en": "Bună! Aceasta este vocea mea pentru cărți audio în limba română.",
    },
]

_VOICE_IDS = {v["id"] for v in VOICE_CATALOG}


@dataclass
class TtsConfig:
    """Optiuni TTS per cerere (alese in UI)."""
    engine: str = "edge"
    edge_voice: str = DEFAULT_EDGE_VOICE
    allow_fallback: bool = False


def _catalog_entry(voice_id: str) -> dict | None:
    """Caut intrarea din catalog dupa id."""
    for v in VOICE_CATALOG:
        if v["id"] == voice_id:
            return v
    return None


def resolve_voice_id(voice_id: str | None) -> str:
    """Validez ID-ul primit de la client; la invalid folosesc vocea implicita."""
    vid = (voice_id or "").strip()
    if vid in _VOICE_IDS:
        return vid
    return DEFAULT_VOICE_ID


def _demo_locale_for_entry(entry: dict) -> str:
    """Limba textului demo (ro sau en) dupa camp demo_locale sau prefix id."""
    if entry.get("demo_locale") in ("ro", "en"):
        return entry["demo_locale"]
    vid = entry.get("id", "")
    if vid.startswith("en-"):
        return "en"
    return "ro"


def voice_catalog_for_api(locale: str = "ro") -> list[dict]:
    """Intorc lista de voci pentru GET /tts/voices (campuri localizate)."""
    en = locale == "en"
    out: list[dict] = []
    for v in VOICE_CATALOG:
        out.append(
            {
                "id": v["id"],
                "engine": v.get("engine", "edge"),
                "name": v["name"],
                "gender": v["gender"],
                "trait": v["trait_en"] if en else v["trait_ro"],
                "language": v["language_en"] if en else v["language_ro"],
                "sample_text": v["sample_text_en"] if en else v["sample_text_ro"],
                "demo_locale": _demo_locale_for_entry(v),
            }
        )
    return out


def sample_text_for_voice(voice_id: str, locale: str = "ro") -> str:
    """Text scurt pentru previzualizarea unei voci (in limba nativa a vocii)."""
    vid = resolve_voice_id(voice_id)
    entry = _catalog_entry(vid)
    if entry:
        demo = _demo_locale_for_entry(entry)
        return entry["sample_text_en"] if demo == "en" else entry["sample_text_ro"]
    return VOICE_CATALOG[0]["sample_text_ro"]


def preview_locale_for_voice(voice_id: str) -> str:
    """Locale folosit la GET /tts/preview (limba textului demo)."""
    entry = _catalog_entry(resolve_voice_id(voice_id))
    if entry:
        return _demo_locale_for_entry(entry)
    return "ro"


def tts_config_from_voice_id(voice_id: str | None) -> TtsConfig:
    """Construiesc TtsConfig din alegerea UI: Edge, gTTS sau config din mediu daca lipseste."""
    vid = (voice_id or "").strip()
    if not vid:
        try:
            from long_text_pipeline import _tts_config_from_env
        except ModuleNotFoundError:
            from backend.long_text_pipeline import _tts_config_from_env
        return _tts_config_from_env()
    resolved = resolve_voice_id(vid)
    entry = _catalog_entry(resolved)
    if entry and entry.get("engine") == "gtts":
        return TtsConfig(engine="gtts", allow_fallback=False)
    return TtsConfig(
        engine="edge",
        edge_voice=resolved,
        allow_fallback=False,
    )
