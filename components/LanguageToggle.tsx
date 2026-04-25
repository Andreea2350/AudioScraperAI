"use client";

import { useI18n, type Locale } from "@/lib/i18n";

type Props = {
    /** Acelasi principiu ca la ThemeToggle: varianta pentru header-ul verde al landing-ului. */
    onBrandBar?: boolean;
};

export function LanguageToggle({ onBrandBar }: Props) {
    const { locale, setLocale, t } = useI18n();

    const pill = (l: Locale, label: string) => {
        const active = locale === l;
        return (
            <button
                type="button"
                onClick={() => setLocale(l)}
                aria-pressed={active}
                className="min-w-[2.75rem] px-2.5 py-1.5 text-[11px] font-extrabold uppercase tracking-wider rounded-lg transition-colors"
                style={
                    onBrandBar
                        ? {
                              background: active ? "rgba(255,255,255,0.2)" : "transparent",
                              color: active ? "#fff" : "rgba(255,255,255,0.75)",
                              border: active ? "1px solid rgba(255,255,255,0.35)" : "1px solid transparent",
                          }
                        : {
                              background: active ? "linear-gradient(135deg, #408A71, #285A48)" : "var(--card-bg-muted)",
                              color: active ? "#fff" : "var(--text-body)",
                              border: `1px solid ${active ? "transparent" : "var(--border-card)"}`,
                              boxShadow: active ? "var(--shadow-btn-sm)" : "none",
                          }
                }
            >
                {label}
            </button>
        );
    };

    return (
        <div
            className="flex items-center gap-0.5 rounded-xl p-0.5"
            style={
                onBrandBar
                    ? { background: "rgba(0,0,0,0.15)" }
                    : { background: "var(--card-bg-muted)", border: "1px solid var(--border-card)" }
            }
            role="group"
            aria-label={t("settings.cardLanguage")}
        >
            {pill("ro", t("settings.langRo"))}
            {pill("en", t("settings.langEn"))}
        </div>
    );
}
