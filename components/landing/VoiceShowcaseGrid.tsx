"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchTtsVoices, ttsPreviewUrl, type TtsVoiceOption } from "@/lib/api";
import { playLandingPreview, stopLandingPreview, subscribeLandingPreviewStop } from "@/lib/landingPreviewAudio";
import { useI18n } from "@/lib/i18n";
import { showToast } from "@/lib/toast";

// Filtrul de voci de pe landing: toate, doar romanesti sau doar englezesti.
type VoiceFilter = "all" | "ro" | "en";

// Verific daca o voce se potriveste cu filtrul ales (dupa limba demo-ului).
function voiceMatchesFilter(voice: TtsVoiceOption, filter: VoiceFilter): boolean {
    if (filter === "all") return true;
    const demo = voice.demo_locale ?? (voice.id.startsWith("en-") ? "en" : "ro");
    return demo === filter;
}

/** Grila de voci de pe pagina de prezentare, fiecare cu buton de preview audio. */
export function VoiceShowcaseGrid() {
    const { t, locale } = useI18n();
    const [voices, setVoices] = useState<TtsVoiceOption[]>([]);  // vocile aduse de la server
    const [loading, setLoading] = useState(true);                // se incarca lista?
    const [filter, setFilter] = useState<VoiceFilter>("all");    // filtrul activ
    const [previewingId, setPreviewingId] = useState<string | null>(null);  // ce voce se asculta acum

    // Daca alt preview porneste (ex. demo-ul principal), playerul comun ma anunta sa ma "dezactivez".
    useEffect(() => {
        return subscribeLandingPreviewStop(() => setPreviewingId(null));
    }, []);

    // Reincarc vocile cand se schimba limba interfetei.
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetchTtsVoices(locale).then((list) => {
            if (cancelled) return;
            setVoices(list);
            setLoading(false);
        });
        return () => {
            cancelled = true;
        };
    }, [locale]);

    // Vocile afisate dupa aplicarea filtrului curent.
    const filtered = useMemo(
        () => voices.filter((v) => voiceMatchesFilter(v, filter)),
        [voices, filter],
    );

    // Pornesc/opresc preview-ul unei voci (folosesc playerul comun ca sa cante un singur demo o data).
    const togglePreview = useCallback(
        async (voice: TtsVoiceOption) => {
            const voiceId = voice.id;
            const demoLocale = voice.demo_locale ?? (voiceId.startsWith("en-") ? "en" : "ro");

            // Daca aceasta voce canta deja, butonul devine "stop".
            if (previewingId === voiceId) {
                stopLandingPreview();
                setPreviewingId(null);
                return;
            }

            // Altfel pornesc demo-ul; marchez "playing" doar daca a inceput, iar la eroare arat un toast.
            const ok = await playLandingPreview(ttsPreviewUrl(voiceId, demoLocale));
            setPreviewingId(ok ? voiceId : null);
            if (!ok) showToast(t("home.ttsVoicePreviewError"), "error");
        },
        [previewingId, t],
    );

    const filterBtn = (id: VoiceFilter, label: string) => {
        const active = filter === id;
        return (
            <button
                type="button"
                onClick={() => setFilter(id)}
                className="rounded-xl px-4 py-2 text-xs font-extrabold transition-all duration-200"
                style={{
                    background: active ? "linear-gradient(135deg, #408A71, #285A48)" : "var(--card-bg-muted)",
                    color: active ? "#fff" : "var(--text-body)",
                    border: `2px solid ${active ? "transparent" : "var(--border-card)"}`,
                }}
            >
                {label}
            </button>
        );
    };

    return (
        <section id="voices" className="px-5 py-14 lg:px-10 lg:py-16" style={{ background: "var(--page-bg)" }}>
            <div className="mx-auto max-w-5xl">
                <h2 className="text-2xl font-extrabold sm:text-3xl" style={{ color: "var(--text-primary)" }}>
                    {t("intro.voicesTitle")}
                </h2>
                <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed" style={{ color: "var(--text-muted)" }}>
                    {t("intro.voicesHint")}
                </p>

                <div className="mt-6 flex flex-wrap gap-2">
                    {filterBtn("all", t("intro.voicesFilterAll"))}
                    {filterBtn("ro", t("intro.voicesFilterRo"))}
                    {filterBtn("en", t("intro.voicesFilterEn"))}
                </div>

                {loading ? (
                    <p className="mt-8 text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                        {t("intro.loading")}
                    </p>
                ) : (
                    <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {filtered.map((voice) => {
                            const playing = previewingId === voice.id;
                            return (
                                <div
                                    key={voice.id}
                                    className="flex items-start gap-3 rounded-2xl border p-4"
                                    style={{
                                        background: "var(--card-bg)",
                                        borderColor: "var(--border-card)",
                                        boxShadow: "var(--shadow-card-sm)",
                                    }}
                                >
                                    <button
                                        type="button"
                                        onClick={() => void togglePreview(voice)}
                                        aria-label={`${t("home.ttsVoicePreview")} — ${voice.name}`}
                                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                                        style={{
                                            background: playing
                                                ? "linear-gradient(135deg, #C4933F, #8B6914)"
                                                : "linear-gradient(135deg, #408A71, #285A48)",
                                        }}
                                    >
                                        {playing ? "■" : "▶"}
                                    </button>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-base font-extrabold" style={{ color: "var(--heading-on-surface)" }}>
                                            {voice.name}
                                        </p>
                                        <p className="mt-0.5 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                                            {voice.trait} · {voice.language}
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </section>
    );
}
