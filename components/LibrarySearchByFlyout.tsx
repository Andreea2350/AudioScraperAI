"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
    LIBRARY_FILTERS_CHANGE_EVENT,
    emitLibraryFiltersChange,
    loadLibraryUi,
    patchLibraryUi,
    type LibraryFiltersDetail,
} from "@/lib/libraryUiStorage";

function SearchIcon() {
    return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" strokeLinecap="round" />
        </svg>
    );
}

function pushNameFilter(nameFilter: string) {
    const s = patchLibraryUi({ nameFilter });
    emitLibraryFiltersChange({ nameFilter, sortKey: s.sortKey, sortDir: s.sortDir });
}

export function LibrarySearchByFlyout({ className = "" }: { className?: string }) {
    const { t } = useI18n();
    const [open, setOpen] = useState(false);
    const [draftName, setDraftName] = useState("");
    const wrapRef = useRef<HTMLDivElement>(null);

    const syncFromStorage = useCallback(() => {
        setDraftName(loadLibraryUi().nameFilter ?? "");
    }, []);

    useEffect(() => {
        syncFromStorage();
    }, [syncFromStorage]);

    useEffect(() => {
        const onFilters = (e: Event) => {
            const d = (e as CustomEvent<LibraryFiltersDetail>).detail;
            if (d) setDraftName(d.nameFilter);
        };
        window.addEventListener(LIBRARY_FILTERS_CHANGE_EVENT, onFilters);
        return () => window.removeEventListener(LIBRARY_FILTERS_CHANGE_EVENT, onFilters);
    }, []);

    useEffect(() => {
        if (!open) return;
        syncFromStorage();
    }, [open, syncFromStorage]);

    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            if (wrapRef.current?.contains(e.target as Node)) return;
            setOpen(false);
        };
        const onEsc = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("mousedown", onDoc);
        document.addEventListener("keydown", onEsc);
        return () => {
            document.removeEventListener("mousedown", onDoc);
            document.removeEventListener("keydown", onEsc);
        };
    }, [open]);

    const hasQuery = draftName.trim().length > 0;
    const tooltip = t("library.searchTooltip");

    return (
        <div className={`relative ${className}`} ref={wrapRef}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className={`group relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors duration-200 ${
                    open ? "ring-2 ring-[#408A71]/40" : ""
                }`}
                style={{
                    borderColor: open || hasQuery ? "#408A71" : "var(--theme-toggle-border)",
                    background: hasQuery ? "rgba(64, 138, 113, 0.12)" : "var(--theme-toggle-bg)",
                    color: "var(--theme-toggle-fg)",
                }}
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-label={tooltip}
            >
                <SearchIcon />
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
                    {tooltip}
                </span>
            </button>

            {open && (
                <div
                    className="absolute right-0 top-full z-[60] mt-2 w-[min(calc(100vw-1.5rem),18rem)] overflow-hidden rounded-2xl"
                    style={{
                        animation: "fade-in 0.22s ease-out",
                        background: "var(--card-bg)",
                        color: "var(--text-primary)",
                        boxShadow: "var(--shadow-modal)",
                        border: "1px solid var(--border-card)",
                    }}
                    role="dialog"
                    aria-label={tooltip}
                >
                    <div
                        className="absolute left-0 right-0 top-0 h-0.5"
                        style={{
                            background: "linear-gradient(to right, #408A71, #B0E4CC, transparent)",
                        }}
                    />
                    <div className="flex items-center gap-2 p-3 pt-3.5">
                        <div className="relative min-w-0 flex-1">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]">
                                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                    <circle cx="11" cy="11" r="7" />
                                    <path d="m21 21-4.3-4.3" strokeLinecap="round" />
                                </svg>
                            </span>
                            <input
                                type="search"
                                value={draftName}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    setDraftName(v);
                                    pushNameFilter(v);
                                }}
                                placeholder={t("library.placeholderTitle")}
                                aria-label={t("library.placeholderTitle")}
                                className="w-full rounded-xl py-2 pl-9 pr-3 text-xs font-semibold outline-none transition-[box-shadow,border-color] duration-150"
                                style={{
                                    border: "2px solid var(--input-border)",
                                    background: "var(--input-bg)",
                                    color: "var(--text-body)",
                                }}
                                onFocus={(e) => {
                                    e.target.style.borderColor = "#408A71";
                                    e.target.style.boxShadow = "0 0 0 3px rgba(64, 138, 113, 0.2)";
                                }}
                                onBlur={(e) => {
                                    e.target.style.borderColor = "var(--input-border)";
                                    e.target.style.boxShadow = "none";
                                }}
                                autoFocus
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg font-bold leading-none transition-colors"
                            style={{ color: "var(--text-muted)", background: "var(--card-bg-muted)" }}
                            aria-label={t("library.closePanel")}
                        >
                            ×
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
