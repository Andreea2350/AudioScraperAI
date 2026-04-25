"use client";

/**
 * Schelet aplicatie: sidebar, header, flyout upload, meniu cont. Pe /intro si /login afiseaza doar children
 * (fara chrome). Redirectioneaza la /intro daca nu exista token pe rute private.
 */
import { useState, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { API_BASE, authHeadersMultipart, clearAuthSession } from "@/lib/api";
import { DOCUMENT_FILE_ACCEPT, IMAGE_FILE_ACCEPT } from "@/lib/fileUploadAccept";
import { LibraryNewFolderButton } from "@/components/LibraryNewFolderButton";
import { LibrarySearchByFlyout } from "@/components/LibrarySearchByFlyout";
import { LibrarySortFilterFlyout } from "@/components/LibrarySortFilterFlyout";
import { LibraryViewModeToggle } from "@/components/LibraryViewModeToggle";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function AppShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const isPublicPage =
        pathname === "/intro" ||
        pathname === "/login" ||
        (pathname?.startsWith("/intro/") ?? false);

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
    /** Evită mismatch SSR/client: usePathname() poate diferi la primul paint. */
    const [libraryHeaderReady, setLibraryHeaderReady] = useState(false);

    useEffect(() => {
        setLibraryHeaderReady(true);
    }, []);

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

    useEffect(() => {
        const publicPage =
            pathname === "/intro" ||
            pathname === "/login" ||
            (pathname?.startsWith("/intro/") ?? false);
        if (publicPage) return;
        const token = localStorage.getItem("token");
        if (!token) {
            router.replace("/intro");
        } else {
            setUserEmail(localStorage.getItem("email"));
            setUserRol(localStorage.getItem("rol"));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionat doar la mount; router.replace e idempotent
    }, [pathname]);

    useEffect(() => {
        const reseteazaMeniul = () => setActiveMenu("biblioteca");
        window.addEventListener("reseteaza-meniu", reseteazaMeniul);
        return () => window.removeEventListener("reseteaza-meniu", reseteazaMeniul);
    }, []);

    useEffect(() => {
        const peDocumentIncarcat = () => setActiveMenu("text");
        window.addEventListener("document-text-incarcat", peDocumentIncarcat);
        return () => window.removeEventListener("document-text-incarcat", peDocumentIncarcat);
    }, []);

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

    const goHomeThen = (fn: () => void) => {
        if (pathname !== "/") {
            router.push("/");
            window.setTimeout(fn, 120);
        } else {
            fn();
        }
    };

    const incarcaFisierSiDeschideEditor = async (file: File | undefined) => {
        if (!file) return;
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
                        : "Nu s-a putut citi fișierul.";
                setDocUploadError(msg);
                return;
            }
            if (data.status !== "success" || !data.text) {
                setDocUploadError("Răspuns neașteptat de la server.");
                return;
            }
            const detail = {
                titlu: data.titlu_sugerat || file.name.replace(/\.[^/.]+$/, ""),
                text: data.text as string,
            };
            goHomeThen(() =>
                window.dispatchEvent(new CustomEvent("document-text-incarcat", { detail })),
            );
            setIsUploadOpen(false);
            setDocUploadError(null);
        } catch {
            setDocUploadError("Nu s-a putut conecta la server.");
        } finally {
            setDocUploadLoading(false);
        }
    };

    const deschideModalulDeLink = () => {
        setIsUploadOpen(false);
        goHomeThen(() => window.dispatchEvent(new Event("deschide-modal-url")));
    };

    const apasaAdaugaText = () => {
        setActiveMenu("text");
        goHomeThen(() => window.dispatchEvent(new Event("deschide-modal-text")));
    };

    const apasaBiblioteca = () => {
        setActiveMenu("biblioteca");
        if (pathname !== "/") {
            router.push("/");
        } else {
            window.dispatchEvent(new Event("arata-biblioteca"));
        }
    };

    const apasaListaRedare = () => {
        setActiveMenu("lista-redare");
        setMaiMulteOpen(true);
        router.push("/lista-redare");
    };

    const apasaSetari = () => {
        setActiveMenu("setari");
        setMaiMulteOpen(true);
        router.push("/setari");
    };

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

    if (isPublicPage) {
        return <>{children}</>;
    }

    return (
        <div
            className="flex h-screen w-full overflow-hidden"
            style={{ backgroundColor: "var(--page-bg)" }}
        >
            <aside
                className="relative z-20 flex w-64 flex-col"
                style={{
                    background: "linear-gradient(180deg, #1a3d2f 0%, #285A48 60%, #2d6652 100%)",
                    boxShadow: "4px 0 24px rgba(9,20,19,0.2), inset -1px 0 0 rgba(176,228,204,0.08)",
                }}
            >
                <button
                    type="button"
                    onClick={() => {
                        setActiveMenu("biblioteca");
                        router.push("/");
                    }}
                    className="w-full cursor-pointer rounded-none border-0 p-6 pb-5 text-left transition-colors hover:bg-white/5"
                    style={{ borderBottom: "1px solid rgba(176,228,204,0.12)", background: "transparent" }}
                >
                    <div className="text-2xl font-extrabold tracking-wider text-white">
                        AudioScraper<span style={{ color: "#B0E4CC" }}>AI</span>
                    </div>
                    <div className="mt-0.5 text-[11px] font-medium" style={{ color: "rgba(176,228,204,0.5)" }}>
                        Platforma ta audio
                    </div>
                </button>

                <nav className="mt-4 flex-1 space-y-1 px-3 text-sm font-medium">
                    <button type="button" onClick={apasaAdaugaText} className={stilButonNavigare("text")}>
                        <span className="mr-3 text-base opacity-80">✎</span>
                        <span>Adaugă Text</span>
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
                            onClick={() => setIsUploadOpen(!isUploadOpen)}
                            className={`w-full flex items-center rounded-xl border-l-[3px] p-3 text-left transition-all duration-200 ${
                                isUploadOpen
                                    ? "border-light-green/50 bg-white/15 text-white"
                                    : "border-transparent text-white/80 hover:bg-white/10 hover:text-white"
                            }`}
                        >
                            <span className="mr-3 text-base opacity-80">↑</span>
                            <span>Încarcă Document</span>
                        </button>

                        {isUploadOpen && (
                            <div
                                className="absolute top-0 left-[105%] z-50 ml-2 w-80 overflow-hidden rounded-2xl"
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
                                        Adaugă Sursă
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
                                            Se extrage textul…
                                        </div>
                                    )}
                                    <button
                                        type="button"
                                        disabled={docUploadLoading}
                                        onClick={() => {
                                            setDocUploadError(null);
                                            docFileRef.current?.click();
                                        }}
                                        className="group flex w-full items-start rounded-xl p-3 text-left transition-colors disabled:opacity-50"
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
                                                Document
                                            </div>
                                            <div className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                                                PDF, DOCX sau TXT din calculator.
                                            </div>
                                        </div>
                                    </button>

                                    <button
                                        type="button"
                                        disabled={docUploadLoading}
                                        onClick={() => {
                                            setDocUploadError(null);
                                            imageFileRef.current?.click();
                                        }}
                                        className="group flex w-full items-start rounded-xl p-3 text-left transition-colors disabled:opacity-50"
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
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                            </svg>
                                        </div>
                                        <div>
                                            <div className="mb-0.5 text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                                                Imagine
                                            </div>
                                            <div className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                                                PNG, JPG — text extras cu AI (necesită Gemini).
                                            </div>
                                        </div>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={deschideModalulDeLink}
                                        className="group flex w-full items-start rounded-xl p-3 text-left transition-colors"
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
                                                Link Pagină Web
                                            </div>
                                            <div className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                                                Extrage și ascultă textul dintr-un articol de pe internet.
                                            </div>
                                        </div>
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <button type="button" onClick={apasaBiblioteca} className={stilButonNavigare("biblioteca")}>
                        <span className="mr-3 text-base">🕮</span>
                        <span>Bibliotecă</span>
                    </button>

                    <div className="my-4" style={{ borderTop: "1px solid rgba(176,228,204,0.12)" }} />

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
                            <span>Mai multe funcții {maiMulteOpen ? "▴" : "▾"}</span>
                        </button>
                            {maiMulteOpen && (
                            <div className="mt-1 ml-2 space-y-0.5 border-l-2 border-white/15 pl-3">
                                <button type="button" onClick={apasaListaRedare} className={stilButonNavigare("lista-redare")}>
                                    <span className="mr-3 text-base opacity-80">≡</span>
                                    <span>Lista de redare</span>
                                </button>
                                <button type="button" onClick={apasaSetari} className={stilButonNavigare("setari")}>
                                    <span className="mr-3 text-base opacity-80">⚙</span>
                                    <span>Setări</span>
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

            <div className="z-10 flex min-w-0 flex-1 flex-col">
                <header
                    className="flex h-16 items-center justify-end gap-4 overflow-visible px-8"
                    style={{
                        background: "var(--header-bar-bg)",
                        boxShadow: "var(--shadow-header-bar)",
                    }}
                >
                    <div className="flex items-center gap-2">
                        {libraryHeaderReady && pathname === "/" && <LibraryNewFolderButton />}
                        {libraryHeaderReady && pathname === "/" && <LibrarySearchByFlyout />}
                        {libraryHeaderReady && pathname === "/" && <LibrarySortFilterFlyout />}
                        {libraryHeaderReady && pathname === "/" && <LibraryViewModeToggle />}
                        <ThemeToggle />
                    </div>
                    <div className="relative flex items-center gap-0.5" ref={accountMenuRef}>
                        <button
                            type="button"
                            onClick={() => {
                                setAccountMenuOpen(false);
                                apasaSetari();
                            }}
                            aria-label="Deschide setările contului"
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-white transition-transform duration-150 hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-mid-green focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--header-bar-bg)]"
                            style={{
                                background: "linear-gradient(135deg, #408A71, #285A48)",
                                boxShadow: "0 2px 10px rgba(40,90,72,0.35)",
                            }}
                        >
                            {userEmail && userEmail.trim()
                                ? userEmail.slice(0, 2).toUpperCase()
                                : userRol === "guest"
                                  ? "GS"
                                  : "?"}
                        </button>
                        <button
                            type="button"
                            onClick={() => setAccountMenuOpen((o) => !o)}
                            aria-expanded={accountMenuOpen}
                            aria-haspopup="dialog"
                            aria-label="Meniul contului (deconectare)"
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
                                aria-label="Cont utilizator"
                            >
                                <div
                                    className="border-b px-4 py-3"
                                    style={{ borderColor: "var(--divider)" }}
                                >
                                    <p
                                        className="text-[10px] font-extrabold uppercase tracking-widest"
                                        style={{ color: "var(--text-muted)" }}
                                    >
                                        Cont
                                    </p>
                                    <p
                                        className="mt-1 truncate text-sm font-bold"
                                        style={{ color: "var(--text-primary)" }}
                                        title={userEmail?.trim() || undefined}
                                    >
                                        {userEmail?.trim()
                                            ? userEmail
                                            : userRol === "guest"
                                              ? "Oaspete"
                                              : "Utilizator"}
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
                                        Avatarul deschide setările. Aici te poți deconecta.
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
                                            router.push("/intro");
                                        }}
                                    >
                                        Deconectare
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </header>

                <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
            </div>
        </div>
    );
}
