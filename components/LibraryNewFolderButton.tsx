"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { emitLibraryFoldersChanged, loadLibraryUi, patchLibraryUi } from "@/lib/libraryUiStorage";

function FolderPlusIcon() {
    return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden>
            <path
                d="M4 6.5A1.5 1.5 0 0 1 5.5 5h3.88a1.5 1.5 0 0 1 1.06.44l1.12 1.12A1.5 1.5 0 0 0 12.62 7H18.5A1.5 1.5 0 0 1 20 8.5V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.5Z"
                strokeLinejoin="round"
            />
            <path d="M12 10v6M9 13h6" strokeLinecap="round" />
        </svg>
    );
}

export function LibraryNewFolderButton({ className = "" }: { className?: string }) {
    const { t } = useI18n();
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");

    const tooltip = t("library.newFolderTooltip");

    const create = () => {
        const trimmed = name.trim();
        if (!trimmed) return;
        const id = `f-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const s = loadLibraryUi();
        patchLibraryUi({ folders: [...s.folders, { id, name: trimmed }] });
        emitLibraryFoldersChanged();
        setName("");
        setOpen(false);
    };

    return (
        <>
            <button
                type="button"
                onClick={() => {
                    setName("");
                    setOpen(true);
                }}
                className={`group relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors duration-200 ${className}`}
                style={{
                    borderColor: "var(--theme-toggle-border)",
                    background: "var(--theme-toggle-bg)",
                    color: "var(--theme-toggle-fg)",
                }}
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-label={tooltip}
            >
                <FolderPlusIcon />
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
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    style={{
                        background: "var(--overlay-scrim)",
                        backdropFilter: "blur(6px)",
                        animation: "fade-in 0.2s ease-out",
                    }}
                    onClick={() => {
                        setOpen(false);
                        setName("");
                    }}
                >
                    <div
                        role="dialog"
                        aria-labelledby="library-folder-modal-title"
                        className="w-full max-w-sm rounded-3xl p-8 text-left"
                        style={{
                            background: "var(--card-bg)",
                            boxShadow: "var(--shadow-modal)",
                            border: "1px solid var(--border-card)",
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h2
                            id="library-folder-modal-title"
                            className="mb-4 text-xl font-extrabold"
                            style={{ color: "var(--heading-on-surface)" }}
                        >
                            {t("library.folderModalTitle")}
                        </h2>
                        <label
                            className="mb-2 block text-[10px] font-extrabold uppercase tracking-widest"
                            style={{ color: "var(--text-muted)" }}
                            htmlFor="library-new-folder-name"
                        >
                            {t("library.folderNameLabel")}
                        </label>
                        <input
                            id="library-new-folder-name"
                            type="text"
                            className="mb-6 w-full rounded-xl p-3 text-sm font-medium"
                            style={{
                                border: "2px solid var(--input-border)",
                                outline: "none",
                                background: "var(--input-bg)",
                                color: "var(--text-body)",
                            }}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    create();
                                }
                            }}
                            placeholder={t("library.folderNamePlaceholder")}
                            autoFocus
                        />
                        <div className="flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => {
                                    setOpen(false);
                                    setName("");
                                }}
                                className="rounded-xl px-4 py-2 text-sm font-bold transition-colors duration-150"
                                style={{ color: "var(--text-muted)" }}
                                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--hover-bg)")}
                                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                            >
                                {t("library.modalCancel")}
                            </button>
                            <button
                                type="button"
                                onClick={create}
                                className="rounded-xl px-6 py-2 text-sm font-extrabold text-white transition-all duration-200"
                                style={{
                                    background: "linear-gradient(135deg, #408A71, #285A48)",
                                    boxShadow: "var(--shadow-btn-sm)",
                                }}
                            >
                                {t("library.folderCreateButton")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
