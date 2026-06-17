"use client";

/* Player + coada segmente TTS: full MP3 principal, sectiuni optionale, redare continua. */
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
    startIndex: number;
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
    /** MP3 complet lipit — player principal in biblioteca. */
    fullAudioUrl?: string | null;
    /** live = generare in curs; library = carte salvata. */
    variant?: "live" | "library";
};

export function GenerationPlaylist({
    segments,
    phase,
    segmentsTotal,
    playlistMode = "parts",
    activeIndex: _activeIndex,
    onActiveChange,
    onGuestPreviewFinished,
    isGuestPreview,
    fullAudioUrl,
    variant = "live",
}: Props) {
    const { t, locale } = useI18n();
    const fullAudioRef = useRef<HTMLAudioElement | null>(null);
    const queueAudioRef = useRef<HTMLAudioElement | null>(null);
    const [playingFlatIdx, setPlayingFlatIdx] = useState<number | null>(null);
    const [playAllActive, setPlayAllActive] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [sectionsOpen, setSectionsOpen] = useState(false);

    const flatSegments = useMemo(
        () => [...segments].filter((s) => s.audio_link).sort((a, b) => a.index - b.index),
        [segments],
    );

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
                    const title =
                        sorted[0]?.chapter_title ||
                        (locale === "en" ? `Chapter ${ci + 1}` : `Capitol ${ci + 1}`);
                    return {
                        key: `ch-${ci}`,
                        label: title,
                        preview: sorted[0]?.text_preview ?? "",
                        charCount: sorted.reduce((n, x) => n + x.char_count, 0),
                        segments: sorted,
                        ready: sorted.every((x) => Boolean(x.audio_link)),
                        startIndex: sorted[0]?.index ?? 0,
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
                startIndex: s.index,
            }));
    }, [segments, playlistMode, locale]);

    const currentSeg =
        playingFlatIdx != null && playingFlatIdx >= 0 && playingFlatIdx < flatSegments.length
            ? flatSegments[playingFlatIdx]
            : null;

    const jumpToSegment = useCallback(
        (seg: GenerationSegment, enablePlayAll: boolean) => {
            const idx = flatSegments.findIndex((s) => s.index === seg.index);
            if (idx < 0) return;
            setPlayingFlatIdx(idx);
            setPlayAllActive(enablePlayAll);
            setIsPlaying(true);
            onActiveChange?.(seg.index);
        },
        [flatSegments, onActiveChange],
    );

    const playAll = useCallback(() => {
        if (flatSegments.length === 0) return;
        setPlayingFlatIdx(0);
        setPlayAllActive(true);
        setIsPlaying(true);
        onActiveChange?.(flatSegments[0].index);
    }, [flatSegments, onActiveChange]);

    useEffect(() => {
        const audio = queueAudioRef.current;
        if (!audio || !playAllActive) return;
        if (currentSeg?.audio_link) {
            if (audio.src !== currentSeg.audio_link) {
                audio.src = currentSeg.audio_link;
            }
            if (isPlaying) {
                void audio.play().catch(() => setIsPlaying(false));
            }
        }
    }, [currentSeg?.audio_link, isPlaying, playAllActive, playingFlatIdx]);

    const handleEnded = () => {
        if (!playAllActive || playingFlatIdx == null) {
            setIsPlaying(false);
            return;
        }
        const next = playingFlatIdx + 1;
        if (next < flatSegments.length) {
            setPlayingFlatIdx(next);
            onActiveChange?.(flatSegments[next].index);
            return;
        }
        setPlayAllActive(false);
        setPlayingFlatIdx(null);
        setIsPlaying(false);
        if (isGuestPreview) {
            onGuestPreviewFinished?.();
        }
    };

    const showPanel = Boolean(phase) || segments.length > 0 || Boolean(fullAudioUrl);
    if (!showPanel) return null;

    const total = segmentsTotal ?? rows.length;
    const readyCount =
        playlistMode === "chapters"
            ? rows.filter((r) => r.ready).length
            : segments.filter((s) => s.audio_link).length;

    const showFullFirst = variant === "library" && Boolean(fullAudioUrl);
    const queueLabel =
        playingFlatIdx != null && flatSegments[playingFlatIdx]
            ? playlistMode === "chapters"
                ? `${t("gen.playlistChapters")} · #${playingFlatIdx + 1}`
                : `${t("gen.playlistTitle")} · ${playingFlatIdx + 1} / ${flatSegments.length}`
            : null;

    return (
        <div className="space-y-4">
            {showFullFirst ? (
                <div>
                    <p className="text-xs font-extrabold uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>
                        {t("gen.fullAudiobook")}
                    </p>
                    <audio
                        ref={fullAudioRef}
                        controls
                        className="w-full max-w-2xl"
                        preload="metadata"
                        src={fullAudioUrl ?? undefined}
                        onPlay={() => {
                            setPlayAllActive(false);
                            setPlayingFlatIdx(null);
                            setIsPlaying(true);
                        }}
                        onPause={() => setIsPlaying(false)}
                    />
                    {flatSegments.length > 0 ? (
                        <button
                            type="button"
                            className="mt-3 text-xs font-bold px-4 py-2 rounded-xl"
                            style={{ color: "var(--link-accent)", border: "1px solid var(--divider)" }}
                            onClick={() => setSectionsOpen((o) => !o)}
                        >
                            {sectionsOpen ? t("gen.hideSections") : t("gen.showSections")} ({flatSegments.length})
                        </button>
                    ) : null}
                </div>
            ) : null}

            {(variant === "live" || sectionsOpen || !showFullFirst) && (
                <div
                    className="rounded-2xl overflow-hidden"
                    style={{
                        border: "1px solid var(--border-card)",
                        background: "var(--text-block-bg)",
                    }}
                >
                    <div
                        className="px-4 py-3 flex flex-wrap items-center justify-between gap-2"
                        style={{ borderBottom: "1px solid var(--divider)" }}
                    >
                        <p className="text-xs font-extrabold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                            {variant === "live"
                                ? playlistMode === "chapters"
                                    ? t("gen.playlistChapters")
                                    : t("gen.playlistTitle")
                                : t("gen.sectionsTitle")}
                        </p>
                        <div className="flex items-center gap-2">
                            {phase === "extracting"
                                ? t("gen.phaseExtracting")
                                : phase === "cleaning"
                                  ? t("gen.phaseCleaning")
                                  : phase === "tts" || rows.length > 0
                                    ? `${readyCount} / ${total}`
                                    : null}
                            {flatSegments.length > 1 ? (
                                <button
                                    type="button"
                                    className="text-xs font-bold px-3 py-1 rounded-lg text-white"
                                    style={{ background: "linear-gradient(135deg, #408A71, #285A48)" }}
                                    onClick={playAll}
                                    disabled={flatSegments.length === 0}
                                >
                                    {t("gen.playAll")}
                                </button>
                            ) : null}
                        </div>
                    </div>

                    {isGuestPreview ? (
                        <p className="px-4 py-2 text-xs font-medium" style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--divider)" }}>
                            {t("gen.guestPreviewHint")}
                        </p>
                    ) : null}

                    <ul className="max-h-48 overflow-y-auto divide-y divide-[var(--divider)]">
                        {rows.length === 0 && phase ? (
                            <li className="px-4 py-6 text-center text-sm space-y-2" style={{ color: "var(--text-muted)" }}>
                                <p>{phase === "tts" ? t("gen.waitingSegments") : t("gen.phaseStarting")}</p>
                                {phase === "tts" && (segmentsTotal ?? 0) > 1 ? (
                                    <p className="text-xs">{t("gen.ttsSlowHint")}</p>
                                ) : null}
                            </li>
                        ) : null}
                        {rows.map((row) => {
                            const isActive =
                                playingFlatIdx != null &&
                                row.segments.some((s) => s.index === flatSegments[playingFlatIdx]?.index);
                            return (
                                <li key={row.key}>
                                    <button
                                        type="button"
                                        disabled={!row.ready}
                                        className="w-full flex items-start gap-3 px-4 py-3 text-left disabled:opacity-50"
                                        style={{ background: isActive ? "var(--hover-bg)" : "transparent" }}
                                        onClick={() => {
                                            const seg = row.segments.find((s) => s.audio_link);
                                            if (seg) jumpToSegment(seg, true);
                                        }}
                                    >
                                        <span
                                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-extrabold"
                                            style={{
                                                background: isActive ? "#408A71" : "var(--card-bg)",
                                                color: isActive ? "#fff" : "var(--text-muted)",
                                                border: isActive ? "none" : "1px solid var(--divider)",
                                            }}
                                        >
                                            {row.segments[0]?.index != null ? row.segments[0].index + 1 : "·"}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                                                {row.label}
                                                {!row.ready ? ` (${t("gen.generating")})` : ""}
                                            </span>
                                            <span className="block text-xs mt-0.5 line-clamp-2" style={{ color: "var(--text-muted)" }}>
                                                {row.preview}
                                            </span>
                                        </span>
                                        <span className="text-[10px] font-bold shrink-0" style={{ color: "var(--text-faint)" }}>
                                            {row.charCount} {t("gen.charsAbbr")}
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>

                    {playAllActive && currentSeg?.audio_link ? (
                        <div className="px-4 py-3" style={{ borderTop: "1px solid var(--divider)" }}>
                            {queueLabel ? (
                                <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-muted)" }}>
                                    {queueLabel}
                                </p>
                            ) : null}
                            <audio
                                ref={queueAudioRef}
                                controls
                                className="w-full"
                                preload="auto"
                                onPlay={() => setIsPlaying(true)}
                                onPause={() => setIsPlaying(false)}
                                onEnded={handleEnded}
                            />
                        </div>
                    ) : null}
                </div>
            )}
        </div>
    );
}
