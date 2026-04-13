"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, authHeadersJson, clearAuthSession, mesajEroareFastAPI } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
    getBookFolderId,
    LIBRARY_FILTERS_CHANGE_EVENT,
    LIBRARY_FOLDERS_CHANGED_EVENT,
    loadLibraryUi,
    removeBookAssignmentsForFolder,
    saveLibraryUi,
    setBookFolderId as mapSetBookFolder,
    type LibraryFiltersDetail,
    type LibraryFolder,
    type LibrarySortDir,
    type LibrarySortKey,
    type LibraryViewMode,
} from "@/lib/libraryUiStorage";

/**
 * Ecranul principal dupa login: lista de carti (GET /istoric), redare audio, editor pentru text manual,
 * modal pentru URL. AppShell trimite evenimente globale (deschide modal, incarca document) pe care ii ascultam aici.
 * Ce butoane vezi (ex. public in catalog) depinde de rolul din localStorage.
 */
export default function Home() {
    const { t } = useI18n();
    const router = useRouter();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [url, setUrl] = useState("");
    const [forceRegenerate, setForceRegenerate] = useState(false);

    const [showTextEditor, setShowTextEditor] = useState(false);
    const [titluText, setTitluText] = useState("");
    const [textManual, setTextManual] = useState("");

    const [isLoading, setIsLoading] = useState(false);
    const [istoricCarti, setIstoricCarti] = useState<any[]>([]);
    const [carteaCurenta, setCarteaCurenta] = useState<any>(null);

    const [meniuDeschisId, setMeniuDeschisId] = useState<number | null>(null);
    const [modalRedenumire, setModalRedenumire] = useState(false);
    const [carteDeRedenumit, setCarteDeRedenumit] = useState<any>(null);
    const [titluNou, setTitluNou] = useState("");

    const [toastMessage, setToastMessage] = useState<string | null>(null);

    const [modalStergere, setModalStergere] = useState(false);
    const [carteDeSters, setCarteDeSters] = useState<number | null>(null);

    const [userRol, setUserRol] = useState<string | null>(null);

    const [folders, setFolders] = useState<LibraryFolder[]>([]);
    const [bookFolderId, setBookFolderId] = useState<Record<string, string | null>>({});
    const [viewMode, setViewMode] = useState<LibraryViewMode>("grid");
    const [sortKey, setSortKey] = useState<LibrarySortKey>("data");
    const [sortDir, setSortDir] = useState<LibrarySortDir>("desc");
    const [nameFilter, setNameFilter] = useState("");
    const [mutaCarteTarget, setMutaCarteTarget] = useState<any>(null);

    useEffect(() => {
        setUserRol(typeof window !== "undefined" ? localStorage.getItem("rol") : null);
    }, []);

    useEffect(() => {
        const s = loadLibraryUi();
        setFolders(s.folders);
        setBookFolderId(s.bookFolderId);
        setViewMode(s.viewMode);
        setSortKey(s.sortKey);
        setSortDir(s.sortDir);
        setNameFilter(s.nameFilter ?? "");
    }, []);

    useEffect(() => {
        saveLibraryUi({ folders, bookFolderId, viewMode, sortKey, sortDir, nameFilter });
    }, [folders, bookFolderId, viewMode, sortKey, sortDir, nameFilter]);

    useEffect(() => {
        const onFilters = (e: Event) => {
            const ce = e as CustomEvent<LibraryFiltersDetail>;
            const d = ce.detail;
            if (!d) return;
            setNameFilter(d.nameFilter);
            setSortKey(d.sortKey);
            setSortDir(d.sortDir);
        };
        window.addEventListener(LIBRARY_FILTERS_CHANGE_EVENT, onFilters);
        return () => window.removeEventListener(LIBRARY_FILTERS_CHANGE_EVENT, onFilters);
    }, []);

    useEffect(() => {
        const onFolders = () => {
            setFolders(loadLibraryUi().folders);
        };
        window.addEventListener(LIBRARY_FOLDERS_CHANGED_EVENT, onFolders);
        return () => window.removeEventListener(LIBRARY_FOLDERS_CHANGED_EVENT, onFolders);
    }, []);

    useEffect(() => {
        const onViewMode = (e: Event) => {
            const ce = e as CustomEvent<{ mode: LibraryViewMode }>;
            if (ce.detail?.mode === "grid" || ce.detail?.mode === "list") {
                setViewMode(ce.detail.mode);
            }
        };
        window.addEventListener("audiobooks-library-view-mode", onViewMode);
        return () => window.removeEventListener("audiobooks-library-view-mode", onViewMode);
    }, []);

    useEffect(() => {
        const deschideFereastraUrl = () => setIsModalOpen(true);
        const deschideEcranText = () => { setCarteaCurenta(null); setShowTextEditor(true); };
        const arataBiblioteca = () => { setCarteaCurenta(null); setShowTextEditor(false); };

        window.addEventListener("deschide-modal-url", deschideFereastraUrl);
        window.addEventListener("deschide-modal-text", deschideEcranText);
        window.addEventListener("arata-biblioteca", arataBiblioteca);

        return () => {
            window.removeEventListener("deschide-modal-url", deschideFereastraUrl);
            window.removeEventListener("deschide-modal-text", deschideEcranText);
            window.removeEventListener("arata-biblioteca", arataBiblioteca);
        };
    }, []);

    useEffect(() => {
        const onDocumentText = (e: Event) => {
            const ce = e as CustomEvent<{ titlu: string; text: string }>;
            if (!ce.detail?.text) return;
            setTitluText(ce.detail.titlu || "Document");
            setTextManual(ce.detail.text);
            setCarteaCurenta(null);
            setShowTextEditor(true);
            setIsModalOpen(false);
        };
        window.addEventListener("document-text-incarcat", onDocumentText);
        return () => window.removeEventListener("document-text-incarcat", onDocumentText);
    }, []);

    useEffect(() => {
        // Reincarca lista din backend: serverul filtreaza dupa JWT (admin vede tot, restul doar propriul created_by_email).
        const fetchIstoric = async () => {
            try {
                const response = await fetch(`${API_BASE}/istoric`, { headers: authHeadersJson() });
                if (response.status === 401) {
                    clearAuthSession();
                    router.replace("/login");
                    return;
                }
                const json = await response.json();
                if (json.status === "success" && json.data) {
                    const cartiFormatate = json.data.map((item: any) => {
                        const ts = item.creat_la ? new Date(item.creat_la).getTime() : 0;
                        const txt = item.text_curatat ?? "";
                        return {
                            id: item.id,
                            titlu: item.titlu || "Articol Fără Titlu",
                            url_sursa: item.url,
                            status: "Complet",
                            link_audio: item.audio_link,
                            text_extras: item.text_curatat,
                            data_generare: new Date(item.creat_la).toLocaleDateString("ro-RO"),
                            is_public: Boolean(item.is_public),
                            creat_la_ts: Number.isFinite(ts) ? ts : 0,
                            lungime_text: typeof txt === "string" ? txt.length : 0,
                        };
                    });
                    setIstoricCarti(cartiFormatate);
                }
            } catch (error) {
                console.error("Eroare la încărcarea istoricului:", error);
            }
        };
        fetchIstoric();
        const reincarca = () => {
            void fetchIstoric();
        };
        window.addEventListener("reincarca-istoric", reincarca);
        return () => window.removeEventListener("reincarca-istoric", reincarca);
    }, [router]);

    /** POST /extrage: HTML -> Gemini -> TTS -> Supabase; header Authorization leaga cartea de utilizatorul logat. */
    const handleGenereaza = async () => {
        if (!url) { alert("Te rog introdu un link valid!"); return; }
        setIsLoading(true);
        try {
            const response = await fetch(`${API_BASE}/extrage`, {
                method: "POST",
                headers: authHeadersJson(),
                body: JSON.stringify({ url, force_regenerate: forceRegenerate }),
            });
            const data = await response.json().catch(() => ({} as Record<string, unknown>));
            if (!response.ok) {
                alert(
                    mesajEroareFastAPI(
                        data,
                        `Eroare la extragere (HTTP ${response.status}).`,
                    ),
                );
                return;
            }
            if (data.status === "Eroare") {
                alert(
                    typeof data.detalii === "string"
                        ? data.detalii
                        : "Eroare la procesarea URL-ului.",
                );
                return;
            }
            const tf = typeof data.text_final_audio === "string" ? data.text_final_audio : "";
            const now = Date.now();
            const carteNoua = {
                id: data.id ?? Date.now(),
                titlu: data.titlu || "Articol Web",
                url_sursa: url,
                status: data.status,
                link_audio: data.link_ascultare || data.link_audio,
                text_extras: data.text_final_audio,
                data_generare: new Date().toLocaleDateString("ro-RO"),
                is_public: Boolean(data.is_public),
                creat_la_ts: now,
                lungime_text: tf.length,
            };
            setIstoricCarti((cartiVechi) => [carteNoua, ...cartiVechi]);
            setCarteaCurenta(carteNoua);
            setShowTextEditor(false);
            window.dispatchEvent(new Event("reseteaza-meniu"));
        } catch (error) {
            alert("A apărut o eroare la conectarea cu serverul.");
        } finally {
            setIsLoading(false); setIsModalOpen(false); setUrl("");
        }
    };

    /** POST /genereaza_text: acelasi flux TTS ca la URL, dar sursa e textul din formular. */
    const handleGenereazaDinText = async () => {
        if (!titluText || !textManual) { alert("Te rog introdu un titlu și un text!"); return; }
        setIsLoading(true);
        try {
            // Cartile lungi pot depasi timeout-ul implicit al fetch; unde exista AbortSignal.timeout folosim 45 minute.
            const longWait =
                typeof AbortSignal !== "undefined" &&
                typeof (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout ===
                    "function"
                    ? (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout(
                          45 * 60 * 1000,
                      )
                    : undefined;
            const response = await fetch(`${API_BASE}/genereaza_text`, {
                method: "POST",
                headers: authHeadersJson(),
                body: JSON.stringify({ titlu: titluText, text: textManual }),
                signal: longWait,
            });
            const data = await response.json().catch(() => ({} as Record<string, unknown>));
            if (!response.ok) {
                alert(
                    mesajEroareFastAPI(
                        data,
                        `Eroare la generare (HTTP ${response.status}).`,
                    ),
                );
                return;
            }
            if (data.status === "error") {
                alert(typeof data.message === "string" ? data.message : "Eroare la generare.");
                return;
            }
            const tf2 = typeof data.text_final_audio === "string" ? data.text_final_audio : "";
            const now2 = Date.now();
            const carteNoua = {
                id: data.id ?? Date.now(),
                titlu: titluText,
                url_sursa: "Text Adăugat Manual",
                status: data.status,
                link_audio: data.link_audio,
                text_extras: data.text_final_audio,
                data_generare: new Date().toLocaleDateString("ro-RO"),
                is_public: Boolean(data.is_public),
                creat_la_ts: now2,
                lungime_text: tf2.length,
            };
            setIstoricCarti((cartiVechi) => [carteNoua, ...cartiVechi]);
            setCarteaCurenta(carteNoua);
            setShowTextEditor(false);
            window.dispatchEvent(new Event("reseteaza-meniu"));
        } catch (error) {
            alert("Eroare la generarea textului.");
        } finally {
            setIsLoading(false); setTitluText(""); setTextManual("");
        }
    };

    /** Meniu contextual pe card (redenumire, descarcare, stergere): un singur deschis o data. */
    const toggleMeniu = (e: React.MouseEvent, id: number) => {
        e.stopPropagation();
        setMeniuDeschisId(meniuDeschisId === id ? null : id);
    };

    /** PATCH /carti/:id/public: comuta is_public; backend refuza oaspetii si cartile altora (in afara de admin). */
    const togglePublicCarte = async (e: React.MouseEvent | React.ChangeEvent, carte: any) => {
        e.stopPropagation();
        try {
            const res = await fetch(`${API_BASE}/carti/${carte.id}/public`, {
                method: "PATCH",
                headers: authHeadersJson(),
                body: JSON.stringify({ is_public: !carte.is_public }),
            });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) {
                alert(typeof j.detail === "string" ? j.detail : "Nu s-a putut actualiza vizibilitatea.");
                return;
            }
            setIstoricCarti((prev) =>
                prev.map((c) => (c.id === carte.id ? { ...c, is_public: !carte.is_public } : c)),
            );
            if (carteaCurenta?.id === carte.id) {
                setCarteaCurenta({ ...carteaCurenta, is_public: !carte.is_public });
            }
        } catch {
            alert("Eroare de rețea.");
        }
    };

    const handleShare = (e: React.MouseEvent, link: string) => {
        e.stopPropagation();
        navigator.clipboard.writeText(link);
        setMeniuDeschisId(null);
        setToastMessage("Link-ul audio a fost copiat!");
        setTimeout(() => setToastMessage(null), 3000);
    };

    const handleDownload = async (e: React.MouseEvent, link: string, titlu: string) => {
        e.stopPropagation();
        setMeniuDeschisId(null);
        try {
            const response = await fetch(link);
            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = downloadUrl;
            a.download = `${titlu}.mp3`;
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch {
            window.open(link, "_blank");
        }
    };

    const deschideRedenumire = (e: React.MouseEvent, carte: any) => {
        e.stopPropagation();
        setCarteDeRedenumit(carte);
        setTitluNou(carte.titlu);
        setModalRedenumire(true);
        setMeniuDeschisId(null);
    };

    const salveazaRedenumire = async () => {
        if (!titluNou.trim()) return;
        try {
            await fetch(`${API_BASE}/redenumeste/${carteDeRedenumit.id}`, {
                method: "PUT",
                headers: authHeadersJson(),
                body: JSON.stringify({ titlu_nou: titluNou }),
            });
            setIstoricCarti(istoricCarti.map((c) => c.id === carteDeRedenumit.id ? { ...c, titlu: titluNou } : c));
            setModalRedenumire(false);
        } catch {
            alert("Eroare la redenumire.");
        }
    };

    const handleSterge = (e: React.MouseEvent, id: number) => {
        e.stopPropagation();
        setMeniuDeschisId(null);
        setCarteDeSters(id);
        setModalStergere(true);
    };

    const confirmaStergerea = async () => {
        if (carteDeSters === null) return;
        try {
            await fetch(`${API_BASE}/sterge/${carteDeSters}`, {
                method: "DELETE",
                headers: authHeadersJson(),
            });
            setIstoricCarti(istoricCarti.filter((c) => c.id !== carteDeSters));
            setBookFolderId((prev) => {
                const n = { ...prev };
                delete n[String(carteDeSters)];
                return n;
            });
            setModalStergere(false);
            setCarteDeSters(null);
        } catch {
            alert("Eroare la ștergere.");
        }
    };

    useEffect(() => {
        const handleClickOutside = () => setMeniuDeschisId(null);
        window.addEventListener("click", handleClickOutside);
        return () => window.removeEventListener("click", handleClickOutside);
    }, []);

    const cartiFiltrate = useMemo(() => {
        let list = [...istoricCarti];
        const q = nameFilter.trim().toLowerCase();
        if (q) list = list.filter((c) => (c.titlu || "").toLowerCase().includes(q));
        const dir = sortDir === "asc" ? 1 : -1;
        list.sort((a, b) => {
            if (sortKey === "nume") {
                return dir * (a.titlu || "").localeCompare(b.titlu || "", "ro", { sensitivity: "base" });
            }
            if (sortKey === "dimensiune") {
                return dir * ((a.lungime_text || 0) - (b.lungime_text || 0));
            }
            return dir * ((a.creat_la_ts || 0) - (b.creat_la_ts || 0));
        });
        return list;
    }, [istoricCarti, nameFilter, sortKey, sortDir]);

    type CarteRow = (typeof istoricCarti)[number];

    const librarySections = useMemo(() => {
        const unfiledLabel = t("library.sectionUnfiled");
        const resolveFolder = (c: CarteRow): string | null => {
            const fid = getBookFolderId(bookFolderId, c.id);
            if (!fid) return null;
            if (!folders.some((f) => f.id === fid)) return null;
            return fid;
        };
        const byFolderId = new Map<string, CarteRow[]>();
        const unfiled: CarteRow[] = [];
        for (const c of cartiFiltrate) {
            const fid = resolveFolder(c);
            if (fid === null) unfiled.push(c);
            else {
                const arr = byFolderId.get(fid) ?? [];
                arr.push(c);
                byFolderId.set(fid, arr);
            }
        }
        const sections: {
            key: string;
            title: string;
            isUserFolder: boolean;
            folderId: string | null;
            books: CarteRow[];
        }[] = [];
        for (const f of folders) {
            sections.push({
                key: f.id,
                title: f.name,
                isUserFolder: true,
                folderId: f.id,
                books: byFolderId.get(f.id) ?? [],
            });
        }
        if (unfiled.length > 0) {
            sections.push({
                key: "unfiled",
                title: unfiledLabel,
                isUserFolder: false,
                folderId: null,
                books: unfiled,
            });
        }
        return sections;
    }, [cartiFiltrate, folders, bookFolderId, t]);

    const stergeDosar = (e: React.MouseEvent, folderId: string) => {
        e.stopPropagation();
        setFolders((prev) => prev.filter((f) => f.id !== folderId));
        setBookFolderId((prev) => removeBookAssignmentsForFolder(prev, folderId));
    };

    const mutaCarteInDosar = (carteId: number, folderId: string | null) => {
        setBookFolderId((prev) => mapSetBookFolder(prev, carteId, folderId));
        setMutaCarteTarget(null);
        setMeniuDeschisId(null);
    };

    return (
        <div className="flex flex-col h-full relative p-4 lg:p-8">

            {carteaCurenta ? (
                /* ── Audio Player Screen ── */
                <div
                    className="w-full max-w-4xl mx-auto p-10 rounded-3xl mt-4"
                    style={{
                        animation: "fade-in 0.3s ease-out",
                        background: "var(--card-bg)",
                        boxShadow: "var(--shadow-card-lg)",
                        border: "1px solid var(--border-card)",
                    }}
                >
                    <button
                        onClick={() => { setCarteaCurenta(null); window.dispatchEvent(new Event("reseteaza-meniu")); }}
                        className="font-bold flex items-center mb-6 text-xs uppercase tracking-widest transition-all duration-200 group"
                        style={{ color: "var(--text-muted)" }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--heading-on-surface)")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
                    >
                        <span className="mr-2 text-base transition-transform duration-200 group-hover:-translate-x-1">←</span>
                        Înapoi la Bibliotecă
                    </button>

                    <div className="mb-8" style={{ borderBottom: "1px solid var(--divider)", paddingBottom: "1.5rem" }}>
                        <h2
                            className="text-3xl font-extrabold mb-2 leading-tight"
                            style={{ color: "var(--heading-on-surface)" }}
                        >
                            {carteaCurenta.titlu}
                        </h2>
                        {carteaCurenta.url_sursa === "Text Adăugat Manual" ? (
                            <span className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>Sursă: Text Adăugat Manual</span>
                        ) : (
                            <a
                                href={carteaCurenta.url_sursa}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm font-semibold inline-flex items-center transition-colors duration-150"
                                style={{ color: "var(--link-accent)" }}
                                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--heading-on-surface)")}
                                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--link-accent)")}
                            >
                                Deschide sursa originală <span className="ml-1 text-xs">↗</span>
                            </a>
                        )}
                    </div>

                    <div
                        className="p-8 rounded-2xl mb-8 flex items-center justify-center"
                        style={{
                            background: "linear-gradient(135deg, var(--player-well-a) 0%, var(--player-well-b) 100%)",
                            boxShadow: "var(--shadow-player-inset)",
                            border: "1px solid var(--border-card)",
                        }}
                    >
                        <audio controls className="w-full max-w-2xl" autoPlay>
                            <source src={carteaCurenta.link_audio} type="audio/mpeg" />
                            Browser-ul tău nu suportă elementul audio.
                        </audio>
                    </div>

                    <div>
                        <h3
                            className="font-extrabold text-xs uppercase tracking-widest mb-4"
                            style={{ color: "var(--text-muted)" }}
                        >
                            Text Extras
                        </h3>
                        <div
                            className="p-6 rounded-2xl h-96 overflow-y-auto"
                            style={{
                                background: "var(--text-block-bg)",
                                border: "1px solid var(--divider)",
                            }}
                        >
                            <p className="leading-relaxed text-sm whitespace-pre-wrap" style={{ color: "var(--text-body)" }}>
                                {carteaCurenta.text_extras}
                            </p>
                        </div>
                    </div>
                </div>

            ) : showTextEditor ? (

                /* ── Text Editor Screen ── */
                <div
                    className="w-full max-w-4xl mx-auto flex flex-col mt-4"
                    style={{ height: "85vh", animation: "fade-in 0.3s ease-out" }}
                >
                    <div
                        className="p-10 rounded-3xl flex flex-col flex-1"
                        style={{
                            background: "var(--card-bg)",
                            boxShadow: "var(--shadow-card-lg)",
                            border: "1px solid var(--border-card)",
                        }}
                    >
                        <div className="flex justify-center mb-8">
                            <input
                                type="text"
                                placeholder="Titlul materialului"
                                className="w-3/4 max-w-md p-2 text-xl font-extrabold bg-transparent text-center placeholder-[var(--text-faint)] transition-colors duration-200"
                                style={{
                                    borderBottom: "2px solid var(--input-border)",
                                    outline: "none",
                                    color: "var(--text-primary)",
                                }}
                                onFocus={(e) => (e.target.style.borderBottomColor = "#408A71")}
                                onBlur={(e) => (e.target.style.borderBottomColor = "var(--input-border)")}
                                value={titluText}
                                onChange={(e) => setTitluText(e.target.value)}
                            />
                        </div>

                        <textarea
                            placeholder="Tastează, lipește sau editează textul aici..."
                            className="w-full flex-1 border-0 p-4 resize-none leading-relaxed text-lg bg-transparent"
                            style={{ color: "var(--text-body)", outline: "none" }}
                            value={textManual}
                            onChange={(e) => setTextManual(e.target.value)}
                        />

                        <div
                            className="mt-6 pt-6 flex justify-center"
                            style={{ borderTop: "1px solid var(--divider)" }}
                        >
                            <button
                                onClick={handleGenereazaDinText}
                                disabled={isLoading}
                                className="px-10 py-4 text-white font-extrabold text-base rounded-full flex items-center disabled:opacity-50 transition-all duration-200"
                                style={{
                                    background: "linear-gradient(135deg, #408A71, #285A48)",
                                    boxShadow: "var(--shadow-btn-primary)",
                                }}
                                onMouseEnter={(e) => {
                                    if (!isLoading) {
                                        e.currentTarget.style.transform = "scale(1.04)";
                                        e.currentTarget.style.boxShadow = "var(--shadow-btn-primary-hover)";
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = "scale(1)";
                                    e.currentTarget.style.boxShadow = "var(--shadow-btn-primary)";
                                }}
                                onMouseDown={(e) => { if (!isLoading) e.currentTarget.style.transform = "scale(0.98)"; }}
                            >
                                {isLoading ? "Se Generează..." : "▶ Generează Audio"}
                            </button>
                        </div>
                    </div>
                </div>

            ) : (

                /* ── Library Screen ── */
                <div className="flex-1 flex flex-col items-center justify-center relative">
                    {istoricCarti.length === 0 ? (
                        <div className="mt-[-10vh] text-center" style={{ animation: "fade-in 0.4s ease-out" }}>
                            <div className="text-6xl mb-6 grayscale opacity-30">📚</div>
                            <h1 className="text-4xl font-extrabold mb-3" style={{ color: "var(--text-primary)" }}>
                                Rafturile tale sunt goale.
                            </h1>
                            <p className="text-base font-medium max-w-sm mx-auto" style={{ color: "var(--heading-on-surface)", lineHeight: 1.7 }}>
                                Folosește meniul din stânga pentru a adăuga prima ta carte.
                            </p>
                        </div>
                    ) : (
                        <div
                            className="w-full h-full pt-4 flex flex-col justify-start items-start"
                            style={{ animation: "fade-in 0.3s ease-out" }}
                        >
                            <div className="mb-6 w-full">
                                <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: "var(--heading-on-surface)" }}>
                                    Biblioteca Mea
                                </h1>
                                <div
                                    className="mt-1.5 h-0.5 w-12 rounded-full"
                                    style={{ background: "linear-gradient(to right, #408A71, #B0E4CC)" }}
                                />
                            </div>

                            {cartiFiltrate.length === 0 ? (
                                <p
                                    className="py-10 text-sm font-medium text-center w-full"
                                    style={{ color: "var(--text-muted)" }}
                                >
                                    {t("library.noBooksMatchFilters")}
                                </p>
                            ) : (
                            <div className="flex w-full flex-col gap-10">
                                {librarySections.map((section) => (
                                    <div key={section.key} className="w-full">
                                        <div className="mb-4 flex flex-wrap items-center gap-2">
                                            <span className="text-base opacity-80" aria-hidden>
                                                📁
                                            </span>
                                            <h2
                                                className="text-lg font-extrabold tracking-tight"
                                                style={{ color: "var(--heading-on-surface)" }}
                                            >
                                                {section.title}
                                            </h2>
                                            {section.isUserFolder && section.folderId ? (
                                                <button
                                                    type="button"
                                                    className="ml-0.5 flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold leading-none opacity-60 transition-opacity hover:opacity-100"
                                                    style={{ color: "var(--text-muted)" }}
                                                    aria-label={`${t("library.deleteFolderAria")}: ${section.title}`}
                                                    onClick={(e) => stergeDosar(e, section.folderId!)}
                                                >
                                                    ×
                                                </button>
                                            ) : null}
                                        </div>
                                        {section.books.length === 0 ? (
                                            <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                                                {t("library.folderEmpty")}
                                            </p>
                                        ) : viewMode === "grid" ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 w-full">
                                {section.books.map((carte) => (
                                    <div
                                        key={carte.id}
                                        className="rounded-2xl cursor-pointer group flex flex-col h-full relative overflow-hidden"
                                        style={{
                                            background: "var(--card-bg)",
                                            boxShadow: "var(--shadow-card-sm)",
                                            border: "1px solid var(--border-card)",
                                            transition: "transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease",
                                        }}
                                        onClick={() => setCarteaCurenta(carte)}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.transform = "translateY(-3px)";
                                            e.currentTarget.style.boxShadow = "var(--shadow-card-hover)";
                                            e.currentTarget.style.borderColor = "rgba(176,228,204,0.5)";
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.transform = "translateY(0)";
                                            e.currentTarget.style.boxShadow = "var(--shadow-card-sm)";
                                            e.currentTarget.style.borderColor = "var(--border-card)";
                                        }}
                                    >
                                        {/* Gradient top accent */}
                                        <div
                                            className="absolute top-0 left-0 right-0 h-0.5"
                                            style={{
                                                background: "linear-gradient(to right, #408A71, #B0E4CC, transparent)",
                                                opacity: 0,
                                                transition: "opacity 0.2s ease",
                                            }}
                                            ref={(el) => {
                                                if (el) {
                                                    const parent = el.parentElement;
                                                    if (parent) {
                                                        parent.addEventListener("mouseenter", () => { el.style.opacity = "1"; });
                                                        parent.addEventListener("mouseleave", () => { el.style.opacity = "0"; });
                                                    }
                                                }
                                            }}
                                        />

                                        <div className="p-5 flex flex-col h-full">
                                            {/* Public in catalog (doar admin + user; guest nu poate) */}
                                            {(userRol === "admin" || userRol === "user") && (
                                                <label
                                                    className="absolute top-3.5 right-11 z-10 flex items-center gap-1 cursor-pointer select-none"
                                                    style={{ fontSize: "10px", fontWeight: 800, color: "var(--text-muted)" }}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={Boolean(carte.is_public)}
                                                        onChange={(e) => {
                                                            void togglePublicCarte(e, carte);
                                                        }}
                                                        className="rounded border accent-mid-green"
                                                        style={{ borderColor: "var(--input-border)" }}
                                                    />
                                                    <span>Public</span>
                                                </label>
                                            )}
                                            {/* Kebab menu button */}
                                            <button
                                                onClick={(e) => toggleMeniu(e, carte.id)}
                                                className="absolute top-3.5 right-3.5 w-8 h-8 flex items-center justify-center rounded-full font-bold text-lg z-10 transition-all duration-150"
                                                style={{ color: "var(--text-faint)" }}
                                                onMouseEnter={(e) => {
                                                    e.currentTarget.style.backgroundColor = "var(--hover-bg)";
                                                    e.currentTarget.style.color = "var(--heading-on-surface)";
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.currentTarget.style.backgroundColor = "transparent";
                                                    e.currentTarget.style.color = "var(--text-faint)";
                                                }}
                                            >
                                                ⋮
                                            </button>

                                            {/* Dropdown menu */}
                                            {meniuDeschisId === carte.id && (
                                                <div
                                                    className="absolute top-11 right-3.5 rounded-xl py-1.5 w-48 z-20"
                                                    style={{
                                                        animation: "fade-in 0.2s ease-out",
                                                        background: "var(--card-bg)",
                                                        boxShadow: "var(--shadow-dropdown)",
                                                        border: "1px solid var(--dropdown-border)",
                                                    }}
                                                >
                                                    {[
                                                        { label: "Redenumește", icon: "✎", action: (e: React.MouseEvent) => deschideRedenumire(e, carte) },
                                                        { label: "Descarcă MP3", icon: "↓", action: (e: React.MouseEvent) => handleDownload(e, carte.link_audio, carte.titlu) },
                                                        { label: "Distribuie link", icon: "⎘", action: (e: React.MouseEvent) => handleShare(e, carte.link_audio) },
                                                    ].map((item) => (
                                                        <button
                                                            key={item.label}
                                                            onClick={item.action}
                                                            className="w-full text-left px-4 py-2 text-sm font-medium flex items-center transition-colors duration-100"
                                                            style={{ color: "var(--text-body)" }}
                                                            onMouseEnter={(e) => {
                                                                e.currentTarget.style.backgroundColor = "var(--hover-bg)";
                                                                e.currentTarget.style.color = "var(--link-accent)";
                                                            }}
                                                            onMouseLeave={(e) => {
                                                                e.currentTarget.style.backgroundColor = "transparent";
                                                                e.currentTarget.style.color = "var(--text-body)";
                                                            }}
                                                        >
                                                            <span className="mr-3 opacity-60">{item.icon}</span>
                                                            {item.label}
                                                        </button>
                                                    ))}
                                                    <div className="my-1" style={{ borderTop: "1px solid var(--divider)" }} />
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setMeniuDeschisId(null);
                                                            setMutaCarteTarget(carte);
                                                        }}
                                                        className="w-full text-left px-4 py-2 text-sm font-medium flex items-center transition-colors duration-100"
                                                        style={{ color: "var(--text-body)" }}
                                                        onMouseEnter={(e) => {
                                                            e.currentTarget.style.backgroundColor = "var(--hover-bg)";
                                                            e.currentTarget.style.color = "var(--link-accent)";
                                                        }}
                                                        onMouseLeave={(e) => {
                                                            e.currentTarget.style.backgroundColor = "transparent";
                                                            e.currentTarget.style.color = "var(--text-body)";
                                                        }}
                                                    >
                                                        <span className="mr-3 opacity-60">📁</span>
                                                        Mută în dosar
                                                    </button>
                                                    <div className="my-1" style={{ borderTop: "1px solid var(--divider)" }} />
                                                    <button
                                                        onClick={(e) => handleSterge(e, carte.id)}
                                                        className="w-full text-left px-4 py-2 text-sm font-medium flex items-center transition-colors duration-100"
                                                        style={{ color: "var(--text-body)" }}
                                                        onMouseEnter={(e) => {
                                                            e.currentTarget.style.backgroundColor = "var(--hover-bg)";
                                                            e.currentTarget.style.color = "var(--heading-on-surface)";
                                                        }}
                                                        onMouseLeave={(e) => {
                                                            e.currentTarget.style.backgroundColor = "transparent";
                                                            e.currentTarget.style.color = "var(--text-body)";
                                                        }}
                                                    >
                                                        <span className="mr-3 opacity-60">✕</span>
                                                        Șterge document
                                                    </button>
                                                </div>
                                            )}

                                            {/* Card icon */}
                                            <div
                                                className="w-11 h-11 rounded-xl flex items-center justify-center mb-4 text-lg transition-transform duration-200 group-hover:scale-110"
                                                style={{
                                                    background: "linear-gradient(135deg, rgba(176,228,204,0.5), rgba(176,228,204,0.2))",
                                                    boxShadow: "0 2px 8px rgba(64,138,113,0.15)",
                                                }}
                                            >
                                                🎧
                                            </div>

                                            {/* Card title */}
                                            <h3
                                                className="font-extrabold mb-1 pr-16 leading-snug"
                                                style={{
                                                    color: "var(--text-primary)",
                                                    display: "-webkit-box",
                                                    WebkitLineClamp: 2,
                                                    WebkitBoxOrient: "vertical",
                                                    overflow: "hidden",
                                                }}
                                            >
                                                {carte.titlu}
                                            </h3>

                                            {/* Card source */}
                                            <p
                                                className="text-xs font-medium mb-4 truncate flex-grow"
                                                style={{ color: "var(--text-muted)" }}
                                                title={carte.url_sursa}
                                            >
                                                {carte.url_sursa}
                                            </p>

                                            {/* Card footer */}
                                            <div
                                                className="flex justify-between items-center text-xs font-bold mt-auto pt-4"
                                                style={{
                                                    borderTop: "1px solid var(--divider)",
                                                    color: "var(--link-accent)",
                                                }}
                                            >
                                                <span>{carte.data_generare}</span>
                                                <span
                                                    className="flex items-center transition-all duration-150 group-hover:translate-x-0.5"
                                                >
                                                    Ascultă <span className="ml-1">▶</span>
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                                        ) : (
                            <div className="flex flex-col gap-3 w-full">
                                {section.books.map((carte) => (
                                    <div
                                        key={carte.id}
                                        className="rounded-2xl cursor-pointer group flex flex-row items-center gap-3 w-full relative overflow-hidden py-3 pl-3 pr-3 sm:pl-4 sm:pr-4"
                                        style={{
                                            background: "var(--card-bg)",
                                            boxShadow: "var(--shadow-card-sm)",
                                            border: "1px solid var(--border-card)",
                                            transition: "border-color 0.2s ease",
                                        }}
                                        onClick={() => setCarteaCurenta(carte)}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.borderColor = "rgba(176,228,204,0.5)";
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.borderColor = "var(--border-card)";
                                        }}
                                    >
                                        {(userRol === "admin" || userRol === "user") && (
                                            <label
                                                className="absolute top-2 left-2 z-10 flex items-center gap-1 cursor-pointer select-none"
                                                style={{ fontSize: "10px", fontWeight: 800, color: "var(--text-muted)" }}
                                                onClick={(e) => e.stopPropagation()}
                                                onMouseDown={(e) => e.stopPropagation()}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={Boolean(carte.is_public)}
                                                    onChange={(e) => {
                                                        void togglePublicCarte(e, carte);
                                                    }}
                                                    className="rounded border accent-mid-green scale-90"
                                                    style={{ borderColor: "var(--input-border)" }}
                                                />
                                                <span>Public</span>
                                            </label>
                                        )}
                                        <button
                                            type="button"
                                            onClick={(e) => toggleMeniu(e, carte.id)}
                                            className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center rounded-full font-bold text-lg z-10 transition-all duration-150"
                                            style={{ color: "var(--text-faint)" }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.backgroundColor = "var(--hover-bg)";
                                                e.currentTarget.style.color = "var(--heading-on-surface)";
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundColor = "transparent";
                                                e.currentTarget.style.color = "var(--text-faint)";
                                            }}
                                        >
                                            ⋮
                                        </button>
                                        {meniuDeschisId === carte.id && (
                                            <div
                                                className="absolute top-11 right-2 rounded-xl py-1.5 w-48 z-20"
                                                style={{
                                                    animation: "fade-in 0.2s ease-out",
                                                    background: "var(--card-bg)",
                                                    boxShadow: "var(--shadow-dropdown)",
                                                    border: "1px solid var(--dropdown-border)",
                                                }}
                                            >
                                                {[
                                                    { label: "Redenumește", icon: "✎", action: (e: React.MouseEvent) => deschideRedenumire(e, carte) },
                                                    { label: "Descarcă MP3", icon: "↓", action: (e: React.MouseEvent) => handleDownload(e, carte.link_audio, carte.titlu) },
                                                    { label: "Distribuie link", icon: "⎘", action: (e: React.MouseEvent) => handleShare(e, carte.link_audio) },
                                                ].map((item) => (
                                                    <button
                                                        key={item.label}
                                                        type="button"
                                                        onClick={item.action}
                                                        className="w-full text-left px-4 py-2 text-sm font-medium flex items-center transition-colors duration-100"
                                                        style={{ color: "var(--text-body)" }}
                                                        onMouseEnter={(e) => {
                                                            e.currentTarget.style.backgroundColor = "var(--hover-bg)";
                                                            e.currentTarget.style.color = "var(--link-accent)";
                                                        }}
                                                        onMouseLeave={(e) => {
                                                            e.currentTarget.style.backgroundColor = "transparent";
                                                            e.currentTarget.style.color = "var(--text-body)";
                                                        }}
                                                    >
                                                        <span className="mr-3 opacity-60">{item.icon}</span>
                                                        {item.label}
                                                    </button>
                                                ))}
                                                <div className="my-1" style={{ borderTop: "1px solid var(--divider)" }} />
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setMeniuDeschisId(null);
                                                        setMutaCarteTarget(carte);
                                                    }}
                                                    className="w-full text-left px-4 py-2 text-sm font-medium flex items-center transition-colors duration-100"
                                                    style={{ color: "var(--text-body)" }}
                                                    onMouseEnter={(e) => {
                                                        e.currentTarget.style.backgroundColor = "var(--hover-bg)";
                                                        e.currentTarget.style.color = "var(--link-accent)";
                                                    }}
                                                    onMouseLeave={(e) => {
                                                        e.currentTarget.style.backgroundColor = "transparent";
                                                        e.currentTarget.style.color = "var(--text-body)";
                                                    }}
                                                >
                                                    <span className="mr-3 opacity-60">📁</span>
                                                    Mută în dosar
                                                </button>
                                                <div className="my-1" style={{ borderTop: "1px solid var(--divider)" }} />
                                                <button
                                                    type="button"
                                                    onClick={(e) => handleSterge(e, carte.id)}
                                                    className="w-full text-left px-4 py-2 text-sm font-medium flex items-center transition-colors duration-100"
                                                    style={{ color: "var(--text-body)" }}
                                                    onMouseEnter={(e) => {
                                                        e.currentTarget.style.backgroundColor = "var(--hover-bg)";
                                                        e.currentTarget.style.color = "var(--heading-on-surface)";
                                                    }}
                                                    onMouseLeave={(e) => {
                                                        e.currentTarget.style.backgroundColor = "transparent";
                                                        e.currentTarget.style.color = "var(--text-body)";
                                                    }}
                                                >
                                                    <span className="mr-3 opacity-60">✕</span>
                                                    Șterge document
                                                </button>
                                            </div>
                                        )}
                                        <div
                                            className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 ml-14 sm:ml-16"
                                            style={{
                                                background: "linear-gradient(135deg, rgba(176,228,204,0.5), rgba(176,228,204,0.2))",
                                            }}
                                        >
                                            🎧
                                        </div>
                                        <div className="flex-1 min-w-0 pr-24">
                                            <h3 className="font-extrabold truncate text-sm sm:text-base" style={{ color: "var(--text-primary)" }}>
                                                {carte.titlu}
                                            </h3>
                                            <p
                                                className="text-xs font-medium truncate"
                                                style={{ color: "var(--text-muted)" }}
                                                title={carte.url_sursa}
                                            >
                                                {carte.url_sursa}
                                            </p>
                                        </div>
                                        <div
                                            className="text-right text-[11px] sm:text-xs font-bold shrink-0 hidden sm:block self-center"
                                            style={{ color: "var(--link-accent)" }}
                                        >
                                            {carte.data_generare}
                                        </div>
                                    </div>
                                ))}
                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ── URL Modal ── */}
            {isModalOpen && (
                <div
                    className="fixed inset-0 flex items-center justify-center z-50 p-4"
                    style={{
                        background: "var(--overlay-scrim)",
                        backdropFilter: "blur(6px)",
                        animation: "fade-in 0.2s ease-out",
                    }}
                >
                    <div
                        className="p-8 rounded-3xl w-full max-w-lg text-left"
                        style={{
                            background: "var(--card-bg)",
                            boxShadow: "var(--shadow-modal)",
                            border: "1px solid var(--border-card)",
                        }}
                    >
                        <div className="mb-1">
                            <h2 className="text-2xl font-extrabold" style={{ color: "var(--heading-on-surface)" }}>Procesare URL</h2>
                        </div>
                        <p className="text-sm font-medium mb-6" style={{ color: "var(--text-muted)" }}>
                            Introdu link-ul articolului. AI-ul va curăța automat reclamele și meniurile.
                        </p>

                        <label className="block text-xs font-extrabold uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>
                            Link-ul paginii web
                        </label>
                        <input
                            type="text"
                            placeholder="https://..."
                            className="w-full rounded-xl p-4 mb-5 text-sm font-medium"
                            style={{
                                border: "2px solid var(--input-border)",
                                outline: "none",
                                transition: "border-color 0.2s, box-shadow 0.2s",
                                background: "var(--input-bg)",
                                color: "var(--text-body)",
                            }}
                            onFocus={(e) => {
                                e.target.style.borderColor = "#408A71";
                                e.target.style.boxShadow = "var(--focus-ring)";
                            }}
                            onBlur={(e) => {
                                e.target.style.borderColor = "var(--input-border)";
                                e.target.style.boxShadow = "none";
                            }}
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                        />

                        <label
                            className="flex items-center space-x-3 mb-8 cursor-pointer p-4 rounded-xl transition-colors duration-150"
                            style={{ background: "var(--card-bg-muted)" }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-bg-strong)")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--card-bg-muted)")}
                        >
                            <input
                                type="checkbox"
                                className="w-5 h-5 rounded cursor-pointer"
                                style={{ accentColor: "#408A71" }}
                                checked={forceRegenerate}
                                onChange={(e) => setForceRegenerate(e.target.checked)}
                            />
                            <span className="text-sm font-semibold" style={{ color: "var(--heading-on-surface)" }}>
                                Forțează regenerarea AI
                            </span>
                        </label>

                        <div className="flex justify-end space-x-3">
                            <button
                                onClick={() => setIsModalOpen(false)}
                                disabled={isLoading}
                                className="px-6 py-3 font-bold rounded-xl text-sm transition-colors duration-150"
                                style={{ color: "var(--text-muted)" }}
                                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--hover-bg)")}
                                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                            >
                                Anulează
                            </button>
                            <button
                                onClick={handleGenereaza}
                                disabled={isLoading}
                                className="px-8 py-3 text-white font-extrabold text-sm rounded-xl flex items-center disabled:opacity-50 transition-all duration-200"
                                style={{
                                    background: "linear-gradient(135deg, #408A71, #285A48)",
                                    boxShadow: "var(--shadow-btn-primary)",
                                }}
                                onMouseEnter={(e) => {
                                    if (!isLoading) e.currentTarget.style.boxShadow = "var(--shadow-btn-primary-hover)";
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.boxShadow = "var(--shadow-btn-primary)";
                                }}
                            >
                                {isLoading ? "AI-ul citește..." : "Generează Audio"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Rename Modal ── */}
            {modalRedenumire && (
                <div
                    className="fixed inset-0 flex items-center justify-center z-50 p-4"
                    style={{
                        background: "var(--overlay-scrim)",
                        backdropFilter: "blur(6px)",
                        animation: "fade-in 0.2s ease-out",
                    }}
                >
                    <div
                        className="p-8 rounded-3xl w-full max-w-sm text-left"
                        style={{
                            background: "var(--card-bg)",
                            boxShadow: "var(--shadow-modal)",
                            border: "1px solid var(--border-card)",
                        }}
                    >
                        <h2 className="text-xl font-extrabold mb-4" style={{ color: "var(--heading-on-surface)" }}>
                            Redenumește cartea
                        </h2>
                        <input
                            type="text"
                            className="w-full rounded-xl p-3 mb-6 text-sm font-medium"
                            style={{
                                border: "2px solid var(--input-border)",
                                outline: "none",
                                transition: "border-color 0.2s, box-shadow 0.2s",
                                background: "var(--input-bg)",
                                color: "var(--text-body)",
                            }}
                            onFocus={(e) => {
                                e.target.style.borderColor = "#408A71";
                                e.target.style.boxShadow = "var(--focus-ring)";
                            }}
                            onBlur={(e) => {
                                e.target.style.borderColor = "var(--input-border)";
                                e.target.style.boxShadow = "none";
                            }}
                            value={titluNou}
                            onChange={(e) => setTitluNou(e.target.value)}
                            autoFocus
                        />
                        <div className="flex justify-end space-x-3">
                            <button
                                onClick={() => setModalRedenumire(false)}
                                className="px-4 py-2 font-bold rounded-xl text-sm transition-colors duration-150"
                                style={{ color: "var(--text-muted)" }}
                                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--hover-bg)")}
                                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                            >
                                Anulează
                            </button>
                            <button
                                onClick={salveazaRedenumire}
                                className="px-6 py-2 text-white font-extrabold text-sm rounded-xl transition-all duration-200"
                                style={{
                                    background: "linear-gradient(135deg, #408A71, #285A48)",
                                    boxShadow: "var(--shadow-btn-sm)",
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "var(--shadow-btn-sm-hover)")}
                                onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "var(--shadow-btn-sm)")}
                            >
                                Salvează
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Toast ── */}
            {toastMessage && (
                <div
                    className="fixed bottom-10 left-1/2 -translate-x-1/2 text-white px-6 py-3 rounded-full flex items-center space-x-3 z-50"
                    style={{
                        background: "linear-gradient(135deg, #285A48, #1a3d2f)",
                        boxShadow: "var(--shadow-toast)",
                        animation: "fade-in 0.25s ease-out",
                    }}
                >
                    <span className="text-light-green text-sm">✓</span>
                    <span className="font-semibold text-sm tracking-wide">{toastMessage}</span>
                </div>
            )}

            {/* ── Delete Confirmation Modal ── */}
            {modalStergere && (
                <div
                    className="fixed inset-0 flex items-center justify-center z-50 p-4"
                    style={{
                        background: "var(--overlay-scrim)",
                        backdropFilter: "blur(6px)",
                        animation: "fade-in 0.2s ease-out",
                    }}
                >
                    <div
                        className="rounded-2xl w-full max-w-sm overflow-hidden"
                        style={{
                            background: "var(--card-bg)",
                            boxShadow: "var(--shadow-modal)",
                            border: "1px solid var(--border-card)",
                        }}
                    >
                        <div
                            className="px-6 py-4 flex items-center justify-center relative"
                            style={{ borderBottom: "1px solid var(--divider)" }}
                        >
                            <h2 className="text-base font-extrabold" style={{ color: "var(--heading-on-surface)" }}>
                                Șterge Documentul
                            </h2>
                            <button
                                onClick={() => { setModalStergere(false); setCarteDeSters(null); }}
                                className="absolute right-4 font-bold text-xl leading-none transition-colors duration-150"
                                style={{ color: "var(--text-muted)" }}
                                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
                                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
                            >
                                &times;
                            </button>
                        </div>

                        <div className="p-6 text-center">
                            <p className="font-medium mb-6 text-sm" style={{ color: "var(--text-body)" }}>
                                Ești sigur că vrei să ștergi?
                            </p>
                            <button
                                onClick={confirmaStergerea}
                                className="w-full py-3 text-white font-extrabold rounded-lg text-sm uppercase tracking-wider transition-all duration-200"
                                style={{
                                    background: "linear-gradient(135deg, #285A48, #1a3d2f)",
                                    boxShadow: "var(--shadow-btn-destructive)",
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = "linear-gradient(135deg, #408A71, #285A48)";
                                    e.currentTarget.style.boxShadow = "var(--shadow-btn-destructive-hover)";
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = "linear-gradient(135deg, #285A48, #1a3d2f)";
                                    e.currentTarget.style.boxShadow = "var(--shadow-btn-destructive)";
                                }}
                            >
                                Șterge
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Mută în dosar ── */}
            {mutaCarteTarget && (
                <div
                    className="fixed inset-0 flex items-center justify-center z-50 p-4"
                    style={{
                        background: "var(--overlay-scrim)",
                        backdropFilter: "blur(6px)",
                        animation: "fade-in 0.2s ease-out",
                    }}
                    onClick={() => setMutaCarteTarget(null)}
                >
                    <div
                        role="dialog"
                        aria-labelledby="muta-dosar-title"
                        className="p-8 rounded-3xl w-full max-w-md text-left max-h-[85vh] overflow-y-auto"
                        style={{
                            background: "var(--card-bg)",
                            boxShadow: "var(--shadow-modal)",
                            border: "1px solid var(--border-card)",
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h2
                            id="muta-dosar-title"
                            className="text-xl font-extrabold mb-1"
                            style={{ color: "var(--heading-on-surface)" }}
                        >
                            Mută în dosar
                        </h2>
                        <p className="text-sm font-medium mb-5 truncate" style={{ color: "var(--text-muted)" }} title={mutaCarteTarget.titlu}>
                            {mutaCarteTarget.titlu}
                        </p>
                        <div className="flex flex-col gap-2">
                            <button
                                type="button"
                                onClick={() => mutaCarteInDosar(mutaCarteTarget.id, null)}
                                className="w-full text-left px-4 py-3 rounded-xl text-sm font-bold transition-colors duration-150"
                                style={{
                                    border: "2px solid var(--input-border)",
                                    background: "var(--card-bg-muted)",
                                    color: "var(--text-body)",
                                }}
                            >
                                Fără dosar (eliberează)
                            </button>
                            {folders.map((fd) => (
                                <button
                                    key={fd.id}
                                    type="button"
                                    onClick={() => mutaCarteInDosar(mutaCarteTarget.id, fd.id)}
                                    className="w-full text-left px-4 py-3 rounded-xl text-sm font-bold transition-colors duration-150"
                                    style={{
                                        border: "2px solid var(--input-border)",
                                        background: "var(--card-bg-muted)",
                                        color: "var(--text-body)",
                                    }}
                                >
                                    📁 {fd.name}
                                </button>
                            ))}
                        </div>
                        {folders.length === 0 && (
                            <p className="text-xs font-medium mt-3" style={{ color: "var(--text-faint)" }}>
                                {t("library.noFoldersHintHeader")}
                            </p>
                        )}
                        <div className="flex justify-end mt-6">
                            <button
                                type="button"
                                onClick={() => setMutaCarteTarget(null)}
                                className="px-4 py-2 font-bold rounded-xl text-sm transition-colors duration-150"
                                style={{ color: "var(--text-muted)" }}
                                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--hover-bg)")}
                                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                            >
                                Închide
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
