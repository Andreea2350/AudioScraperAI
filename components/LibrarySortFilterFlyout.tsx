"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
    LIBRARY_FILTERS_CHANGE_EVENT,
    emitLibraryFiltersChange,
    loadLibraryUi,
    patchLibraryUi,
    type LibraryFiltersDetail,
    type LibrarySortDir,
    type LibrarySortKey,
} from "@/lib/libraryUiStorage";

function FilterIcon() {
    return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z" />
        </svg>
    );
}

function IconCalendar({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
            <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
            <path d="M3.5 9.5h17M8 3v3M16 3v3" strokeLinecap="round" />
        </svg>
    );
}

function IconText({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
            <path d="M5 7h14M5 12h10M5 17h14" strokeLinecap="round" />
        </svg>
    );
}

function IconRuler({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
            <path d="M8 4.5h8c.8 0 1.5.7 1.5 1.5v12c0 .8-.7 1.5-1.5 1.5H8c-.8 0-1.5-.7-1.5-1.5V6c0-.8.7-1.5 1.5-1.5z" />
            <path d="M10.5 8v.01M10.5 11v.01M10.5 14v.01M10.5 17v.01M13.5 9.5v.01M13.5 13v.01M13.5 16.5v.01" strokeLinecap="round" />
        </svg>
    );
}

function ArrowUp({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 5l6 7H6l6-7z" />
        </svg>
    );
}

function ArrowDown({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 19l-6-7h12l-6 7z" />
        </svg>
    );
}

/** Icon afișat când rândul nu e criteriul activ: sugerează comutare ↑/↓. */
function SortArrowsNeutral({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 5.5 7.5 12h9L12 5.5z" />
            <path d="M12 18.5l4.5-6.5h-9l4.5 6.5z" />
        </svg>
    );
}

function defaultDirForKey(key: LibrarySortKey): LibrarySortDir {
    if (key === "data" || key === "dimensiune") return "desc";
    return "asc";
}

const SORT_ROWS: {
    sortKey: LibrarySortKey;
    labelKey: "library.sortRowName" | "library.sortRowSize" | "library.sortRowDate";
    Icon: typeof IconText;
}[] = [
    { sortKey: "nume", labelKey: "library.sortRowName", Icon: IconText },
    { sortKey: "dimensiune", labelKey: "library.sortRowSize", Icon: IconRuler },
    { sortKey: "data", labelKey: "library.sortRowDate", Icon: IconCalendar },
];

function applySort(nextKey: LibrarySortKey, nextDir: LibrarySortDir) {
    const s = patchLibraryUi({ sortKey: nextKey, sortDir: nextDir });
    emitLibraryFiltersChange({ nameFilter: s.nameFilter, sortKey: nextKey, sortDir: nextDir });
}

export function LibrarySortFilterFlyout({ className = "" }: { className?: string }) {
    const { t } = useI18n();
    const [open, setOpen] = useState(false);
    const [sortKey, setSortKey] = useState<LibrarySortKey>("data");
    const [sortDir, setSortDir] = useState<LibrarySortDir>("desc");
    const wrapRef = useRef<HTMLDivElement>(null);

    const syncFromStorage = useCallback(() => {
        const s = loadLibraryUi();
        setSortKey(s.sortKey);
        setSortDir(s.sortDir);
    }, []);

    useEffect(() => {
        syncFromStorage();
    }, [syncFromStorage]);

    useEffect(() => {
        const onFilters = (e: Event) => {
            const d = (e as CustomEvent<LibraryFiltersDetail>).detail;
            if (!d) return;
            setSortKey(d.sortKey);
            setSortDir(d.sortDir);
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

    const tooltip = t("library.filterTooltip");

    return (
        <div className={`relative ${className}`} ref={wrapRef}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className={`group relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors duration-200 ${
                    open ? "ring-2 ring-[#408A71]/40" : ""
                }`}
                style={{
                    borderColor: open ? "#408A71" : "var(--theme-toggle-border)",
                    background: "var(--theme-toggle-bg)",
                    color: "var(--theme-toggle-fg)",
                }}
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-label={tooltip}
            >
                <FilterIcon />
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
                    className="absolute right-0 top-full z-[60] mt-2 w-[min(calc(100vw-1.5rem),17.5rem)] overflow-hidden rounded-2xl"
                    style={{
                        animation: "fade-in 0.22s ease-out",
                        background: "var(--card-bg)",
                        color: "var(--text-primary)",
                        boxShadow: "var(--shadow-modal)",
                        border: "1px solid var(--border-card)",
                    }}
                    role="dialog"
                    aria-label={t("library.sortMenuTitle")}
                >
                    <div
                        className="relative px-3.5 pb-2.5 pt-3"
                        style={{
                            borderBottom: "1px solid var(--divider)",
                            background: "linear-gradient(165deg, var(--modal-header-from) 0%, var(--modal-header-to) 100%)",
                        }}
                    >
                        <div
                            className="absolute left-0 right-0 top-0 h-0.5 rounded-t-2xl"
                            style={{
                                background: "linear-gradient(to right, #408A71, #B0E4CC, transparent)",
                            }}
                        />
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-extrabold" style={{ color: "var(--heading-on-surface)" }}>
                                {t("library.sortMenuTitle")}
                            </p>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-lg font-bold leading-none"
                                style={{ color: "var(--text-muted)", background: "var(--card-bg-muted)" }}
                                aria-label={t("library.closePanel")}
                            >
                                ×
                            </button>
                        </div>
                    </div>

                    <div className="space-y-1 p-2.5">
                        {SORT_ROWS.map((row) => {
                            const active = sortKey === row.sortKey;
                            const isAsc = active && sortDir === "asc";
                            const isDesc = active && sortDir === "desc";
                            const handleToggle = () => {
                                if (!active) {
                                    const d = defaultDirForKey(row.sortKey);
                                    setSortKey(row.sortKey);
                                    setSortDir(d);
                                    applySort(row.sortKey, d);
                                } else {
                                    const next = sortDir === "asc" ? "desc" : "asc";
                                    setSortDir(next);
                                    applySort(row.sortKey, next);
                                }
                            };
                            const dirLabel = isAsc ? t("library.sortAscending") : isDesc ? t("library.sortDescending") : "";
                            return (
                                <div
                                    key={row.sortKey}
                                    className="flex items-center gap-2 rounded-xl px-2 py-1.5"
                                    style={{
                                        background: "var(--card-bg-muted)",
                                        border: "1px solid var(--border-card)",
                                    }}
                                >
                                    <span
                                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                                        style={{
                                            background: "rgba(64, 138, 113, 0.12)",
                                            color: "#408A71",
                                        }}
                                    >
                                        <row.Icon className="h-4 w-4" />
                                    </span>
                                    <span className="min-w-0 flex-1 text-xs font-extrabold" style={{ color: "var(--text-body)" }}>
                                        {t(row.labelKey)}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={handleToggle}
                                        className="flex h-9 w-10 shrink-0 items-center justify-center rounded-xl border-2 transition-all duration-150"
                                        style={{
                                            borderColor: active ? "#408A71" : "var(--input-border)",
                                            background: active ? "rgba(64, 138, 113, 0.18)" : "var(--input-bg)",
                                            color: active ? "#285A48" : "var(--text-muted)",
                                        }}
                                        aria-label={`${t("library.sortToggleAria")}: ${t(row.labelKey)}${dirLabel ? ` — ${dirLabel}` : ""}`}
                                    >
                                        {isAsc ? (
                                            <ArrowUp className="h-4 w-4" />
                                        ) : isDesc ? (
                                            <ArrowDown className="h-4 w-4" />
                                        ) : (
                                            <SortArrowsNeutral className="h-4 w-4 opacity-70" />
                                        )}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
