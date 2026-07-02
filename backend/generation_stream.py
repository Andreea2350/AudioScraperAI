"""
Aici se face toata generarea audio dintr-un text.
Indiferent daca textul vine din editorul manual, dintr-un URL sau dintr-un fisier,
totul ajunge in functia run_audio_generation, ca sa nu am trei pipeline-uri separate
de intretinut. Pe scurt: curat textul, il impart in bucati, il trec prin TTS,
urc fisierele in Supabase si trimit evenimente SSE catre browser ca sa vada
playlistul cum se construieste in timp real.
"""
from __future__ import annotations

import os
import time
from typing import Callable

from fastapi import HTTPException

# Importurile au doua variante pentru ca aplicatia ruleaza si local (modul "generation_cancel"),
# si pe Vercel unde pachetul e "backend.generation_cancel". Daca primul import pica, il incerc pe al doilea.
try:
    from generation_cancel import GenerationCancelled
except ModuleNotFoundError:
    from backend.generation_cancel import GenerationCancelled

# Acelasi truc de import dublu si pentru functiile grele de detectare capitole si TTS.
try:
    from chapter_detection import (
        BOOK_MODE_CHAR_THRESHOLD,
        detect_chapters,
        playlist_mode_for_length,
    )
    from long_text_pipeline import (
        MIN_FINAL_MP3_BYTES,
        TtsSegmentResult,
        _concat_mp3_files,
        estimate_tts_segment_count,
        prepare_text_for_audio,
        synthesize_ro_with_segments,
    )
except ModuleNotFoundError:
    from backend.chapter_detection import (
        BOOK_MODE_CHAR_THRESHOLD,
        detect_chapters,
        playlist_mode_for_length,
    )
    from backend.long_text_pipeline import (
        MIN_FINAL_MP3_BYTES,
        TtsSegmentResult,
        _concat_mp3_files,
        estimate_tts_segment_count,
        prepare_text_for_audio,
        synthesize_ro_with_segments,
    )

# Tipul asta e doar o "scurtatura": orice functie care primeste un dict (un eveniment)
# si nu intoarce nimic poate fi folosita ca emitator SSE catre frontend.
EmitFn = Callable[[dict], None]

# Cate caractere are voie sa proceseze un oaspete intr-un singur job.
# Citesc valoarea din variabila de mediu, dar nu las niciodata sub 1000 ca sa nu fie inutil.
GUEST_PREVIEW_CHARS = max(1000, int(os.getenv("GUEST_PREVIEW_CHARS", "5000")))


def apply_guest_text_window(user: dict, raw_text: str) -> tuple[str, dict]:
    """
    Daca utilizatorul e oaspete, ii procesez doar primele GUEST_PREVIEW_CHARS caractere (un preview).
    Incerc sa tai la final de propozitie, ca sa nu se opreasca audio-ul in mijlocul unei fraze.
    Intorc textul (eventual taiat) plus niste metadate despre cat era textul original.
    """
    # Curat spatiile de la capete; daca primesc None, il tratez ca string gol.
    text = (raw_text or "").strip()
    # Metadatele pleaca presupunand ca NU e preview (caz pentru useri normali).
    meta = {
        "is_guest_preview": False,
        "source_char_total": len(text),
        "processed_char_count": len(text),
    }
    # Daca nu e oaspete SAU textul oricum incape in limita, il las neatins.
    if user.get("rol") != "guest" or len(text) <= GUEST_PREVIEW_CHARS:
        return text, meta
    # Tai brut la limita, apoi caut o granita naturala unde sa retez.
    cut = text[:GUEST_PREVIEW_CHARS]
    # Incerc pe rand: sfarsit de propozitie, semn de exclamare/intrebare, paragraf nou, spatiu.
    for sep in (". ", "! ", "? ", "\n\n", " "):
        pos = cut.rfind(sep)
        # Accept taietura doar daca e in a doua jumatate, altfel as pierde prea mult text.
        if pos > GUEST_PREVIEW_CHARS // 2:
            cut = cut[: pos + len(sep)].strip()
            break
    # Marchez ca e preview si notez cat text a ramas efectiv de procesat.
    meta["is_guest_preview"] = True
    meta["processed_char_count"] = len(cut)
    return cut, meta


def run_audio_generation(
    *,
    user: dict,
    titlu: str,
    raw_text: str,
    source_label: str,
    curata_cu_gemini: bool,
    gemini_model,
    tts_config=None,
    emit: EmitFn,
    upload_mp3: Callable[[str, bytes], str],
    upload_segment: Callable[[TtsSegmentResult, str, int], str],
    insert_carte: Callable[[dict], int | None],
    save_segments: Callable[[int, list[dict]], None],
    verify_guest_credits: Callable[[int], None],
    deduct_guest: Callable[[int], dict | None],
    check_cancel: Callable[[], None] | None = None,
) -> dict:
    """
    Asta e functia care coordoneaza intregul proces. Primeste tot ce-i trebuie ca argumente
    (functii de upload, salvare in DB, verificare credite) ca sa nu depinda direct de main.py
    si sa pot fi testat usor. Trece prin pasii: fereastra guest -> curatare -> impartire in
    capitole/parti -> TTS -> lipire MP3 -> upload final -> salvare in baza de date.
    Pe parcurs trimite evenimente SSE ca browserul sa arate playlistul cum se umple.
    """

    def _check() -> None:
        # Scurtatura ca sa intreb "s-a cerut anulare?" intre pasi, fara sa scriu de fiecare data if-ul.
        # Daca utilizatorul a apasat Stop, functia asta arunca exceptie si iesim din proces.
        if check_cancel is not None:
            check_cancel()

    # Pas 1: daca e oaspete ii taiu textul la fereastra de preview si verific daca are credite.
    _check()
    raw_trim, guest_meta = apply_guest_text_window(user, raw_text)
    # Daca dupa trim nu mai am nimic, n-are rost sa continui.
    if not raw_trim:
        raise HTTPException(status_code=422, detail="Text gol dupa curatare.")

    # Daca textul a fost taiat (e preview de oaspete), anunt frontend-ul ca sa afiseze mesajul potrivit.
    if guest_meta["is_guest_preview"]:
        emit(
            {
                "type": "preview",
                "source_char_total": guest_meta["source_char_total"],
                "processed_char_count": guest_meta["processed_char_count"],
            }
        )

    # Verific ca oaspetele are credite suficiente inainte sa cheltui timp pe procesare.
    verify_guest_credits(len(raw_trim))

    # Pas 2: daca userul a bifat optiunea, las Gemini sa curete textul de zgomot (meniuri, reclame etc.).
    _check()
    # Trimit un eveniment ca UI-ul sa arate "se curata textul..." doar daca chiar folosesc Gemini.
    if curata_cu_gemini and gemini_model is not None:
        emit({"type": "phase", "phase": "cleaning"})
    # Daca nu vreau curatare sau n-am model disponibil, trec None ca sa sara peste pasul Gemini.
    text_curat = prepare_text_for_audio(
        raw_trim,
        gemini_model if curata_cu_gemini and gemini_model is not None else None,
        use_gemini=curata_cu_gemini and gemini_model is not None,
        check_cancel=check_cancel,
    )
    _check()
    # Se poate intampla ca dupa curatare sa ramana gol (text format doar din zgomot), deci verific iar.
    if not text_curat:
        raise HTTPException(status_code=422, detail="Text gol dupa curatare.")

    # Recalculez lungimea pe textul curatat si reverific creditele (curatarea poate schimba numarul).
    char_count = len(text_curat)
    verify_guest_credits(char_count)

    # Pas 3: decid cum arata playlistul: pe "parti" (text scurt/mediu) sau pe "capitole" (text lung de carte).
    mode = playlist_mode_for_length(char_count)
    # Spun frontend-ului ce mod am ales si de la ce prag se considera "carte", ca sa afiseze corect.
    emit(
        {
            "type": "playlist_mode",
            "mode": mode,
            "book_threshold": BOOK_MODE_CHAR_THRESHOLD,
        }
    )

    if mode == "chapters":
        # Mod carte: anunt ca detectez capitolele, apoi le caut in text.
        emit({"type": "phase", "phase": "chapters"})
        chapters = detect_chapters(text_curat)
        # Trimit faza TTS impreuna cu cate capitole am gasit (asta e totalul din playlist).
        emit(
            {
                "type": "phase",
                "phase": "tts",
                "segments_total": len(chapters),
                "char_count": char_count,
            }
        )
        # Transform capitolele intr-o lista uniforma de tupluri (index, titlu, text) ca sa le iterez la fel.
        units = [(ch.index, ch.title, ch.text) for ch in chapters]
    else:
        # Mod parti: estimez cate segmente o sa iasa, doar ca sa pot afisa o bara de progres realista.
        segments_total = estimate_tts_segment_count(text_curat)
        emit(
            {
                "type": "phase",
                "phase": "tts",
                "segments_total": segments_total,
                "char_count": char_count,
            }
        )
        # Aici am o singura "unitate": tot textul, fara index/titlu de capitol.
        units = [(None, None, text_curat)]

    # Pas 4: trec fiecare unitate (un capitol sau tot textul) prin TTS, segment cu segment.
    # Prefixul cu timestamp ma ajuta sa nu se calce numele fisierelor intre generari diferite.
    prefix = f"carte_{int(time.time())}"
    segmente_upload: list[dict] = []   # ce salvez in DB (cu link audio real)
    segmente_raspuns: list[dict] = []  # ce trimit inapoi in raspunsul final
    part_paths_for_merge: list[str] = []  # caile MP3-urilor de capitol, ca sa le lipesc la final
    global_index = 0  # indexul global al segmentului, continua peste capitole

    for ch_index, ch_title, unit_text in units:
        _check()
        # Daca sunt in mod capitole si am titlu, anunt frontend-ul ca incepe un capitol nou.
        if mode == "chapters" and ch_title:
            emit(
                {
                    "type": "chapter_start",
                    "chapter_index": ch_index,
                    "chapter_title": ch_title,
                }
            )

        def make_on_segment(ci: int | None, ct: str | None, start_idx: int) -> Callable[[TtsSegmentResult], None]:
            """
            Fabrica de callback-uri: pentru fiecare capitol creez o functie on_seg care stie
            de ce capitol apartine (ci, ct) si de la ce index global porneste numaratoarea.
            Folosesc o fabrica pentru ca altfel toate callback-urile ar imparti aceleasi variabile.
            """
            # Tin contorul intr-un dict ca sa-l pot modifica din functia interioara (closure mutabil).
            counter = {"n": start_idx}

            def on_seg(seg: TtsSegmentResult) -> None:
                # Callback apelat de motorul TTS dupa ce termina un segment audio.
                _check()
                idx = counter["n"]
                counter["n"] += 1
                # Pregatesc un mic preview de text (max 120 caractere) ca sa nu trimit fraze intregi in UI.
                preview = seg.text[:120] + ("…" if len(seg.text) > 120 else "")
                seg_resp = {
                    "index": idx,
                    "total": seg.total,
                    "text_preview": preview,
                    "char_count": len(seg.text),
                    "audio_link": None,
                    "chapter_index": ci,
                    "chapter_title": ct,
                }
                # Prima emitere: trimit segmentul FARA link audio, ca UI-ul sa-l afiseze imediat (optimist).
                emit({"type": "segment", **seg_resp})
                # Acum urc efectiv segmentul in Supabase si primesc link-ul.
                link = upload_segment(seg, prefix, idx)
                # Pregatesc randul exact cum il vreau in tabelul carti_segmente.
                row = {
                    "segment_index": idx,
                    "text_fragment": seg.text,
                    "audio_link": link,
                    "char_count": len(seg.text),
                    "chapter_index": ci,
                    "chapter_title": ct,
                }
                segmente_upload.append(row)
                # Completez link-ul si in obiectul de raspuns, apoi il salvez ca o copie.
                seg_resp["audio_link"] = link
                segmente_raspuns.append(dict(seg_resp))
                # A doua emitere: acelasi segment, dar acum cu link audio, ca UI-ul sa-l faca redabil.
                emit({"type": "segment", **seg_resp})

            return on_seg

        try:
            # Aici se face sinteza propriu-zisa pe unitatea curenta; callback-ul de mai sus se ocupa de fiecare segment.
            temp_mp3, _ = synthesize_ro_with_segments(
                unit_text,
                on_segment_complete=make_on_segment(ch_index, ch_title, global_index),
                tts_config=tts_config,
                check_cancel=check_cancel,
            )
        except GenerationCancelled:
            # Daca s-a cerut anulare, las exceptia sa urce mai sus (o prinde main.py si curata).
            raise
        except ValueError as e:
            # Text invalid -> 422 (e vina datelor de intrare).
            raise HTTPException(status_code=422, detail=str(e)) from e
        except RuntimeError as e:
            # Motorul TTS a picat -> 503 (problema de serviciu, nu de date).
            raise HTTPException(status_code=503, detail=str(e)) from e

        # Tin minte calea MP3-ului acestui capitol ca sa le lipesc pe toate la final.
        part_paths_for_merge.append(temp_mp3)
        # Mut indexul global dupa ultimul segment folosit, ca urmatorul capitol sa continue numaratoarea.
        global_index = max((s["segment_index"] for s in segmente_upload), default=-1) + 1

    _check()
    # Pas 5: lipesc bucatile intr-un singur MP3 final.
    if len(part_paths_for_merge) == 1:
        # Daca a fost o singura parte, ala e chiar fisierul final, nu mai am ce lipi.
        final_path = part_paths_for_merge[0]
    else:
        # Mai multe capitole: construiesc calea fisierului unit si concatenez.
        final_path = os.path.join(
            os.path.dirname(part_paths_for_merge[0]),
            f"{prefix}_merged.mp3",
        )
        _concat_mp3_files(part_paths_for_merge, final_path)
        # Dupa ce le-am lipit, sterg fisierele de capitol ca sa nu umplu discul temporar.
        for p in part_paths_for_merge:
            try:
                if os.path.isfile(p):
                    os.remove(p)
            except OSError:
                # Daca nu pot sterge un fisier temporar, nu e capital, merg mai departe.
                pass

    # Pas 6: citesc MP3-ul final, verific ca nu e suspect de mic, il urc si apoi sterg fisierul local.
    _check()
    try:
        with open(final_path, "rb") as f:
            blob_final = f.read()
        # Daca fisierul e prea mic, probabil sinteza a esuat in tacere -> nu salvez audio defect.
        if len(blob_final) < MIN_FINAL_MP3_BYTES:
            raise HTTPException(status_code=503, detail="Audio final prea mic.")
        link_final = upload_mp3(f"{prefix}.mp3", blob_final)
    finally:
        # Indiferent daca upload-ul a mers sau nu, curat fisierul temporar de pe disc.
        if os.path.isfile(final_path):
            try:
                os.remove(final_path)
            except OSError:
                pass

    # Pas 7: salvez cartea in tabelul carti si segmentele in carti_segmente.
    _check()
    rand_carti = {
        "titlu": titlu,
        "url": source_label,          # de unde a venit textul (URL, nume fisier sau eticheta de tip "Text manual")
        "text_curatat": text_curat,
        "audio_link": link_final,
        "is_guest_preview": guest_meta["is_guest_preview"],
        "source_char_total": guest_meta["source_char_total"],
        "playlist_mode": mode,
    }
    id_nou = insert_carte(rand_carti)
    # Salvez segmentele doar daca am primit un id valid de carte (la oaspeti se poate sa nu salvez).
    if id_nou is not None:
        save_segments(id_nou, segmente_upload)

    # Scad creditele oaspetelui (la userii normali functia intoarce None si o ignor).
    credits = deduct_guest(char_count)
    # Totalul din playlist: la capitole numar capitolele, la parti numar segmentele efective.
    playlist_total = len(units) if mode == "chapters" else len(segmente_raspuns)
    result = {
        "status": "Succes",
        "id": id_nou,
        "titlu": titlu,
        "link_audio": link_final,
        "text_final_audio": text_curat,
        "char_count": char_count,
        "playlist_mode": mode,
        "segments_total": playlist_total,
        # Sortez segmentele dupa index ca sa ajunga in ordine la frontend, indiferent de ordinea de upload.
        "segments": sorted(segmente_raspuns, key=lambda x: x["index"]),
        "is_guest_preview": guest_meta["is_guest_preview"],
        "source_char_total": guest_meta["source_char_total"],
        "gemini_cleaned": curata_cu_gemini and gemini_model is not None,
    }
    # Adaug creditele ramase in raspuns doar daca e oaspete (altfel nu are sens campul).
    if credits is not None:
        result["guest_credits"] = credits
    # Ultimul eveniment SSE: "done", cu tot rezultatul, ca frontend-ul sa stie ca s-a terminat cu bine.
    emit({"type": "done", **result})
    return result
