"use client";

/**
 * Dropdown voce TTS: nume, trait, limba, buton play pentru demo scurt.
 * Preferinta se salveaza in localStorage prin callback-ul onChange.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTtsVoices, ttsPreviewUrl, type TtsVoiceOption } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { DEFAULT_TTS_VOICE } from "@/lib/ttsVoiceStorage";

type Props = {
    value: string;
    onChange: (voiceId: string) => void;
    disabled?: boolean;
    compact?: boolean;
};

export function TtsVoicePicker({ value, onChange, disabled = false, compact = false }: Props) {
    const { t, locale } = useI18n();
    const [voices, setVoices] = useState<TtsVoiceOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);
    const [previewingId, setPreviewingId] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);

    /* --- Incarc catalogul de voci la schimbarea limbii UI --- */
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetchTtsVoices(locale).then((list) => {
            if (cancelled) return;
            setVoices(list.length ? list : []);
            setLoading(false);
        });
        return () => {
            cancelled = true;
        };
    }, [locale]);

    /* --- Inchid dropdown la click in afara --- */
    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
    }, [open]);

    /* --- Opreste preview la demontare --- */
    useEffect(() => {
        return () => {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
        };
    }, []);

    const selected =
        voices.find((v) => v.id === value) ??
        voices.find((v) => v.id === DEFAULT_TTS_VOICE) ??
        voices[0];

    /** Redau sau opresc demo-ul pentru o voce (textul demo e in limba nativa a vocii). */
    const togglePreview = useCallback(
        async (voice: TtsVoiceOption, e: React.MouseEvent) => {
            e.stopPropagation();
            e.preventDefault();
            if (disabled) return;

            const voiceId = voice.id;
            const demoLocale = voice.demo_locale ?? (voiceId.startsWith("en-") ? "en" : "ro");

            if (previewingId === voiceId && audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
                setPreviewingId(null);
                return;
            }

            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }

            const audio = new Audio(ttsPreviewUrl(voiceId, demoLocale));
            audioRef.current = audio;
            setPreviewingId(voiceId);
            audio.onended = () => setPreviewingId(null);
            audio.onerror = () => {
                setPreviewingId(null);
                alert(t("home.ttsVoicePreviewError"));
            };
            try {
                await audio.play();
            } catch {
                setPreviewingId(null);
                alert(t("home.ttsVoicePreviewError"));
            }
        },
        [disabled, previewingId, t],
    );

    const pickVoice = (voiceId: string) => {
        onChange(voiceId);
        setOpen(false);
    };

    return (
        <div ref={rootRef} className={`relative ${compact ? "" : "mt-3 mb-1"}`}>
            <span
                className="block text-xs font-extrabold uppercase tracking-widest mb-2"
                style={{ color: "var(--text-muted)" }}
            >
                {t("home.ttsVoiceLabel")}
            </span>

            <button
                type="button"
                disabled={disabled || loading}
                onClick={() => setOpen((o) => !o)}
                className="w-full text-left rounded-xl px-4 py-3 flex items-center justify-between gap-3 disabled:opacity-50 transition-colors"
                style={{
                    border: "2px solid var(--input-border)",
                    background: "var(--input-bg)",
                    color: "var(--text-body)",
                }}
                aria-expanded={open}
                aria-haspopup="listbox"
            >
                {loading ? (
                    <span className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                        {t("home.ttsVoiceLoading")}
                    </span>
                ) : selected ? (
                    <span className="min-w-0 flex-1">
                        <span className="block text-sm font-extrabold truncate" style={{ color: "var(--heading-on-surface)" }}>
                            {selected.name}
                        </span>
                        <span className="block text-xs font-medium truncate" style={{ color: "var(--text-muted)" }}>
                            {selected.trait} · {selected.language}
                        </span>
                    </span>
                ) : (
                    <span className="text-sm font-medium">{DEFAULT_TTS_VOICE}</span>
                )}
                <span className="text-xs font-bold shrink-0" style={{ color: "var(--text-muted)" }} aria-hidden>
                    {open ? "▲" : "▼"}
                </span>
            </button>

            {!compact ? (
                <p className="mt-1.5 px-1 text-xs font-medium leading-snug" style={{ color: "var(--text-muted)" }}>
                    {t("home.ttsVoiceHint")}
                </p>
            ) : null}

            {open && !loading && voices.length > 0 ? (
                <ul
                    role="listbox"
                    className="absolute z-40 mt-2 w-full max-h-64 overflow-y-auto rounded-xl shadow-lg"
                    style={{
                        background: "var(--card-bg)",
                        border: "1px solid var(--border-card)",
                        boxShadow: "var(--shadow-modal)",
                    }}
                >
                    {voices.map((voice) => {
                        const active = voice.id === (selected?.id ?? value);
                        const isPlaying = previewingId === voice.id;
                        return (
                            <li key={voice.id} role="option" aria-selected={active}>
                                <div
                                    className="flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-colors"
                                    style={{
                                        background: active ? "var(--hover-bg-strong)" : "transparent",
                                    }}
                                    onClick={() => pickVoice(voice.id)}
                                    onMouseEnter={(e) => {
                                        if (!active) e.currentTarget.style.background = "var(--hover-bg)";
                                    }}
                                    onMouseLeave={(e) => {
                                        if (!active) e.currentTarget.style.background = "transparent";
                                    }}
                                >
                                    <button
                                        type="button"
                                        title={isPlaying ? t("home.ttsVoicePreviewStop") : t("home.ttsVoicePreview")}
                                        aria-label={
                                            isPlaying
                                                ? `${t("home.ttsVoicePreviewStop")} — ${voice.name}`
                                                : `${t("home.ttsVoicePreview")} — ${voice.name}`
                                        }
                                        disabled={disabled}
                                        onClick={(e) => togglePreview(voice, e)}
                                        className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold disabled:opacity-50"
                                        style={{
                                            background: isPlaying
                                                ? "linear-gradient(135deg, #C4933F, #8B6914)"
                                                : "linear-gradient(135deg, #408A71, #285A48)",
                                        }}
                                    >
                                        {isPlaying ? "■" : "▶"}
                                    </button>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm font-extrabold truncate" style={{ color: "var(--heading-on-surface)" }}>
                                            {voice.name}
                                            {active ? (
                                                <span className="ml-2 text-[10px] font-extrabold uppercase tracking-wide" style={{ color: "#408A71" }}>
                                                    ✓
                                                </span>
                                            ) : null}
                                        </div>
                                        <div className="text-xs font-medium truncate" style={{ color: "var(--text-muted)" }}>
                                            {voice.trait} · {voice.language}
                                        </div>
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            ) : null}
        </div>
    );
}
