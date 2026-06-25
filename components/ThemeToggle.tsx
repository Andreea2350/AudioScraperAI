"use client";

/* Comutator tema light / dark / system, cu stil adaptat pentru header-ul verde al landing-ului. */
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
    applyTheme,
    nextThemePreference,
    readDomTheme,
    readStoredThemePreference,
    resolveEffectiveTheme,
    type ThemePreference,
} from "@/lib/theme";

export function ThemeToggle({
    className = "",
    onBrandBar = false,
}: {
    className?: string;
    /* Cand e true, culorile butonului se citesc pe fundalul verde din header-ul paginii intro. */
    onBrandBar?: boolean;
}) {
    const { t } = useI18n();
    // "preference" = ce a ales userul (light/dark/system); "effective" = ce se vede efectiv pe ecran (light sau dark).
    const [preference, setPreference] = useState<ThemePreference>("system");
    const [effective, setEffective] = useState<"light" | "dark">("light");

    // Citesc preferinta salvata si tema aplicata acum pe pagina, ca butonul sa arate iconita potrivita.
    const syncFromStorage = useCallback(() => {
        const pref = readStoredThemePreference();
        setPreference(pref);
        setEffective(readDomTheme());
    }, []);

    // La montare ma sincronizez cu ce e salvat.
    useEffect(() => {
        syncFromStorage();
    }, [syncFromStorage]);

    /** Daca sunt pe modul "system" si userul schimba tema din setarile sistemului de operare, reaplic ca sa se potriveasca. */
    useEffect(() => {
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const onChange = () => {
            if (readStoredThemePreference() !== "system") return;
            applyTheme("system");
            setEffective(resolveEffectiveTheme("system"));
        };
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    }, []);

    // La click: trec ciclic la urmatoarea preferinta (light -> dark -> system -> light...) si o aplic imediat.
    const cycle = useCallback(() => {
        const next = nextThemePreference(readStoredThemePreference());
        applyTheme(next);
        setPreference(next);
        setEffective(resolveEffectiveTheme(next));
    }, []);

    const tooltipLabel =
        preference === "light"
            ? t("theme.modeLight")
            : preference === "dark"
              ? t("theme.modeDark")
              : t("theme.modeSystem");

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

    const icon =
        preference === "system" ? (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" strokeLinecap="round" />
            </svg>
        ) : effective === "dark" ? (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 3a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V4a1 1 0 0 1 1-1zm5.657 2.343a1 1 0 0 1 1.414 0l.707.707a1 1 0 1 1-1.414 1.414l-.707-.707a1 1 0 0 1 0-1.414zM21 11a1 1 0 1 1 0 2h-1a1 1 0 1 1 0-2h1zm-2.929 7.071a1 1 0 0 1 0 1.414l-.707.707a1 1 0 1 1-1.414-1.414l.707-.707a1 1 0 0 1 1.414 0zM12 20a1 1 0 0 1-1-1v-1a1 1 0 1 1 2 0v1a1 1 0 0 1-1 1zm-7.071-2.929a1 1 0 0 1-1.414 0l-.707-.707a1 1 0 1 1 1.414-1.414l.707.707a1 1 0 0 1 0 1.414zM4 13a1 1 0 1 1 0-2H3a1 1 0 1 1 0 2h1zm2.343-9.657a1 1 0 0 1 1.414 0l.707.707A1 1 0 1 1 7.05 5.464l-.707-.707a1 1 0 0 1 0-1.414zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z" />
            </svg>
        ) : (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 8.5 8.5 0 1 0 21 14.5z" />
            </svg>
        );

    return (
        <button
            type="button"
            onClick={cycle}
            className={`group relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors duration-200 ${className}`}
            style={onBrandBar ? brandStyle : surfaceStyle}
            aria-label={tooltipLabel}
            aria-pressed={effective === "dark"}
        >
            {icon}
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
