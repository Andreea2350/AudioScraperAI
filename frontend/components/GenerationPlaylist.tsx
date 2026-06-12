"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GenerationSegment, PlaylistMode } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type PlaylistRow = {
    key: string;
    label: string;
    preview: string;
    charCount: number;
    segments: GenerationSegment[];
    ready: boolean;
};

type Props = {
    segments: GenerationSegment[];
    phase: string | null;
    segmentsTotal: number | null;
    playlistMode?: PlaylistMode;
    activeIndex: number | null;
    onActiveChange?: (index: number) => void;
    onGuestPreviewFinished?: () => void;
    isGuestPreview?: boolean;
};

export function GenerationPlaylist({
    segments,
    phase,
    segmentsTotal,
    playlistMode = "parts",
    activeIndex,
    onActiveChange,
    onGuestPreviewFinished,
    isGuestPreview,
}: Props) {
    const { t, locale } = useI18n();
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [playingRowKey, setPlayingRowKey] = useState<string | null>(null);
    const [playingSegIdx, setPlayingSegIdx] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);

    const rows = useMemo((): PlaylistRow[] => {
        if (playlistMode === "chapters") {
            const byChapter = new Map<number, GenerationSegment[]>();
            for (const s of segments) {
                const ci = s.chapter_index ?? 0;
                if (!byChapter.has(ci)) byChapter.set(ci, []);
                byChapter.get(ci)!.push(s);
            }
            return [...byChapter.entries()]
                .sort(([a], [b]) => a - b)
                .map(([ci, segs]) => {
                    const sorted = [...segs].sort((a, b) => a.index - b.index);
                    const title = sorted[0]?.chapter_title || (locale === "en" ? `Chapter ${ci + 1}` : `Capitol ${ci + 1}`);
                    return {
                        key: `ch-${ci}`,
                        label: title,
                        preview: sorted[0]?.text_preview ?? "",
                        charCount: sorted.reduce((n, x) => n + x.char_count, 0),
                        segments: sorted,
                        ready: sorted.every((x) => Boolean(x.audio_link)),
                    };
                });
        }
        return [...segments]
            .sort((a, b) => a.index - b.index)
            .map((s) => ({
                key: `p-${s.index}`,
                label: locale === "en" ? `Part ${s.index + 1}` : `Partea ${s.index + 1}`,
                preview: s.text_preview,
                charCount: s.char_count,
                segments: [s],
                ready: Boolean(s.audio_link),
            }));
    }, [segments, playlistMode, locale]);

    const activeRow = rows.find((r) => r.key === playingRowKey) ?? null;
    const currentSeg = activeRow?.segments[playingSegIdx] ?? null;

    const playRow = useCallback(
        (row: PlaylistRow) => {
            if (!row.ready || !row.segments[0]?.audio_link) return;
            setPlayingRowKey(row.key);
            setPlayingSegIdx(0);
            setIsPlaying(true);
            const idx = row.segments[0].index;
            onActiveChange?.(idx);
        },
        [onActiveChange],
    );

    const togglePlayPause = useCallback(() => {
        const audio = audioRef.current;
        if (!audio) return;
        if (isPlaying) {
            audio.pause();
            setIsPlaying(false);
        } else if (currentSeg?.audio_link) {
            void audio.play().catch(() => undefined);
            setIsPlaying(true);
        }
    }, [isPlaying, currentSeg?.audio_link]);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio || !currentSeg?.audio_link) return;
        if (audio.src !== currentSeg.audio_link) {
            audio.src = currentSeg.audio_link;
        }
        if (isPlaying) {
            void audio.play().catch(() => setIsPlaying(false));
        }
    }, [currentSeg?.audio_link, isPlaying, playingRowKey, playingSegIdx]);

    const handleEnded = () => {
        if (!activeRow) return;
        const nextInRow = playingSegIdx + 1;
        if (nextInRow < activeRow.segments.length) {
            setPlayingSegIdx(nextInRow);
            onActiveChange?.(activeRow.segments[nextInRow].index);
            return;
        }
        setIsPlaying(false);
        if (isGuestPreview) {
            onGuestPreviewFinished?.();
        }
    };

    const total = segmentsTotal ?? rows.length;
    const showPanel = Boolean(phase) || segments.length > 0;
    if (!showPanel) return null;

    const readyCount =
        playlistMode === "chapters"
            ? rows.filter((r) => r.ready).length
            : segments.filter((s) => s.audio_link).length;

    return (
        <div
            className="mt-6 rounded-2xl overflow-hidden"
            style={{
                border: "1px solid var(--border-card)",
                background: "var(--text-block-bg)",
            }}
        >
            <div
                className="px-4 py-3 flex items-center justify-between gap-3"
                style={{ borderBottom: "1px solid var(--divider)" }}
            >
                <p className="text-xs font-extrabold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                    {playlistMode === "chapters" ? t("gen.playlistChapters") : t("gen.playlistTitle")}
                </p>
                <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                    {phase === "extracting"
                        ? t("gen.phaseExtracting")
                        : phase === "starting"
                            ? t("gen.phaseStarting")
                            : phase === "cleaning"
                                ? t("gen.phaseCleaning")
                                : phase === "chapters"
                                    ? t("gen.phaseChapters")
                                    : phase === "tts" || rows.length > 0
                                        ? `${readyCount} / ${total}`
                                        : null}
                </span>
            </div>

            {isGuestPreview ? (
                <p className="px-4 py-2 text-xs font-medium" style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--divider)" }}>
                    {t("gen.guestPreviewHint")}
                </p>
            ) : null}

            <ul className="max-h-56 overflow-y-auto divide-y" style={{ divideColor: "var(--divider)" }}>
                {rows.length === 0 && phase ? (
                    <li className="px-4 py-6 text-center text-sm space-y-2" style={{ color: "var(--text-muted)" }}>
                        <p>
                            {phase === "extracting"
                                ? t("gen.phaseExtracting")
                                : phase === "starting"
                                    ? t("gen.phaseStarting")
                                    : phase === "cleaning"
                                        ? t("gen.phaseCleaning")
                                        : t("gen.waitingSegments")}
                        </p>
                        {phase === "tts" && (segmentsTotal ?? 0) > 1 ? (
                            <p className="text-xs">{t("gen.ttsSlowHint")}</p>
                        ) : null}
                    </li>
                ) : null}
                {rows.map((row) => {
                    const isActive = playingRowKey === row.key;
                    return (
                        <li key={row.key}>
                            <div
                                className="w-full flex items-start gap-3 px-4 py-3"
                                style={{ background: isActive ? "var(--hover-bg)" : "transparent" }}
                            >
                                <button
                                    type="button"
                                    disabled={!row.ready}
                                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-extrabold disabled:opacity-40"
                                    style={{
                                        background: isActive
                                            ? "linear-gradient(135deg, #408A71, #285A48)"
                                            : "var(--card-bg)",
                                        color: isActive ? "#fff" : "var(--text-muted)",
                                        border: isActive ? "none" : "1px solid var(--divider)",
                                    }}
                                    onClick={() => playRow(row)}
                                    title={t("gen.play")}
                                >
                                    {isActive && isPlaying ? "❚❚" : "▶"}
                                </button>
                                <button
                                    type="button"
                                    disabled={!row.ready}
                                    className="min-w-0 flex-1 text-left disabled:opacity-50"
                                    onClick={() => playRow(row)}
                                >
                                    <span
                                        className="block text-sm font-semibold truncate"
                                        style={{ color: "var(--text-primary)" }}
                                    >
                                        {row.label}
                                        {!row.ready ? ` (${t("gen.generating")})` : ""}
                                    </span>
                                    <span
                                        className="block text-xs mt-0.5 line-clamp-2"
                                        style={{ color: "var(--text-muted)" }}
                                    >
                                        {row.preview}
                                    </span>
                                </button>
                                <span className="text-[10px] font-bold shrink-0" style={{ color: "var(--text-faint)" }}>
                                    {row.charCount} {t("gen.charsAbbr")}
                                </span>
                            </div>
                        </li>
                    );
                })}
            </ul>

            {currentSeg?.audio_link ? (
                <div className="px-4 py-3" style={{ borderTop: "1px solid var(--divider)" }}>
                    <audio
                        ref={audioRef}
                        controls
                        className="w-full"
                        preload="auto"
                        onPlay={() => setIsPlaying(true)}
                        onPause={() => setIsPlaying(false)}
                        onEnded={handleEnded}
                    />
                    <button
                        type="button"
                        className="mt-2 text-xs font-bold"
                        style={{ color: "var(--link-accent)" }}
                        onClick={togglePlayPause}
                    >
                        {isPlaying ? t("gen.pause") : t("gen.play")}
                    </button>
                </div>
            ) : null}
        </div>
    );
}
