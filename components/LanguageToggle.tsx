"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n, type Locale } from "@/lib/i18n";

type Props = {
    /** Varianta pentru header-ul verde al landing-ului. */
    onBrandBar?: boolean;
    className?: string;
};

const LOCALES: Locale[] = ["ro", "en"];

/** Selector limbă RO/EN — meniu dropdown. */
export function LanguageToggle({ onBrandBar, className = "" }: Props) {
    const { locale, setLocale, t } = useI18n();
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const inchide = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        const peEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("mousedown", inchide);
        document.addEventListener("keydown", peEscape);
        return () => {
            document.removeEventListener("mousedown", inchide);
            document.removeEventListener("keydown", peEscape);
        };
    }, [open]);

    const shortLabel = locale === "ro" ? "RO" : "EN";

    const pick = (l: Locale) => {
        setLocale(l);
        setOpen(false);
    };

    const triggerStyle = onBrandBar
        ? {
              borderColor: "rgba(176,228,204,0.35)",
              background: "rgba(255,255,255,0.12)",
              color: "#ffffff",
          }
        : {
              borderColor: "var(--theme-toggle-border)",
              background: "var(--theme-toggle-bg)",
              color: "var(--theme-toggle-fg)",
          };

    const menuStyle = onBrandBar
        ? {
              background: "rgba(9,20,19,0.92)",
              border: "1px solid rgba(255,255,255,0.2)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
          }
        : {
              background: "var(--card-bg)",
              border: "1px solid var(--border-card)",
              boxShadow: "var(--shadow-dropdown)",
          };

    return (
        <div ref={rootRef} className={`relative ${className}`}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                aria-haspopup="listbox"
                aria-label={t("settings.cardLanguage")}
                className="inline-flex h-9 min-w-[3.25rem] items-center justify-center gap-1 rounded-xl border px-2.5 text-xs font-extrabold uppercase tracking-wide transition-colors duration-200"
                style={triggerStyle}
                onMouseEnter={(e) => {
                    if (!onBrandBar) e.currentTarget.style.background = "var(--hover-bg)";
                }}
                onMouseLeave={(e) => {
                    if (!onBrandBar) e.currentTarget.style.background = "var(--theme-toggle-bg)";
                }}
            >
                <span>{shortLabel}</span>
                <span className="text-[10px] opacity-70" aria-hidden>
                    {open ? "▴" : "▾"}
                </span>
            </button>

            {open ? (
                <div
                    className="absolute right-0 top-full z-[80] mt-1.5 min-w-[9rem] overflow-hidden rounded-xl py-1"
                    style={menuStyle}
                    role="listbox"
                    aria-label={t("settings.cardLanguage")}
                >
                    {LOCALES.map((l) => {
                        const active = locale === l;
                        const label = l === "ro" ? t("settings.langRo") : t("settings.langEn");
                        return (
                            <button
                                key={l}
                                type="button"
                                role="option"
                                aria-selected={active}
                                onClick={() => pick(l)}
                                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-semibold transition-colors duration-150"
                                style={{
                                    color: active
                                        ? onBrandBar
                                            ? "#B0E4CC"
                                            : "var(--heading-on-surface)"
                                        : onBrandBar
                                          ? "rgba(255,255,255,0.85)"
                                          : "var(--text-body)",
                                    background: active
                                        ? onBrandBar
                                            ? "rgba(255,255,255,0.1)"
                                            : "var(--hover-bg)"
                                        : "transparent",
                                }}
                                onMouseEnter={(e) => {
                                    if (!active) {
                                        e.currentTarget.style.background = onBrandBar
                                            ? "rgba(255,255,255,0.08)"
                                            : "var(--hover-bg)";
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!active) e.currentTarget.style.background = "transparent";
                                }}
                            >
                                <span>{label}</span>
                                {active ? (
                                    <span className="text-xs font-extrabold" aria-hidden>
                                        ✓
                                    </span>
                                ) : null}
                            </button>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
