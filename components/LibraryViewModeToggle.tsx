"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
    loadLibraryUi,
    setPersistedLibraryViewMode,
    type LibraryViewMode,
} from "@/lib/libraryUiStorage";

function GridIcon() {
    return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z" />
        </svg>
    );
}

function ListIcon() {
    return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M4 6.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zM9.5 5h10.5v3H9.5V5zM4 12a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zm5.5-1.5h10.5v3H9.5v-3zM4 17.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zm5.5-1.5h10.5v3H9.5v-3z" />
        </svg>
    );
}

/**
 * Buton in header: icon reflecta modul curent; la hover, title indica modul la care treci (EN).
 */
export function LibraryViewModeToggle({ className = "" }: { className?: string }) {
    const { t } = useI18n();
    const [viewMode, setViewMode] = useState<LibraryViewMode>("grid");

    useEffect(() => {
        setViewMode(loadLibraryUi().viewMode);
    }, []);

    useEffect(() => {
        const onChange = (e: Event) => {
            const ce = e as CustomEvent<{ mode: LibraryViewMode }>;
            if (ce.detail?.mode === "grid" || ce.detail?.mode === "list") {
                setViewMode(ce.detail.mode);
            }
        };
        window.addEventListener("audiobooks-library-view-mode", onChange);
        return () => window.removeEventListener("audiobooks-library-view-mode", onChange);
    }, []);

    const toggle = useCallback(() => {
        const next: LibraryViewMode = viewMode === "grid" ? "list" : "grid";
        setPersistedLibraryViewMode(next);
    }, [viewMode]);

    const isGrid = viewMode === "grid";
    const hoverLabel = isGrid ? t("library.switchToListView") : t("library.switchToGridView");

    return (
        <button
            type="button"
            onClick={toggle}
            className={`group relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors duration-200 ${className}`}
            style={{
                borderColor: "var(--theme-toggle-border)",
                background: "var(--theme-toggle-bg)",
                color: "var(--theme-toggle-fg)",
            }}
            aria-label={hoverLabel}
        >
            {isGrid ? <GridIcon /> : <ListIcon />}
            <span
                className="pointer-events-none absolute left-1/2 top-full z-[70] mt-2 -translate-x-1/2 whitespace-nowrap rounded-lg px-2 py-1 text-[11px] font-bold opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                style={{
                    background: "var(--card-bg)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border-card)",
                    boxShadow: "var(--shadow-dropdown)",
                }}
                role="tooltip"
            >
                {hoverLabel}
            </span>
        </button>
    );
}
