"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, authHeadersJson, clearAuthSession, fetchCarteSegmente, fetchGuestCredits, GUEST_JOB_MAX_CHARS, GUEST_PREVIEW_CHARS, isGuestSession, mesajEroareFastAPI, segmentsFromCarteDb, streamExtrageUrl, streamGenereazaText, type GenerationSegment, type GenerationStreamEvent, type GuestCreditsInfo, type PlaylistMode } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { GenerationPlaylist } from "@/components/GenerationPlaylist";
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
    const { t, locale } = useI18n();
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
    const [guestCredits, setGuestCredits] = useState<GuestCreditsInfo | null>(null);
    const [genPhase, setGenPhase] = useState<string | null>(null);
    const [genSegments, setGenSegments] = useState<GenerationSegment[]>([]);
    const [genSegmentsTotal, setGenSegmentsTotal] = useState<number | null>(null);
    const [genActiveSegment, setGenActiveSegment] = useState<number | null>(null);
    const [genPlaylistMode, setGenPlaylistMode] = useState<PlaylistMode>("parts");
    const [isGuestPreviewGen, setIsGuestPreviewGen] = useState(false);
    const [showGuestSignupPrompt, setShowGuestSignupPrompt] = useState(false);
    const [libSegments, setLibSegments] = useState<GenerationSegment[]>([]);
    const [libPlaylistMode, setLibPlaylistMode] = useState<PlaylistMode>("parts");
    const [curataCuGemini, setCurataCuGemini] = useState(false);

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
        if (!isGuestSession()) {
            setGuestCredits(null);
            return;
        }
        fetchGuestCredits().then(setGuestCredits).catch(() => setGuestCredits(null));
    }, [userRol, isLoading]);

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
            setTitluText(ce.detail.titlu || t("home.defaultDocument"));
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
                            titlu: item.titlu || t("home.untitledArticle"),
                            url_sursa: item.url,
                            status: t("home.statusComplete"),
                            link_audio: item.audio_link,
                            text_extras: item.text_curatat,
                            data_generare: new Date(item.creat_la).toLocaleDateString(locale === "en" ? "en-GB" : "ro-RO"),
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
    }, [router, t, locale]);

    useEffect(() => {
        if (!carteaCurenta?.id) {
            setLibSegments([]);
            return;
        }
        let cancelled = false;
        (async () => {
            const rows = await fetchCarteSegmente(Number(carteCurenta.id));
            if (cancelled) return;
            const mode = (carteaCurenta.playlist_mode as PlaylistMode) || (rows.some((r) => r.chapter_index != null) ? "chapters" : "parts");
            setLibPlaylistMode(mode);
            setLibSegments(rows.length ? segmentsFromCarteDb(rows, mode) : []);
        })();
        return () => { cancelled = true; };
    }, [carteaCurenta?.id, carteaCurenta?.playlist_mode]);

    const applyStreamEvent = (evt: GenerationStreamEvent): Record<string, unknown> | null | "error" => {
        if (evt.type === "playlist_mode") {
            setGenPlaylistMode(evt.mode);
            return null;
        }
        if (evt.type === "preview") {
            setIsGuestPreviewGen(true);
            return null;
        }
        if (evt.type === "phase") {
            setGenPhase(evt.phase);
            if (evt.segments_total != null) setGenSegmentsTotal(evt.segments_total);
            return null;
        }
        if (evt.type === "segment") {
            setGenPhase("tts");
            setGenSegments((prev) => {
                const next = prev.filter((s) => s.index !== evt.index);
                next.push(evt);
                return next.sort((a, b) => a.index - b.index);
            });
            return null;
        }
        if (evt.type === "done") {
            return evt as Record<string, unknown>;
        }
        if (evt.type === "error") {
            const msg = typeof evt.detail === "string" ? evt.detail : t("home.alertGenerateError");
            alert(msg);
            return "error";
        }
        return null;
    };

    const finalizeCarteFromStream = (
        data: Record<string, unknown>,
        meta: { titlu: string; url_sursa: string },
    ) => {
        if (data.guest_credits && typeof data.guest_credits === "object") {
            const gc = data.guest_credits as { credits_remaining?: number };
            setGuestCredits((prev) =>
                prev ? { ...prev, credits_remaining: gc.credits_remaining ?? prev.credits_remaining } : prev,
            );
        }
        const tf = typeof data.text_final_audio === "string" ? data.text_final_audio : "";
        const now = Date.now();
        const segs = Array.isArray(data.segments) ? data.segments : genSegments;
        const carteNoua = {
            id: data.id ?? Date.now(),
            titlu: (data.titlu as string) || meta.titlu,
            url_sursa: meta.url_sursa,
            status: data.status,
            link_audio: data.link_audio,
            text_extras: data.text_final_audio,
            data_generare: new Date().toLocaleDateString(locale === "en" ? "en-GB" : "ro-RO"),
            is_public: Boolean(data.is_public),
            creat_la_ts: now,
            lungime_text: tf.length,
            segments: segs,
            playlist_mode: (data.playlist_mode as PlaylistMode) || genPlaylistMode,
            is_guest_preview: Boolean(data.is_guest_preview),
        };
        setIstoricCarti((cartiVechi) => [carteNoua, ...cartiVechi]);
        setCarteaCurenta(carteNoua);
        setLibSegments(segs as GenerationSegment[]);
        setLibPlaylistMode(carteNoua.playlist_mode);
        setShowTextEditor(false);
        setGenPhase(null);
        window.dispatchEvent(new Event("reseteaza-meniu"));
    };

    /** POST /extrage/stream: URL → extract + TTS cu playlist live. */
    const handleGenereaza = async () => {
        if (!url) { alert(t("home.alertValidUrl")); return; }
        setIsLoading(true);
        setGenPhase("extracting");
        setGenSegments([]);
        setGenSegmentsTotal(null);
        setGenPlaylistMode("parts");
        setIsGuestPreviewGen(false);
        let success = false;
        try {
            let donePayload: Record<string, unknown> | null = null;
            await streamExtrageUrl(
                { url, force_regenerate: forceRegenerate },
                (evt) => {
                    const r = applyStreamEvent(evt);
                    if (r === "error") return;
                    if (r) donePayload = r;
                },
            );
            if (!donePayload) {
                alert(t("home.alertUrlError"));
                return;
            }
            if (donePayload.from_cache) {
                const data = donePayload;
                const rows = await fetchCarteSegmente(Number(data.id));
                const mode = rows.some((r) => r.chapter_index != null) ? "chapters" : "parts";
                const carteNoua = {
                    id: data.id,
                    titlu: data.titlu || t("home.webArticle"),
                    url_sursa: url,
                    status: data.status,
                    link_audio: data.link_audio,
                    text_extras: data.text_final_audio,
                    data_generare: new Date().toLocaleDateString(locale === "en" ? "en-GB" : "ro-RO"),
                    is_public: Boolean(data.is_public),
                    playlist_mode: mode,
                };
                setCarteaCurenta(carteNoua);
                setLibSegments(rows.length ? segmentsFromCarteDb(rows, mode) : []);
                setLibPlaylistMode(mode);
                success = true;
                return;
            }
            success = true;
            finalizeCarteFromStream(donePayload, { titlu: String(donePayload.titlu || t("home.webArticle")), url_sursa: url });
        } catch (err) {
            const msg = err instanceof Error && err.message ? err.message : t("home.alertServerError");
            alert(msg);
        } finally {
            setIsLoading(false);
            if (success) {
                setIsModalOpen(false);
                setUrl("");
                setGenSegments([]);
                setGenPhase(null);
            } else {
                setGenPhase(null);
                setGenSegments([]);
            }
        }
    };

    /** POST /genereaza_text/stream: curatare Gemini + TTS pe segmente + playlist live. */
    const handleGenereazaDinText = async () => {
        if (!titluText || !textManual) { alert(t("home.alertTitleAndText")); return; }
        const charLen = textManual.trim().length;
        setIsLoading(true);
        setIsGuestPreviewGen(isGuestSession() && charLen > GUEST_PREVIEW_CHARS);
        if (curataCuGemini) {
            setGenPhase("cleaning");
            setGenSegmentsTotal(null);
        } else {
            setGenPhase("tts");
            setGenSegmentsTotal(Math.max(1, Math.ceil(Math.min(charLen, isGuestSession() ? GUEST_PREVIEW_CHARS : charLen) / 2800)));
        }
        setGenSegments([]);
        setGenPlaylistMode(charLen >= 50000 ? "chapters" : "parts");
        let success = false;
        try {
            let donePayload: Record<string, unknown> | null = null;
            await streamGenereazaText(
                { titlu: titluText, text: textManual, curata_cu_gemini: curataCuGemini },
                (evt) => {
                    const r = applyStreamEvent(evt);
                    if (r === "error") return;
                    if (r) donePayload = r;
                },
            );
            if (!donePayload) {
                alert(t("home.alertTextGenerateError"));
                return;
            }
            success = true;
            finalizeCarteFromStream(donePayload, { titlu: titluText, url_sursa: t("home.manualSourceValue") });
        } catch (err) {
            const msg = err instanceof Error && err.message ? err.message : t("home.alertTextGenerateError");
            alert(msg);
        } finally {
            setIsLoading(false);
            if (success) {
                setTitluText("");
                setTextManual("");
            }
            if (!success) {
                setGenPhase(null);
                setGenSegments([]);
                setGenSegmentsTotal(null);
                setGenActiveSegment(null);
            }
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
                alert(typeof j.detail === "string" ? j.detail : t("home.alertPublicError"));
                return;
            }
            setIstoricCarti((prev) =>
                prev.map((c) => (c.id === carte.id ? { ...c, is_public: !carte.is_public } : c)),
            );
            if (carteaCurenta?.id === carte.id) {
                setCarteaCurenta({ ...carteaCurenta, is_public: !carte.is_public });
            }
        } catch {
            alert(t("home.alertNetworkError"));
        }
    };

    const handleShare = (e: React.MouseEvent, link: string) => {
        e.stopPropagation();
        navigator.clipboard.writeText(link);
        setMeniuDeschisId(null);
        setToastMessage(t("home.linkCopied"));
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
            alert(t("home.alertRenameError"));
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
            alert(t("home.alertDeleteError"));
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
                        {t("home.backToLibrary")}
                    </button>

                    <div className="mb-8" style={{ borderBottom: "1px solid var(--divider)", paddingBottom: "1.5rem" }}>
                        <h2
                            className="text-3xl font-extrabold mb-2 leading-tight"
                            style={{ color: "var(--heading-on-surface)" }}
                        >
                            {carteaCurenta.titlu}
                        </h2>
                        {carteaCurenta.url_sursa === t("home.manualSourceValue") ? (
                            <span className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>{t("home.sourceManual")}</span>
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
                                {t("home.openOriginal")} <span className="ml-1 text-xs">↗</span>
                            </a>
                        )}
                    </div>

                    <div
                        className="p-8 rounded-2xl mb-8"
                        style={{
                            background: "linear-gradient(135deg, var(--player-well-a) 0%, var(--player-well-b) 100%)",
                            boxShadow: "var(--shadow-player-inset)",
                            border: "1px solid var(--border-card)",
                        }}
                    >
                        {libSegments.length > 0 ? (
                            <GenerationPlaylist
                                segments={libSegments}
                                phase={null}
                                segmentsTotal={libSegments.length}
                                playlistMode={libPlaylistMode}
                                activeIndex={genActiveSegment}
                                onActiveChange={setGenActiveSegment}
                                isGuestPreview={Boolean(carteaCurenta.is_guest_preview)}
                                onGuestPreviewFinished={() => setShowGuestSignupPrompt(true)}
                            />
                        ) : (
                            <audio controls className="w-full max-w-2xl" preload="metadata">
                                <source src={carteaCurenta.link_audio} type="audio/mpeg" />
                                {t("home.audioUnsupported")}
                            </audio>
                        )}
                    </div>

                    <div>
                        <h3
                            className="font-extrabold text-xs uppercase tracking-widest mb-4"
                            style={{ color: "var(--text-muted)" }}
                        >
                            {t("home.extractedText")}
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
                                placeholder={t("home.materialTitlePlaceholder")}
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
                            placeholder={t("home.textPlaceholder")}
                            className="w-full flex-1 border-0 p-4 resize-none leading-relaxed text-lg bg-transparent"
                            style={{ color: "var(--text-body)", outline: "none" }}
                            value={textManual}
                            onChange={(e) => setTextManual(e.target.value)}
                        />

                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                            <span>
                                {t("home.charCount")}: {textManual.length}
                                {isGuestSession()
                                    ? ` / ${guestCredits?.credits_per_job_max ?? GUEST_JOB_MAX_CHARS} ${t("home.guestPerJobMax").toLowerCase()}`
                                    : ""}
                            </span>
                            {isGuestSession() ? (
                                <span>
                                    {t("home.guestCredits")}: {guestCredits?.credits_remaining ?? GUEST_PREVIEW_CHARS}
                                    {` / ${guestCredits?.credits_total ?? GUEST_PREVIEW_CHARS}`}
                                </span>
                            ) : null}
                        </div>
                        {isGuestSession() && textManual.length > GUEST_PREVIEW_CHARS ? (
                            <p className="mt-1 px-1 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                                {t("gen.guestPreviewHint")}
                            </p>
                        ) : null}

                        <label
                            className="mt-3 flex items-start gap-3 px-1 cursor-pointer select-none"
                            style={{ color: "var(--text-muted)" }}
                        >
                            <input
                                type="checkbox"
                                checked={curataCuGemini}
                                onChange={(e) => setCurataCuGemini(e.target.checked)}
                                disabled={isLoading}
                                className="mt-0.5 h-4 w-4 rounded accent-[#408A71]"
                            />
                            <span className="text-sm leading-snug">
                                <span className="font-semibold block" style={{ color: "var(--text-primary)" }}>
                                    {t("home.cleanWithAi")}
                                </span>
                                {t("home.cleanWithAiHint")}
                            </span>
                        </label>

                        {(isLoading || genSegments.length > 0 || genPhase) ? (
                            <GenerationPlaylist
                                segments={genSegments}
                                phase={genPhase}
                                segmentsTotal={genSegmentsTotal}
                                playlistMode={genPlaylistMode}
                                activeIndex={genActiveSegment}
                                onActiveChange={setGenActiveSegment}
                                isGuestPreview={isGuestPreviewGen}
                                onGuestPreviewFinished={() => setShowGuestSignupPrompt(true)}
                            />
                        ) : null}

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
                                {isLoading ? t("home.generating") : t("home.generateAudio")}
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
                                {t("home.emptyShelves")}
                            </h1>
                            <p className="text-base font-medium max-w-sm mx-auto" style={{ color: "var(--heading-on-surface)", lineHeight: 1.7 }}>
                                {t("home.emptyShelvesHint")}
                            </p>
                        </div>
                    ) : (
                        <div
                            className="w-full h-full pt-4 flex flex-col justify-start items-start"
                            style={{ animation: "fade-in 0.3s ease-out" }}
                        >
                            <div className="mb-6 w-full">
                                <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: "var(--heading-on-surface)" }}>
                                    {t("home.myLibrary")}
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
                                                    <span>{t("home.public")}</span>
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
                                                        { label: t("home.menuRename"), icon: "✎", action: (e: React.MouseEvent) => deschideRedenumire(e, carte) },
                                                        { label: t("home.menuDownload"), icon: "↓", action: (e: React.MouseEvent) => handleDownload(e, carte.link_audio, carte.titlu) },
                                                        { label: t("home.menuShare"), icon: "⎘", action: (e: React.MouseEvent) => handleShare(e, carte.link_audio) },
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
                                                        {t("home.moveToFolder")}
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
                                                        {t("home.deleteDocument")}
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
                                                    {t("home.listen")} <span className="ml-1">▶</span>
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
                                                <span>{t("home.public")}</span>
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
                                                    { label: t("home.menuRename"), icon: "✎", action: (e: React.MouseEvent) => deschideRedenumire(e, carte) },
                                                    { label: t("home.menuDownload"), icon: "↓", action: (e: React.MouseEvent) => handleDownload(e, carte.link_audio, carte.titlu) },
                                                    { label: t("home.menuShare"), icon: "⎘", action: (e: React.MouseEvent) => handleShare(e, carte.link_audio) },
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
                                                    {t("home.moveToFolder")}
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
                                                    {t("home.deleteDocument")}
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
                            <h2 className="text-2xl font-extrabold" style={{ color: "var(--heading-on-surface)" }}>{t("home.urlModalTitle")}</h2>
                        </div>
                        <p className="text-sm font-medium mb-6" style={{ color: "var(--text-muted)" }}>
                            {t("home.urlModalBody")}
                        </p>

                        <label className="block text-xs font-extrabold uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>
                            {t("home.urlLabel")}
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
                                {t("home.forceRegenerate")}
                            </span>
                        </label>

                        {(isLoading || genSegments.length > 0 || genPhase) ? (
                            <GenerationPlaylist
                                segments={genSegments}
                                phase={genPhase}
                                segmentsTotal={genSegmentsTotal}
                                playlistMode={genPlaylistMode}
                                activeIndex={genActiveSegment}
                                onActiveChange={setGenActiveSegment}
                                isGuestPreview={isGuestPreviewGen}
                                onGuestPreviewFinished={() => setShowGuestSignupPrompt(true)}
                            />
                        ) : null}

                        <div className="flex justify-end space-x-3">
                            <button
                                onClick={() => setIsModalOpen(false)}
                                disabled={isLoading}
                                className="px-6 py-3 font-bold rounded-xl text-sm transition-colors duration-150"
                                style={{ color: "var(--text-muted)" }}
                                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--hover-bg)")}
                                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                            >
                                {t("library.modalCancel")}
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
                                {isLoading ? t("home.aiReading") : t("home.generateAudioShort")}
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
                            {t("home.renameTitle")}
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
                                {t("library.modalCancel")}
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
                                {t("home.save")}
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
                                {t("home.deleteDocTitle")}
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
                                {t("home.deleteConfirm")}
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
                                {t("home.delete")}
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
                            {t("home.moveToFolderTitle")}
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
                                {t("home.unfiledRelease")}
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
                                {t("home.close")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {showGuestSignupPrompt && (
                <div
                    className="fixed inset-0 flex items-center justify-center z-[60] p-4"
                    style={{ background: "var(--overlay-scrim)", backdropFilter: "blur(6px)" }}
                >
                    <div
                        className="p-8 rounded-3xl w-full max-w-md text-center"
                        style={{ background: "var(--card-bg)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-modal)" }}
                    >
                        <h2 className="text-xl font-extrabold mb-3" style={{ color: "var(--heading-on-surface)" }}>
                            {t("gen.guestPreviewDoneTitle")}
                        </h2>
                        <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
                            {t("gen.guestPreviewDoneBody")}
                        </p>
                        <button
                            type="button"
                            className="px-6 py-3 rounded-full text-white font-bold text-sm"
                            style={{ background: "linear-gradient(135deg, #408A71, #285A48)" }}
                            onClick={() => { setShowGuestSignupPrompt(false); router.push("/login"); }}
                        >
                            {t("gen.guestPreviewSignup")}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
