"""
Pipeline unificat: curatare text, detectare capitole, TTS pe segmente, evenimente SSE.
"""
from __future__ import annotations

import os
import time
from typing import Callable

from fastapi import HTTPException

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

EmitFn = Callable[[dict], None]

GUEST_PREVIEW_CHARS = max(1000, int(os.getenv("GUEST_PREVIEW_CHARS", "5000")))


def apply_guest_text_window(user: dict, raw_text: str) -> tuple[str, dict]:
    """Oaspetii: proceseaza doar primele GUEST_PREVIEW_CHARS ca previzualizare."""
    text = (raw_text or "").strip()
    meta = {
        "is_guest_preview": False,
        "source_char_total": len(text),
        "processed_char_count": len(text),
    }
    if user.get("rol") != "guest" or len(text) <= GUEST_PREVIEW_CHARS:
        return text, meta
    cut = text[:GUEST_PREVIEW_CHARS]
    for sep in (". ", "! ", "? ", "\n\n", " "):
        pos = cut.rfind(sep)
        if pos > GUEST_PREVIEW_CHARS // 2:
            cut = cut[: pos + len(sep)].strip()
            break
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
    emit: EmitFn,
    upload_mp3: Callable[[str, bytes], str],
    upload_segment: Callable[[TtsSegmentResult, str], str],
    insert_carte: Callable[[dict], int | None],
    save_segments: Callable[[int, list[dict]], None],
    verify_guest_credits: Callable[[int], None],
    deduct_guest: Callable[[int], dict | None],
) -> dict:
    raw_trim, guest_meta = apply_guest_text_window(user, raw_text)
    if not raw_trim:
        raise HTTPException(status_code=422, detail="Text gol după curățare.")

    if guest_meta["is_guest_preview"]:
        emit(
            {
                "type": "preview",
                "source_char_total": guest_meta["source_char_total"],
                "processed_char_count": guest_meta["processed_char_count"],
            }
        )

    verify_guest_credits(len(raw_trim))

    if curata_cu_gemini and gemini_model is not None:
        emit({"type": "phase", "phase": "cleaning"})
    text_curat = prepare_text_for_audio(
        raw_trim,
        gemini_model if curata_cu_gemini and gemini_model is not None else None,
        use_gemini=curata_cu_gemini and gemini_model is not None,
    )
    if not text_curat:
        raise HTTPException(status_code=422, detail="Text gol după curățare.")

    char_count = len(text_curat)
    verify_guest_credits(char_count)

    mode = playlist_mode_for_length(char_count)
    emit(
        {
            "type": "playlist_mode",
            "mode": mode,
            "book_threshold": BOOK_MODE_CHAR_THRESHOLD,
        }
    )

    if mode == "chapters":
        emit({"type": "phase", "phase": "chapters"})
        chapters = detect_chapters(text_curat)
        emit(
            {
                "type": "phase",
                "phase": "tts",
                "segments_total": len(chapters),
                "char_count": char_count,
            }
        )
        units = [(ch.index, ch.title, ch.text) for ch in chapters]
    else:
        segments_total = estimate_tts_segment_count(text_curat)
        emit(
            {
                "type": "phase",
                "phase": "tts",
                "segments_total": segments_total,
                "char_count": char_count,
            }
        )
        units = [(None, None, text_curat)]

    prefix = f"carte_{int(time.time())}"
    segmente_upload: list[dict] = []
    segmente_raspuns: list[dict] = []
    part_paths_for_merge: list[str] = []
    global_index = 0

    for ch_index, ch_title, unit_text in units:
        if mode == "chapters" and ch_title:
            emit(
                {
                    "type": "chapter_start",
                    "chapter_index": ch_index,
                    "chapter_title": ch_title,
                }
            )

        def make_on_segment(ci: int | None, ct: str | None, start_idx: int) -> Callable[[TtsSegmentResult], None]:
            counter = {"n": start_idx}

            def on_seg(seg: TtsSegmentResult) -> None:
                idx = counter["n"]
                counter["n"] += 1
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
                emit({"type": "segment", **seg_resp})
                link = upload_segment(seg, prefix)
                row = {
                    "segment_index": idx,
                    "text_fragment": seg.text,
                    "audio_link": link,
                    "char_count": len(seg.text),
                    "chapter_index": ci,
                    "chapter_title": ct,
                }
                segmente_upload.append(row)
                seg_resp["audio_link"] = link
                segmente_raspuns.append(dict(seg_resp))
                emit({"type": "segment", **seg_resp})

            return on_seg

        try:
            temp_mp3, _ = synthesize_ro_with_segments(
                unit_text,
                on_segment_complete=make_on_segment(ch_index, ch_title, global_index),
            )
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e
        except RuntimeError as e:
            raise HTTPException(status_code=503, detail=str(e)) from e

        part_paths_for_merge.append(temp_mp3)
        global_index = max((s["segment_index"] for s in segmente_upload), default=-1) + 1

    if len(part_paths_for_merge) == 1:
        final_path = part_paths_for_merge[0]
    else:
        final_path = os.path.join(
            os.path.dirname(part_paths_for_merge[0]),
            f"{prefix}_merged.mp3",
        )
        _concat_mp3_files(part_paths_for_merge, final_path)
        for p in part_paths_for_merge:
            try:
                if os.path.isfile(p):
                    os.remove(p)
            except OSError:
                pass

    try:
        with open(final_path, "rb") as f:
            blob_final = f.read()
        if len(blob_final) < MIN_FINAL_MP3_BYTES:
            raise HTTPException(status_code=503, detail="Audio final prea mic.")
        link_final = upload_mp3(f"{prefix}.mp3", blob_final)
    finally:
        if os.path.isfile(final_path):
            try:
                os.remove(final_path)
            except OSError:
                pass

    rand_carti = {
        "titlu": titlu,
        "url": source_label,
        "text_curatat": text_curat,
        "audio_link": link_final,
        "is_guest_preview": guest_meta["is_guest_preview"],
        "source_char_total": guest_meta["source_char_total"],
        "playlist_mode": mode,
    }
    id_nou = insert_carte(rand_carti)
    if id_nou is not None:
        save_segments(id_nou, segmente_upload)

    credits = deduct_guest(char_count)
    playlist_total = len(units) if mode == "chapters" else len(segmente_raspuns)
    result = {
        "status": "Succes",
        "id": id_nou,
        "titlu": titlu,
        "is_public": False,
        "link_audio": link_final,
        "text_final_audio": text_curat,
        "char_count": char_count,
        "playlist_mode": mode,
        "segments_total": playlist_total,
        "segments": sorted(segmente_raspuns, key=lambda x: x["index"]),
        "is_guest_preview": guest_meta["is_guest_preview"],
        "source_char_total": guest_meta["source_char_total"],
        "gemini_cleaned": curata_cu_gemini and gemini_model is not None,
    }
    if credits is not None:
        result["guest_credits"] = credits
    emit({"type": "done", **result})
    return result
