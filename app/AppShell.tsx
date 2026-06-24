"use client";

/**
 * Schelet aplicatie: sidebar, header, flyout upload, meniu cont. Pe / si /login afiseaza doar children
 * (fara chrome). Redirectioneaza la / daca nu exista token pe rute private.
 */
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { API_BASE, authHeadersMultipart, clearAuthSession, isGuestSession } from "@/lib/api";
import { DOCUMENT_FILE_ACCEPT, IMAGE_FILE_ACCEPT, isImageUploadFile } from "@/lib/fileUploadAccept";
import { useI18n } from "@/lib/i18n";
import { LibraryNewFolderButton } from "@/components/LibraryNewFolderButton";
import { LibrarySearchByFlyout } from "@/components/LibrarySearchByFlyout";
import { LibrarySortFilterFlyout } from "@/components/LibrarySortFilterFlyout";
import { LibraryViewModeToggle } from "@/components/LibraryViewModeToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageToggle } from "@/components/LanguageToggle";
import { GenerationProgressBar } from "@/components/GenerationProgressBar";
import { GenerationLeaveGuard } from "@/components/GenerationLeaveGuard";
import { useGenerationJob } from "@/lib/generationJob";
import { LIBRARY_BOOK_VIEW_EVENT } from "@/lib/libraryUiStorage";
import { APP_HOME_PATH, isAppHomePath, isPublicPath, LANDING_PATH } from "@/lib/routes";

export default function AppShell({ children }: { children: React.ReactNode }) {
    const { t } = useI18n();
    const pathname = usePathname();
    const router = useRouter();

    /** Rute publice fara sidebar/header (landing, login, redirect /intro). */
    const isPublicPage = isPublicPath(pathname);

    /* --- Stare: navigare, upload, cont utilizator --- */
    const [isUploadOpen, setIsUploadOpen] = useState(false);
    const [maiMulteOpen, setMaiMulteOpen] = useState(false);
    const [activeMenu, setActiveMenu] = useState("biblioteca");
    const [userEmail, setUserEmail] = useState<string | null>(null);
    const [userRol, setUserRol] = useState<string | null>(null);
    const [docUploadLoading, setDocUploadLoading] = useState(false);
    const [docUploadError, setDocUploadError] = useState<string | null>(null);
    const docFileRef = useRef<HTMLInputElement>(null);
    const imageFileRef = useRef<HTMLInputElement>(null);
    const [accountMenuOpen, setAccountMenuOpen] = useState(false);
    const accountMenuRef = useRef<HTMLDivElement>(null);
    /** Evita mismatch SSR/client: usePathname() poate diferi la primul paint. */
    const [libraryHeaderReady, setLibraryHeaderReady] = useState(false);
    /** True cand utilizatorul vizualizeaza o carte deschisa pe pagina principala. */
    const [bookViewOpen, setBookViewOpen] = useState(false);
    /** Drawer navigare pe ecrane sub lg (<1024px). */
    const [mobileNavOpen, setMobileNavOpen] = useState(false);

    /* --- Efecte: sincronizare UI cu ruta si sesiune --- */
    const closeMobileNav = () => setMobileNavOpen(false);

    useEffect(() => {
        setLibraryHeaderReady(true);
    }, []);

    useEffect(() => {
        closeMobileNav();
        setIsUploadOpen(false);
    }, [pathname]);

    useEffect(() => {
        if (!mobileNavOpen) return;
        document.body.style.overflow = "hidden";
        const peEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape") closeMobileNav();
        };
        document.addEventListener("keydown", peEscape);
        return () => {
            document.body.style.overflow = "";
            document.removeEventListener("keydown", peEscape);
        };
    }, [mobileNavOpen]);

    useEffect(() => {
        const mq = window.matchMedia("(min-width: 1024px)");
        const onChange = () => {
            if (mq.matches) setMobileNavOpen(false);
        };
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    }, []);

    useEffect(() => {
        if (!isAppHomePath(pathname)) setBookViewOpen(false);
    }, [pathname]);

    /** Sincronizeaza meniul activ cu rutele lista-redare / setari. */
    useEffect(() => {
        if (pathname === "/lista-redare") {
            setActiveMenu("lista-redare");
            setMaiMulteOpen(true);
        }
        if (pathname === "/setari") {
            setActiveMenu("setari");
            setMaiMulteOpen(true);
        }
    }, [pathname]);

    /** Redirect la landing daca lipseste token pe rute private; incarca email si rol. */
    useEffect(() => {
        if (isPublicPath(pathname)) return;
        const token = localStorage.getItem("token");
        if (!token) {
            router.replace(LANDING_PATH);
        } else {
            setUserEmail(localStorage.getItem("email"));
            setUserRol(localStorage.getItem("rol"));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionat doar la mount; router.replace e idempotent
    }, [pathname]);

    /** Asculta eveniment global pentru reset meniu la biblioteca. */
    useEffect(() => {
        const reseteazaMeniul = () => setActiveMenu("biblioteca");
        window.addEventListener("reseteaza-meniu", reseteazaMeniul);
        return () => window.removeEventListener("reseteaza-meniu", reseteazaMeniul);
    }, []);

    /** Sincronizeaza header-ul cu vizualizarea unei carti deschise pe /. */
    useEffect(() => {
        const onBookView = (e: Event) => {
            const ce = e as CustomEvent<{ open?: boolean }>;
            setBookViewOpen(Boolean(ce.detail?.open));
        };
        window.addEventListener(LIBRARY_BOOK_VIEW_EVENT, onBookView);
        return () => window.removeEventListener(LIBRARY_BOOK_VIEW_EVENT, onBookView);
    }, []);

    const { busy: generationBusy } = useGenerationJob();
    const lockHint = t("shell.sourceLockedHint");
    const disableAddText = generationBusy;
    const disableUpload = generationBusy;
    const disableDocumentPick = generationBusy;
    const disableImagePick = generationBusy;
    const disableWebLink = generationBusy;

    /** Marcheaza meniul "text" dupa incarcare document din flyout. */
    useEffect(() => {
        const peDocumentIncarcat = () => setActiveMenu("text");
        window.addEventListener("document-text-incarcat", peDocumentIncarcat);
        return () => window.removeEventListener("document-text-incarcat", peDocumentIncarcat);
    }, []);

    /** Inchide meniul cont la click in afara sau Escape. */
    useEffect(() => {
        if (!accountMenuOpen) return;
        const inchide = (e: MouseEvent) => {
            if (accountMenuRef.current?.contains(e.target as Node)) return;
            setAccountMenuOpen(false);
        };
        const peEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape") setAccountMenuOpen(false);
        };
        document.addEventListener("mousedown", inchide);
        document.addEventListener("keydown", peEscape);
        return () => {
            document.removeEventListener("mousedown", inchide);
            document.removeEventListener("keydown", peEscape);
        };
    }, [accountMenuOpen]);

    /* --- Handlere: navigare, upload fisier, actiuni sidebar --- */
    /** Navigheaza la / apoi ruleaza callback (pentru evenimente pe Home). */
    const goHomeThen = (fn: () => void) => {
        if (!isAppHomePath(pathname)) {
            router.push(APP_HOME_PATH);
            window.setTimeout(fn, 120);
        } else {
            fn();
        }
    };

    /** POST /extrage_fisier: extrage text si deschide editorul pe pagina principala. */
    const incarcaFisierSiDeschideEditor = async (file: File | undefined) => {
        if (!file) return;
        const isImage = isImageUploadFile(file);
        if (isImage && disableImagePick) return;
        if (!isImage && disableDocumentPick) return;
        if (isGuestSession() && isImageUploadFile(file)) {
            setDocUploadError(t("shell.imageLocked"));
            return;
        }
        setDocUploadLoading(true);
        setDocUploadError(null);
        try {
            const fd = new FormData();
            fd.append("file", file);
            const res = await fetch(`${API_BASE}/extrage_fisier`, {
                method: "POST",
                headers: authHeadersMultipart(),
                body: fd,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                const msg =
                    typeof data.detail === "string"
                        ? data.detail
                        : t("shell.uploadFileError");
                setDocUploadError(msg);
                return;
            }
            if (data.status !== "success" || !data.text) {
                setDocUploadError(t("shell.uploadUnexpected"));
                return;
            }
            const detail = {
                titlu: data.titlu_sugerat || file.name.replace(/\.[^/.]+$/, ""),
                text: data.text as string,
                extract_meta: (data.extract_meta as Record<string, unknown> | undefined) ?? null,
                filename: file.name,
            };
            goHomeThen(() =>
                window.dispatchEvent(new CustomEvent("document-text-incarcat", { detail })),
            );
            setIsUploadOpen(false);
            setDocUploadError(null);
            closeMobileNav();
        } catch {
            setDocUploadError(t("shell.uploadNetworkError"));
        } finally {
            setDocUploadLoading(false);
        }
    };

    const deschideModalulDeLink = () => {
        if (disableWebLink) return;
        setIsUploadOpen(false);
        closeMobileNav();
        goHomeThen(() => window.dispatchEvent(new Event("deschide-modal-url")));
    };

    const apasaAdaugaText = () => {
        if (disableAddText) return;
        setActiveMenu("text");
        closeMobileNav();
        goHomeThen(() => window.dispatchEvent(new Event("deschide-modal-text")));
    };

    const apasaBiblioteca = () => {
        setActiveMenu("biblioteca");
        closeMobileNav();
        if (!isAppHomePath(pathname)) {
            router.push(APP_HOME_PATH);
        } else {
            window.dispatchEvent(new Event("arata-biblioteca"));
        }
    };

    const inapoiLaBiblioteca = () => {
        window.dispatchEvent(new Event("arata-biblioteca"));
        window.dispatchEvent(new Event("reseteaza-meniu"));
    };

    const apasaListaRedare = () => {
        setActiveMenu("lista-redare");
        setMaiMulteOpen(true);
        closeMobileNav();
        router.push("/lista-redare");
    };

    const apasaSetari = () => {
        setActiveMenu("setari");
        setMaiMulteOpen(true);
        closeMobileNav();
        router.push("/setari");
    };

    /** Clase CSS pentru butonul de navigare activ/inactiv din sidebar. */
    const stilButonNavigare = (numeMeniu: string) => {
        if (activeMenu === numeMeniu) {
            return (
                "w-full flex items-center p-3 rounded-xl font-bold text-left text-white transition-all duration-200"
                + " bg-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.15)]"
                + " border-l-[3px] border-light-green"
            );
        }
        return "w-full flex items-center p-3 rounded-xl hover:bg-white/10 transition-all duration-200 text-left text-white/80 hover:text-white border-l-[3px] border-transparent";
    };

    const isGuest = userRol === "guest";

    /* --- Randare: pagina publica (fara chrome) --- */
    if (isPublicPage) {
        return <>{children}</>;
    }

    /* --- Randare: layout principal cu sidebar si header --- */
    return (
        <div
            className="flex h-screen w-full overflow-hidden"
            style={{ backgroundColor: "var(--page-bg)" }}
        >
            <GenerationLeaveGuard />

            {mobileNavOpen ? (
                <button
                    type="button"
                    className="fixed inset-0 z-40 bg-black/50 lg:hidden"
                    onClick={closeMobileNav}
                    aria-label={t("shell.closeMenu")}
                />
            ) : null}

            {/* Sidebar verde: drawer pe mobil, fix pe lg+ */}
            <aside
                className={`fixed inset-y-0 left-0 z-50 flex w-[min(18rem,calc(100vw-2rem))] flex-col transition-transform duration-300 ease-out lg:static lg:z-20 lg:w-64 lg:translate-x-0 ${
                    mobileNavOpen ? "translate-x-0" : "-translate-x-full"
                }`}
                style={{
                    background: "linear-gradient(180deg, var(--sidebar-from) 0%, var(--sidebar-via) 60%, var(--sidebar-to) 100%)",
                    boxShadow: "var(--sidebar-shadow)",
                }}
            >
                <div
                    className="flex items-start justify-between gap-2 border-0 p-6 pb-5"
                    style={{ borderBottom: "1px solid var(--sidebar-divider)" }}
                >
                    <button
                        type="button"
                        onClick={apasaBiblioteca}
                        className="min-w-0 flex-1 cursor-pointer rounded-xl border-0 p-0 text-left transition-colors hover:bg-white/5"
                        style={{ background: "transparent" }}
                        aria-label={t("shell.library")}
                    >
                        <div className="text-2xl font-extrabold tracking-wider text-white">
                            AudioScraper<span style={{ color: "var(--sidebar-brand-accent)" }}>AI</span>
                        </div>
                        <div className="mt-0.5 text-[11px] font-medium" style={{ color: "var(--sidebar-section)" }}>
                            {t("shell.tagline")}
                        </div>
                    </button>
                    <button
                        type="button"
                        onClick={closeMobileNav}
                        className="lg:hidden flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                        aria-label={t("shell.closeMenu")}
                    >
                        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                        </svg>
                    </button>
                </div>

                <nav className="mt-4 flex-1 space-y-1 overflow-y-auto px-3 pb-4 text-sm font-medium">
                    <p
                        className="px-3 pb-1 pt-1 text-[10px] font-extrabold uppercase tracking-[0.14em]"
                        style={{ color: "var(--sidebar-section)" }}
                    >
                        {t("shell.sectionCreate")}
                    </p>
                    <button
                        type="button"
                        onClick={apasaAdaugaText}
                        disabled={disableAddText}
                        title={disableAddText ? lockHint : undefined}
                        className={`${stilButonNavigare("text")}${disableAddText ? " opacity-45 cursor-not-allowed" : ""}`}
                    >
                        <span className="mr-3 text-base opacity-80">✎</span>
                        <span>{t("shell.addText")}</span>
                    </button>

                    <div className="relative">
                        <input
                            ref={docFileRef}
                            type="file"
                            className="hidden"
                            suppressHydrationWarning
                            accept={DOCUMENT_FILE_ACCEPT}
                            onChange={(e) => {
                                const f = e.target.files?.[0];
                                e.target.value = "";
                                void incarcaFisierSiDeschideEditor(f);
                            }}
                        />
                        <input
                            ref={imageFileRef}
                            type="file"
                            className="hidden"
                            suppressHydrationWarning
                            accept={IMAGE_FILE_ACCEPT}
                            onChange={(e) => {
                                const f = e.target.files?.[0];
                                e.target.value = "";
                                void incarcaFisierSiDeschideEditor(f);
                            }}
                        />
                        <button
                            type="button"
                            disabled={disableUpload}
                            title={disableUpload ? lockHint : undefined}
                            onClick={() => {
                                if (disableUpload) return;
                                setIsUploadOpen(!isUploadOpen);
                            }}
                            className={`w-full flex items-center rounded-xl border-l-[3px] p-3 text-left transition-all duration-200 ${
                                isUploadOpen
                                    ? "border-light-green/50 bg-white/15 text-white"
                                    : "border-transparent text-white/80 hover:bg-white/10 hover:text-white"
                            }${disableUpload ? " opacity-45 cursor-not-allowed" : ""}`}
                        >
                            <span className="mr-3 text-base opacity-80">↑</span>
                            <span>{t("shell.uploadDocument")}</span>
                        </button>

                        {isUploadOpen && (
                            <div
                                className="absolute left-0 right-0 top-full z-50 mt-2 w-full overflow-hidden rounded-2xl lg:left-[105%] lg:right-auto lg:top-0 lg:mt-0 lg:ml-2 lg:w-80"
                                style={{
                                    animation: "fade-in 0.25s ease-out",
                                    background: "var(--card-bg)",
                                    color: "var(--text-primary)",
                                    boxShadow: "var(--shadow-dropdown)",
                                    border: "1px solid var(--border-card)",
                                }}
                            >
                                <div
                                    className="flex items-center justify-between px-5 py-3.5"
                                    style={{
                                        borderBottom: "1px solid var(--divider)",
                                        background: `linear-gradient(to bottom, var(--modal-header-from), var(--modal-header-to))`,
                                    }}
                                >
                                    <span className="text-sm font-extrabold" style={{ color: "var(--text-primary)" }}>
                                        {t("shell.addSource")}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setIsUploadOpen(false)}
                                        className="text-xl font-bold leading-none transition-colors"
                                        style={{ color: "var(--text-muted)" }}
                                    >
                                        &times;
                                    </button>
                                </div>

                                <div className="space-y-0.5 p-2">
                                    {docUploadError && (
                                        <div
                                            className="mx-2 mb-1 rounded-xl px-3 py-2 text-xs font-medium"
                                            style={{
                                                background: "rgba(194,91,111,0.1)",
                                                border: "1px solid rgba(194,91,111,0.25)",
                                                color: "#e07d8f",
                                            }}
                                        >
                                            {docUploadError}
                                        </div>
                                    )}
                                    {docUploadLoading && (
                                        <div className="mx-2 mb-1 px-3 py-2 text-xs font-bold text-mid-green">
                                            {t("shell.extractingText")}
                                        </div>
                                    )}
                                    <button
                                        type="button"
                                        disabled={docUploadLoading || disableDocumentPick}
                                        title={disableDocumentPick ? lockHint : undefined}
                                        onClick={() => {
                                            if (disableDocumentPick) return;
                                            setDocUploadError(null);
                                            docFileRef.current?.click();
                                        }}
                                        className={`group flex w-full items-start rounded-xl p-3 text-left transition-colors disabled:opacity-50${
                                            disableDocumentPick ? " opacity-45 cursor-not-allowed" : ""
                                        }`}
                                        style={{ color: "var(--text-body)" }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.backgroundColor = "var(--hover-bg)";
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.backgroundColor = "transparent";
                                        }}
                                    >
                                        <div className="mt-1 mr-4 text-[var(--text-faint)] transition-colors group-hover:text-mid-green">
                                            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                                            </svg>
                                        </div>
                                        <div>
                                            <div className="mb-0.5 text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                                                {t("shell.document")}
                                            </div>
                                            <div className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                                                {t("shell.documentDesc")}
                                            </div>
                                        </div>
                                    </button>

                                    <button
                                        type="button"
                                        disabled={docUploadLoading || disableImagePick}
                                        title={disableImagePick ? lockHint : undefined}
                                        onClick={() => {
                                            if (disableImagePick) return;
                                            if (isGuest) {
                                                setDocUploadError(t("shell.imageLocked"));
                                                return;
                                            }
                                            setDocUploadError(null);
                                            imageFileRef.current?.click();
                                        }}
                                        className={`group flex w-full items-center rounded-xl p-3 text-left transition-colors disabled:opacity-50 ${
                                            isGuest || disableImagePick ? "cursor-not-allowed opacity-75" : ""
                                        }`}
                                        style={{ color: "var(--text-body)" }}
                                        onMouseEnter={(e) => {
                                            if (isGuest) return;
                                            e.currentTarget.style.backgroundColor = "var(--hover-bg)";
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.backgroundColor = "transparent";
                                        }}
                                    >
                                        <div className="mr-4 shrink-0 text-[var(--text-faint)] transition-colors group-hover:text-mid-green">
                                            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                            </svg>
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="mb-0.5 flex items-center gap-1.5 text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                                                <span>{t("shell.image")}</span>
                                                {isGuest ? (
                                                    <span
                                                        className="text-[10px] font-extrabold uppercase tracking-wide rounded-full px-2 py-0.5"
                                                        style={{
                                                            background: "rgba(196,147,63,0.12)",
                                                            color: "#C4933F",
                                                        }}
                                                    >
                                                        {t("shell.imageBadgeAccount")}
                                                    </span>
                                                ) : null}
                                            </div>
                                            <div className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                                                {isGuest ? t("shell.imageDescLocked") : t("shell.imageDesc")}
                                            </div>
                                        </div>
                                        {isGuest ? (
                                            <span
                                                className="ml-3 shrink-0 text-base leading-none opacity-60"
                                                style={{ color: "var(--text-muted)" }}
                                                aria-hidden
                                            >
                                                🔒
                                            </span>
                                        ) : null}
                                    </button>

                                    <button
                                        type="button"
                                        disabled={disableWebLink}
                                        title={disableWebLink ? lockHint : undefined}
                                        onClick={deschideModalulDeLink}
                                        className={`group flex w-full items-start rounded-xl p-3 text-left transition-colors${
                                            disableWebLink ? " opacity-45 cursor-not-allowed" : ""
                                        }`}
                                        style={{ color: "var(--text-body)" }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.backgroundColor = "var(--hover-bg)";
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.backgroundColor = "transparent";
                                        }}
                                    >
                                        <div className="mt-1 mr-4 text-[var(--text-faint)] transition-colors group-hover:text-mid-green">
                                            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                            </svg>
                                        </div>
                                        <div>
                                            <div className="mb-0.5 text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                                                {t("shell.webLink")}
                                            </div>
                                            <div className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                                                {t("shell.webLinkDesc")}
                                            </div>
                                        </div>
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <button type="button" onClick={apasaBiblioteca} className={stilButonNavigare("biblioteca")}>
                        <span className="mr-3 text-base">🕮</span>
                        <span>{t("shell.library")}</span>
                    </button>

                    <div className="my-4" style={{ borderTop: "1px solid var(--sidebar-divider)" }} />

                    <div>
                        <button
                            type="button"
                            onClick={() => setMaiMulteOpen(!maiMulteOpen)}
                            className={`w-full flex items-center rounded-xl border-l-[3px] p-3 text-left text-sm transition-all duration-200 ${
                                maiMulteOpen
                                    ? "border-light-green/50 bg-white/15 text-white"
                                    : "border-transparent text-white/60 hover:bg-white/10 hover:text-white/80"
                            }`}
                        >
                            <span className="mr-3 text-base">⚙</span>
                            <span>{t("shell.moreFeatures")} {maiMulteOpen ? "▴" : "▾"}</span>
                        </button>
                            {maiMulteOpen && (
                            <div className="mt-1 ml-2 space-y-0.5 border-l-2 border-white/15 pl-3">
                                <button type="button" onClick={apasaListaRedare} className={stilButonNavigare("lista-redare")}>
                                    <span className="mr-3 text-base opacity-80">≡</span>
                                    <span className="min-w-0 flex-1 text-left">{t("shell.playlist")}</span>
                                    {isGuest ? (
                                        <span className="ml-1 text-sm leading-none opacity-70" title={t("shell.playlistGuestLockedTitle")} aria-hidden>
                                            🔒
                                        </span>
                                    ) : null}
                                </button>
                                <button type="button" onClick={apasaSetari} className={stilButonNavigare("setari")}>
                                    <span className="mr-3 text-base opacity-80">⚙</span>
                                    <span>{t("shell.settings")}</span>
                                </button>
                            </div>
                            )}
                    </div>
                </nav>

                <div
                    className="pointer-events-none h-12"
                    style={{ background: "linear-gradient(to top, rgba(9,20,19,0.3), transparent)" }}
                />
            </aside>

            {/* Zona principala: header biblioteca + continut pagina */}
            <div className="z-10 flex min-w-0 flex-1 flex-col">
                <header
                    className="flex h-14 min-h-14 items-center gap-2 overflow-visible px-3 sm:gap-3 sm:px-5 lg:h-16 lg:gap-4 lg:px-8"
                    style={{
                        background: "var(--header-bar-bg)",
                        boxShadow: "var(--shadow-header-bar)",
                    }}
                >
                    <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                        <button
                            type="button"
                            onClick={() => setMobileNavOpen(true)}
                            className="lg:hidden inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors"
                            style={{
                                borderColor: "var(--theme-toggle-border)",
                                background: "var(--theme-toggle-bg)",
                                color: "var(--theme-toggle-fg)",
                            }}
                            aria-label={t("shell.openMenu")}
                            aria-expanded={mobileNavOpen}
                        >
                            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                                <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
                            </svg>
                        </button>
                        {libraryHeaderReady && ((isAppHomePath(pathname) && bookViewOpen) || pathname === "/setari") ? (
                            <button
                                type="button"
                                onClick={() => {
                                    if (pathname === "/setari") {
                                        setActiveMenu("biblioteca");
                                        router.push(APP_HOME_PATH);
                                    } else {
                                        inapoiLaBiblioteca();
                                    }
                                }}
                                aria-label={t("home.back")}
                                title={t("home.back")}
                                className="group inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-all duration-200"
                                style={{
                                    borderColor: "var(--theme-toggle-border)",
                                    background: "var(--theme-toggle-bg)",
                                    color: "var(--theme-toggle-fg)",
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-bg)")}
                                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--theme-toggle-bg)")}
                            >
                                <svg
                                    className="h-6 w-6 transition-transform duration-200 group-hover:-translate-x-0.5"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="3"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden
                                >
                                    <path d="M19 12H5M12 19l-7-7 7-7" />
                                </svg>
                            </button>
                        ) : null}
                        {pathname !== LANDING_PATH &&
                        pathname !== "/setari" &&
                        pathname !== "/login" &&
                        pathname !== "/intro" &&
                        !(pathname?.startsWith("/intro/") ?? false) ? (
                            <GenerationProgressBar inline />
                        ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1 sm:gap-2">
                        <div className="hidden md:contents">
                            {libraryHeaderReady && isAppHomePath(pathname) && <LibraryNewFolderButton />}
                            {libraryHeaderReady && isAppHomePath(pathname) && <LibrarySearchByFlyout />}
                            {libraryHeaderReady && isAppHomePath(pathname) && <LibrarySortFilterFlyout />}
                        </div>
                        {libraryHeaderReady && isAppHomePath(pathname) && <LibraryViewModeToggle />}
                        <LanguageToggle />
                        <ThemeToggle />
                    </div>
                    {/* Meniu cont: guest (login/register) sau utilizator autentificat */}
                    <div className="relative flex items-center gap-0.5 shrink-0" ref={accountMenuRef}>
                        {userRol === "guest" ? (
                            <div className="flex items-center gap-1 sm:gap-2">
                                <Link
                                    href="/login"
                                    className="hidden sm:inline-flex px-3 py-2 rounded-xl text-sm font-bold transition-colors lg:px-4"
                                    style={{ color: "var(--text-muted)" }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.color = "var(--text-primary)";
                                        e.currentTarget.style.backgroundColor = "var(--hover-bg)";
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.color = "var(--text-muted)";
                                        e.currentTarget.style.backgroundColor = "transparent";
                                    }}
                                >
                                    {t("intro.auth")}
                                </Link>
                                <Link
                                    href="/login?inregistrare=1"
                                    className="px-3 py-2 rounded-xl text-xs font-extrabold text-white transition-transform hover:scale-[1.02] sm:px-4 sm:text-sm"
                                    style={{
                                        background: "linear-gradient(135deg, #408A71, #285A48)",
                                        boxShadow: "var(--shadow-btn-sm)",
                                    }}
                                >
                                    {t("intro.register")}
                                </Link>
                            </div>
                        ) : (
                        <>
                        <button
                            type="button"
                            onClick={() => {
                                setAccountMenuOpen(false);
                                apasaSetari();
                            }}
                            aria-label={t("shell.openSettingsAria")}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-white transition-transform duration-150 hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-mid-green focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--header-bar-bg)]"
                            style={{
                                background: "linear-gradient(135deg, #408A71, #285A48)",
                                boxShadow: "0 2px 10px rgba(40,90,72,0.35)",
                            }}
                        >
                            {userEmail && userEmail.trim()
                                ? userEmail.slice(0, 2).toUpperCase()
                                : "?"}
                        </button>
                        <button
                            type="button"
                            onClick={() => setAccountMenuOpen((o) => !o)}
                            aria-expanded={accountMenuOpen}
                            aria-haspopup="dialog"
                            aria-label={t("shell.accountMenuAria")}
                            className="flex h-9 w-7 shrink-0 items-center justify-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-mid-green focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--header-bar-bg)]"
                            style={{ color: "var(--text-muted)" }}
                        >
                            <svg
                                width="18"
                                height="18"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden
                            >
                                <path d="m6 9 6 6 6-6" />
                            </svg>
                        </button>

                        {accountMenuOpen && (
                            <div
                                className="absolute right-0 top-full z-[60] mt-2 w-[min(100vw-2rem,18rem)] overflow-hidden rounded-2xl py-1"
                                style={{
                                    background: "var(--card-bg)",
                                    border: "1px solid var(--border-card)",
                                    boxShadow: "var(--shadow-dropdown)",
                                    animation: "fade-in 0.2s ease-out",
                                }}
                                role="dialog"
                                aria-label={t("shell.account")}
                            >
                                <div
                                    className="border-b px-4 py-3"
                                    style={{ borderColor: "var(--divider)" }}
                                >
                                    <p
                                        className="text-[10px] font-extrabold uppercase tracking-widest"
                                        style={{ color: "var(--text-muted)" }}
                                    >
                                        {t("shell.account")}
                                    </p>
                                    <p
                                        className="mt-1 truncate text-sm font-bold"
                                        style={{ color: "var(--text-primary)" }}
                                        title={userEmail?.trim() || undefined}
                                    >
                                        {userEmail?.trim()
                                            ? userEmail
                                            : userRol === "guest"
                                              ? t("shell.guest")
                                              : t("shell.user")}
                                    </p>
                                    {userRol ? (
                                        <span
                                            className="mt-2 inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-extrabold tracking-widest uppercase"
                                            style={{
                                                background:
                                                    userRol === "admin"
                                                        ? "rgba(196,147,63,0.14)"
                                                        : userRol === "guest"
                                                          ? "rgba(58,143,181,0.14)"
                                                          : "rgba(64,138,113,0.14)",
                                                color:
                                                    userRol === "admin"
                                                        ? "#C4933F"
                                                        : userRol === "guest"
                                                          ? "#3A8FB5"
                                                          : "#408A71",
                                            }}
                                        >
                                            {userRol}
                                        </span>
                                    ) : null}
                                </div>
                                <div className="p-1">
                                    <p
                                        className="px-3 py-1.5 text-[11px] font-medium leading-snug"
                                        style={{ color: "var(--text-muted)" }}
                                    >
                                        {t("shell.accountMenuHint")}
                                    </p>
                                    <button
                                        type="button"
                                        className="w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-colors duration-150"
                                        style={{ color: "var(--text-muted)" }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.backgroundColor = "var(--hover-bg)";
                                            e.currentTarget.style.color = "var(--text-primary)";
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.backgroundColor = "transparent";
                                            e.currentTarget.style.color = "var(--text-muted)";
                                        }}
                                        onClick={() => {
                                            setAccountMenuOpen(false);
                                            clearAuthSession();
                                            router.push(LANDING_PATH);
                                        }}
                                    >
                                        {t("shell.logout")}
                                    </button>
                                </div>
                            </div>
                        )}
                        </>
                        )}
                    </div>
                </header>

                <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
            </div>
        </div>
    );
}
