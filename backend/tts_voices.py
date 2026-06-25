"""
Catalogul de voci pe care le poate alege utilizatorul din UI. Majoritatea sunt voci neurale
de la Microsoft Edge (suna natural), plus o optiune gTTS (voce simpla Google, ca rezerva).
Tot aici am helperele care valideaza ce voce a cerut clientul si construiesc configuratia TTS.
"""
from __future__ import annotations

from dataclasses import dataclass

# Vocea implicita: feminina, romaneasca (Alina). O folosesc cand clientul nu cere nimic anume.
DEFAULT_EDGE_VOICE = "ro-RO-AlinaNeural"
DEFAULT_VOICE_ID = DEFAULT_EDGE_VOICE
# Id-ul special pentru optiunea gTTS (nu e o voce Edge, ci motorul Google).
GTTS_VOICE_ID = "gtts-ro"

# Lista de voci afisate in picker. Fiecare are si texte demo localizate (ro/en) si campul "engine".
# Tin separat trait_ro/trait_en si language_ro/language_en ca sa pot afisa UI-ul bilingv.
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
        "demo_locale": "en",  # demo-ul ei e in engleza, nu in romana
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

# Set cu toate id-urile valide, ca sa pot verifica rapid daca o voce ceruta exista.
_VOICE_IDS = {v["id"] for v in VOICE_CATALOG}


@dataclass
class TtsConfig:
    """Optiunile TTS pentru o singura cerere de generare (ce motor, ce voce, daca accept fallback)."""
    engine: str = "edge"
    edge_voice: str = DEFAULT_EDGE_VOICE
    allow_fallback: bool = False


def _catalog_entry(voice_id: str) -> dict | None:
    """Caut in catalog intrarea cu id-ul dat; None daca nu exista."""
    for v in VOICE_CATALOG:
        if v["id"] == voice_id:
            return v
    return None


def resolve_voice_id(voice_id: str | None) -> str:
    """Validez id-ul venit de la client. Daca nu e in catalog, ma intorc la vocea implicita (nu crap)."""
    vid = (voice_id or "").strip()
    if vid in _VOICE_IDS:
        return vid
    return DEFAULT_VOICE_ID


def _demo_locale_for_entry(entry: dict) -> str:
    """Stabilesc limba textului demo: campul demo_locale, altfel din prefixul id-ului (en-... = engleza)."""
    if entry.get("demo_locale") in ("ro", "en"):
        return entry["demo_locale"]
    vid = entry.get("id", "")
    if vid.startswith("en-"):
        return "en"
    return "ro"


def voice_catalog_for_api(locale: str = "ro") -> list[dict]:
    """Pregatesc lista de voci pentru GET /tts/voices, cu campurile deja traduse in limba ceruta."""
    en = locale == "en"
    out: list[dict] = []
    for v in VOICE_CATALOG:
        # Pentru fiecare voce aleg varianta ro sau en a textelor in functie de locale.
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
    """Textul scurt folosit la previzualizarea unei voci (mereu in limba nativa a vocii)."""
    vid = resolve_voice_id(voice_id)
    entry = _catalog_entry(vid)
    if entry:
        demo = _demo_locale_for_entry(entry)
        return entry["sample_text_en"] if demo == "en" else entry["sample_text_ro"]
    # Daca nu gasesc vocea, folosesc textul primei voci din catalog.
    return VOICE_CATALOG[0]["sample_text_ro"]


def preview_locale_for_voice(voice_id: str) -> str:
    """Ce locale folosesc la GET /tts/preview (adica in ce limba e textul demo al vocii)."""
    entry = _catalog_entry(resolve_voice_id(voice_id))
    if entry:
        return _demo_locale_for_entry(entry)
    return "ro"


def tts_config_from_voice_id(voice_id: str | None) -> TtsConfig:
    """Transform alegerea de voce din UI intr-un TtsConfig concret pentru pipeline."""
    vid = (voice_id or "").strip()
    # Daca UI-ul n-a trimis nicio voce, folosesc configuratia din variabilele de mediu.
    if not vid:
        try:
            from long_text_pipeline import _tts_config_from_env
        except ModuleNotFoundError:
            from backend.long_text_pipeline import _tts_config_from_env
        return _tts_config_from_env()
    resolved = resolve_voice_id(vid)
    entry = _catalog_entry(resolved)
    # Daca vocea aleasa e gTTS, config-ul foloseste motorul gtts (fara fallback).
    if entry and entry.get("engine") == "gtts":
        return TtsConfig(engine="gtts", allow_fallback=False)
    # Altfel e o voce Edge: pun motorul edge cu vocea respectiva.
    return TtsConfig(
        engine="edge",
        edge_voice=resolved,
        allow_fallback=False,
    )
