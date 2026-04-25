"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { applyTheme, readDomTheme } from "@/lib/theme";

export function ThemeToggle({
    className = "",
    onBrandBar = false,
}: {
    className?: string;
    /** Cand e true, culorile butonului se citesc pe fundalul verde din header-ul paginii intro. */
    onBrandBar?: boolean;
}) {
    const { t } = useI18n();
    const [mode, setMode] = useState<"light" | "dark">("light");

    useEffect(() => {
        setMode(readDomTheme());
    }, []);

    const toggle = useCallback(() => {
        const next = readDomTheme() === "dark" ? "light" : "dark";
        applyTheme(next);
        setMode(next);
    }, []);

    const isDark = mode === "dark";
    const tooltipLabel = isDark ? t("theme.switchToLight") : t("theme.switchToDark");

    const surfaceStyle = {
        borderColor: "var(--theme-toggle-border)",
        background: "var(--theme-toggle-bg)",
        color: "var(--theme-toggle-fg)",
    } as const;
    const brandStyle = {
        borderColor: "rgba(176,228,204,0.35)",
        background: "rgba(255,255,255,0.12)",
        color: "#ffffff",
    } as const;

    return (
        <button
            type="button"
            onClick={toggle}
            className={`group relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors duration-200 ${className}`}
            style={onBrandBar ? brandStyle : surfaceStyle}
            aria-label={tooltipLabel}
            aria-pressed={isDark}
        >
            {isDark ? (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M12 3a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V4a1 1 0 0 1 1-1zm5.657 2.343a1 1 0 0 1 1.414 0l.707.707a1 1 0 1 1-1.414 1.414l-.707-.707a1 1 0 0 1 0-1.414zM21 11a1 1 0 1 1 0 2h-1a1 1 0 1 1 0-2h1zm-2.929 7.071a1 1 0 0 1 0 1.414l-.707.707a1 1 0 1 1-1.414-1.414l.707-.707a1 1 0 0 1 1.414 0zM12 20a1 1 0 0 1-1-1v-1a1 1 0 1 1 2 0v1a1 1 0 0 1-1 1zm-7.071-2.929a1 1 0 0 1-1.414 0l-.707-.707a1 1 0 1 1 1.414-1.414l.707.707a1 1 0 0 1 0 1.414zM4 13a1 1 0 1 1 0-2H3a1 1 0 1 1 0 2h1zm2.343-9.657a1 1 0 0 1 1.414 0l.707.707A1 1 0 1 1 7.05 5.464l-.707-.707a1 1 0 0 1 0-1.414zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z" />
                </svg>
            ) : (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 8.5 8.5 0 1 0 21 14.5z" />
                </svg>
            )}
            <span
                className="pointer-events-none absolute left-1/2 top-full z-[70] mt-2 -translate-x-1/2 whitespace-nowrap rounded-lg px-2 py-1 text-[11px] font-bold opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                style={
                    onBrandBar
                        ? {
                              background: "rgba(0,0,0,0.55)",
                              color: "#ffffff",
                              border: "1px solid rgba(255,255,255,0.25)",
                              boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                          }
                        : {
                              background: "var(--card-bg)",
                              color: "var(--text-primary)",
                              border: "1px solid var(--border-card)",
                              boxShadow: "var(--shadow-dropdown)",
                          }
                }
                role="tooltip"
            >
                {tooltipLabel}
            </span>
        </button>
    );
}
