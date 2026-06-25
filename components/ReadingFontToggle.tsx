"use client";

import { useI18n } from "@/lib/i18n";
import { useReadingFont } from "@/lib/readingFont";

type Props = {
    /** Compact: buton „Aa” pentru header secțiune. settings: rând cu etichetă în Setări. */
    variant?: "compact" | "settings";
    className?: string;
};

/** Comutatorul fontului prietenos la citit (Lexend). Are doua infatisari: un buton mic "Aa" sau un rand cu eticheta in Setari. */
export function ReadingFontToggle({ variant = "compact", className = "" }: Props) {
    const { t } = useI18n();
    // enabled = e pornit fontul?; setEnabled/toggle vin din hook-ul care salveaza preferinta in localStorage.
    const { enabled, setEnabled, toggle } = useReadingFont();

    // Varianta "settings": un checkbox mare cu titlu si explicatie, pentru pagina de setari.
    if (variant === "settings") {
        return (
            <label
                className={`flex cursor-pointer items-start gap-3.5 rounded-2xl border-2 p-4 transition-colors duration-200 ${className}`}
                style={{
                    borderColor: enabled ? "#408A71" : "var(--border-card)",
                    background: enabled ? "rgba(64,138,113,0.1)" : "var(--card-bg-muted)",
                }}
            >
                <input
                    type="checkbox"
                    className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded accent-[#408A71]"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                />
                <span className="min-w-0">
                    <span
                        className="block text-sm font-extrabold leading-snug"
                        style={{ color: "var(--heading-on-surface)" }}
                    >
                        {t("readingFont.title")}
                    </span>
                    <span
                        className="mt-1.5 block text-xs font-medium leading-relaxed"
                        style={{ color: "var(--text-muted)" }}
                    >
                        {t("readingFont.hint")}
                    </span>
                </span>
            </label>
        );
    }

    // Varianta "compact" (implicita): un simplu buton "Aa" care comuta fontul la click.
    return (
        <button
            type="button"
            onClick={toggle}
            aria-pressed={enabled}
            aria-label={t("readingFont.toggleAria")}
            title={enabled ? t("readingFont.on") : t("readingFont.off")}
            className={`inline-flex h-9 min-w-[2.25rem] items-center justify-center rounded-xl border px-2.5 text-sm font-extrabold transition-all duration-200 ${className}`}
            style={{
                borderColor: enabled ? "#408A71" : "var(--border-card)",
                background: enabled ? "rgba(64,138,113,0.14)" : "var(--card-bg-muted)",
                color: enabled ? "var(--heading-on-surface)" : "var(--text-muted)",
                boxShadow: enabled ? "0 0 0 1px rgba(64,138,113,0.25)" : "none",
            }}
        >
            Aa
        </button>
    );
}
