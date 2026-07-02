"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getApiBase, authHeadersJson, clearAuthSession, fetchCarteRezumat, fetchCarteSegmente, fetchGuestCredits, GUEST_JOB_MAX_CHARS, GUEST_PREVIEW_CHARS, isGuestSession, segmentsFromCarteDb, touchCarteAccess, type DocumentExtractMeta, type GenerationSegment, type GuestCreditsInfo, type PlaylistMode } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { showToast } from "@/lib/toast";
import { confirmDialog } from "@/lib/confirm";
import {
    cancelActiveGenerationJob,
    guardGenerationStart,
    isGenerationBusy,
    runStreamExtrageUrl,
    runStreamGenereazaText,
    useGenerationJob,
    GENERATION_PROGRESS_VIEW_EVENT,
    consumePendingProgressView,
    getGenerationJobState,
} from "@/lib/generationJob";
import { GenerationPlaylist } from "@/components/GenerationPlaylist";
import { TtsVoicePicker } from "@/components/TtsVoicePicker";
import { ReadingFontToggle } from "@/components/ReadingFontToggle";
import { readingContentClass, useReadingFont } from "@/lib/readingFont";
import { bookAccessTimestamp, formatBookAccessLabel, formatBookCreatedLabel } from "@/lib/formatBookDate";
import {
    getBookFolderId,
    LIBRARY_FILTERS_CHANGE_EVENT,
    LIBRARY_FOLDERS_CHANGED_EVENT,
    LIBRARY_BOOK_VIEW_EVENT,
    loadLibraryUi,
    removeBookAssignmentsForFolder,
    saveLibraryUi,
    setBookFolderId as mapSetBookFolder,
    getWelcomeState,
    setWelcomeDismissed,
    setWelcomeTitle,
    WELCOME_BOOK_ID,
    type LibraryFiltersDetail,
    type LibraryFolder,
    type LibrarySortDir,
    type LibrarySortKey,
    type LibraryViewMode,
} from "@/lib/libraryUiStorage";
import { getStoredTtsVoice, setStoredTtsVoice } from "@/lib/ttsVoiceStorage";
import { clearStoredSummary, getStoredSummary, setStoredSummary } from "@/lib/summaryStorage";

/**
 * Ecranul principal dupa login: lista de carti (GET /istoric), redare audio, editor pentru text manual,
 * modal pentru URL. AppShell trimite evenimente globale (deschide modal, incarca document) pe care ii ascultam aici.
 */
export default function Home() {
    const { t, locale } = useI18n();
    const router = useRouter();

    // Stare pentru modalul de URL (extragere din link web) si optiunea de regenerare fortata.
    const [isModalOpen, setIsModalOpen] = useState(false);   // e deschis modalul de URL?
    const [url, setUrl] = useState("");                       // ce URL a scris utilizatorul
    const [forceRegenerate, setForceRegenerate] = useState(false);  // regenereaza chiar daca exista in cache?

    // Stare pentru editorul de text manual (sau pentru textul extras dintr-un document).
    const [showTextEditor, setShowTextEditor] = useState(false);  // e deschis editorul de text?
    const [titluText, setTitluText] = useState("");               // titlul scris in editor
    const [textManual, setTextManual] = useState("");             // continutul din editor
    /** Numele fisierului sursa cand textul din editor vine dintr-un document; null inseamna text scris de mana. */
    const [editorSourceName, setEditorSourceName] = useState<string | null>(null);

    // Stare pentru biblioteca: lista de carti si cartea deschisa acum.
    const [istoricCarti, setIstoricCarti] = useState<any[]>([]);  // toate cartile utilizatorului (de la GET /istoric)
    const [carteaCurenta, setCarteaCurenta] = useState<any>(null);  // cartea afisata in ecranul de redare (null = niciuna)

    // Stare pentru meniurile contextuale si modalele de redenumire/stergere.
    const [meniuDeschisId, setMeniuDeschisId] = useState<number | null>(null);  // ce card are meniul "..." deschis
    const [modalRedenumire, setModalRedenumire] = useState(false);
    const [carteDeRedenumit, setCarteDeRedenumit] = useState<any>(null);
    const [titluNou, setTitluNou] = useState("");

    const [modalStergere, setModalStergere] = useState(false);
    const [carteDeSters, setCarteDeSters] = useState<number | string | null>(null);

    // Stare legata de creditele de oaspete si de generarea in timp real (streaming).
    const [guestCredits, setGuestCredits] = useState<GuestCreditsInfo | null>(null);  // cate credite mai are oaspetele
    const genJob = useGenerationJob();  // ma abonez la jobul global de generare (vine din generationJob.ts)
    const streamBusy = genJob.busy && genJob.kind === "stream";  // ruleaza chiar acum o generare de tip stream?
    const { enabled: readingFontOn } = useReadingFont();  // e activat fontul prietenos la citit?
    const [genActiveSegment, setGenActiveSegment] = useState<number | null>(null);  // segmentul care se reda acum
    const [showGuestSignupPrompt, setShowGuestSignupPrompt] = useState(false);  // arat invitatia de cont dupa preview-ul de oaspete?
    const [libSegments, setLibSegments] = useState<GenerationSegment[]>([]);  // segmentele cartii deschise din biblioteca
    const [libPlaylistMode, setLibPlaylistMode] = useState<PlaylistMode>("parts");  // mod playlist pt cartea deschisa
    const [documentExtractMeta, setDocumentExtractMeta] = useState<DocumentExtractMeta | null>(null);  // info despre documentul extras
    const [curataCuGemini, setCurataCuGemini] = useState(false);  // bifa "curata textul cu AI"
    const [ttsVoice, setTtsVoice] = useState(() => getStoredTtsVoice());  // vocea aleasa (initial cea salvata)
    const [summaryText, setSummaryText] = useState<string | null>(null);  // rezumatul cartii curente
    const [summaryLoading, setSummaryLoading] = useState(false);  // se genereaza rezumatul acum?

    /** Goleste indexul segmentului activ (playlist live e in job-ul global). */
    const resetGenStreamUi = useCallback(() => {
        if (isGenerationBusy()) return;
        setGenActiveSegment(null);
    }, []);

    /** Opresc generarea de pe server, dar numai dupa ce utilizatorul confirma in dialog. */
    const cancelGeneration = useCallback(async () => {
        // Cer confirmare ca sa nu opreasca din greseala o generare lunga.
        const ok = await confirmDialog({ message: t("gen.cancelConfirm"), title: t("gen.cancelGeneration") });
        if (!ok) return;
        await cancelActiveGenerationJob();
        setShowGuestSignupPrompt(false);
    }, [t]);

    /** Inchide ecranul de generare fara a opri job-ul (navigare in fundal). */
    const minimizeStreamView = useCallback(() => {
        if (!isGenerationBusy()) return;
        setIsModalOpen(false);
        setShowTextEditor(false);
        window.dispatchEvent(new Event("reseteaza-meniu"));
    }, []);

    /** Redeschide modalul URL sau editorul text pentru job-ul stream activ. */
    const openStreamProgressView = useCallback(() => {
        // Daca nu mai ruleaza nimic, nu am ce ecran de progres sa redeschid.
        const job = getGenerationJobState();
        if (!job.busy || job.kind !== "stream" || !job.streamOrigin) return;
        setCarteaCurenta(null);
        // Redeschid exact ecranul de unde a pornit generarea: modalul de URL sau editorul de text.
        if (job.streamOrigin === "url") {
            setShowTextEditor(false);
            setIsModalOpen(true);
        } else {
            setIsModalOpen(false);
            setShowTextEditor(true);
        }
    }, []);

    // Stare pentru organizarea bibliotecii (dosare, sortare, filtru, mod de afisare) - tinuta local pe browser.
    const [folders, setFolders] = useState<LibraryFolder[]>([]);  // dosarele create de utilizator
    const [bookFolderId, setBookFolderId] = useState<Record<string, string | null>>({});  // in ce dosar e fiecare carte
    const [viewMode, setViewMode] = useState<LibraryViewMode>("grid");  // grid sau lista
    const [sortKey, setSortKey] = useState<LibrarySortKey>("acces");    // dupa ce sortez (nume/data/acces/dimensiune)
    const [sortDir, setSortDir] = useState<LibrarySortDir>("desc");     // crescator sau descrescator
    const [nameFilter, setNameFilter] = useState("");                   // textul de cautare dupa titlu
    const [mutaCarteTarget, setMutaCarteTarget] = useState<any>(null);  // cartea pe care o mut intr-un dosar

    // De aici incep efectele (useEffect): incarc creditele de oaspete si tin sincronizata organizarea bibliotecii.
    useEffect(() => {
        // Daca nu sunt oaspete, nu am credite de afisat.
        if (!isGuestSession()) {
            setGuestCredits(null);
            return;
        }
        // Reincarc creditele de fiecare data cand se termina o generare (streamBusy se schimba), ca sa fie la zi.
        fetchGuestCredits().then(setGuestCredits).catch(() => setGuestCredits(null));
    }, [streamBusy]);

    /** Incarca setarile bibliotecii din localStorage la mount. */
    useEffect(() => {
        const s = loadLibraryUi();
        setFolders(s.folders);
        setBookFolderId(s.bookFolderId);
        setViewMode(s.viewMode);
        setSortKey(s.sortKey);
        setSortDir(s.sortDir);
        setNameFilter(s.nameFilter ?? "");
    }, []);

    /** Salveaza setarile bibliotecii in localStorage la fiecare schimbare. */
    useEffect(() => {
        saveLibraryUi({ folders, bookFolderId, viewMode, sortKey, sortDir, nameFilter });
    }, [folders, bookFolderId, viewMode, sortKey, sortDir, nameFilter]);

    /** Asculta evenimente flyout filtre din header (AppShell). */
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

    /** Reincarca lista dosare cand se creeaza unul nou din header. */
    useEffect(() => {
        const onFolders = () => {
            setFolders(loadLibraryUi().folders);
        };
        window.addEventListener(LIBRARY_FOLDERS_CHANGED_EVENT, onFolders);
        return () => window.removeEventListener(LIBRARY_FOLDERS_CHANGED_EVENT, onFolders);
    }, []);

    /** Sincronizeaza modul grid/list cu toggle-ul din header. */
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

    /** Asculta evenimente globale de la AppShell (modal URL, editor text, biblioteca). */
    useEffect(() => {
        const deschideFereastraUrl = () => {
            resetGenStreamUi();
            setIsModalOpen(true);
        };
        const deschideEcranText = () => {
            resetGenStreamUi();
            setDocumentExtractMeta(null);
            setEditorSourceName(null);
            setCarteaCurenta(null);
            setShowTextEditor(true);
        };
        const arataBiblioteca = () => {
            setCarteaCurenta(null);
            setShowTextEditor(false);
        };

        window.addEventListener("deschide-modal-url", deschideFereastraUrl);
        window.addEventListener("deschide-modal-text", deschideEcranText);
        window.addEventListener("arata-biblioteca", arataBiblioteca);

        return () => {
            window.removeEventListener("deschide-modal-url", deschideFereastraUrl);
            window.removeEventListener("deschide-modal-text", deschideEcranText);
            window.removeEventListener("arata-biblioteca", arataBiblioteca);
        };
    }, [resetGenStreamUi]);

    /** Redeschide ecranul de progres la click pe bara din header. */
    useEffect(() => {
        const onOpenProgress = () => openStreamProgressView();
        window.addEventListener(GENERATION_PROGRESS_VIEW_EVENT, onOpenProgress);
        if (consumePendingProgressView()) onOpenProgress();
        return () => window.removeEventListener(GENERATION_PROGRESS_VIEW_EVENT, onOpenProgress);
    }, [openStreamProgressView]);

    /** Preia text extras din upload document (flyout AppShell). */
    useEffect(() => {
        const onDocumentText = (e: Event) => {
            const ce = e as CustomEvent<{ titlu: string; text: string; extract_meta?: DocumentExtractMeta | null; filename?: string }>;
            if (!ce.detail?.text) return;
            resetGenStreamUi();
            setTitluText(ce.detail.titlu || t("home.defaultDocument"));
            setTextManual(ce.detail.text);
            setDocumentExtractMeta(ce.detail.extract_meta ?? null);
            setEditorSourceName(ce.detail.filename ?? null);
            setCarteaCurenta(null);
            setShowTextEditor(true);
            setIsModalOpen(false);
        };
        window.addEventListener("document-text-incarcat", onDocumentText);
        return () => window.removeEventListener("document-text-incarcat", onDocumentText);
    }, [resetGenStreamUi, t]);

    /**
     * Incarca istoricul cartilor (GET /istoric); serverul filtreaza dupa JWT.
     * Asculta eveniment reincarca-istoric dupa generari batch.
     */
    useEffect(() => {
        const fetchIstoric = async () => {
            try {
                const response = await fetch(`${getApiBase()}/istoric`, { headers: authHeadersJson() });
                if (response.status === 401) {
                    clearAuthSession();
                    router.replace("/login");
                    return;
                }
                const json = await response.json();
                if (json.status === "success" && json.data) {
                    // Transform fiecare carte din DB in forma de care are nevoie UI-ul (etichete de data, lungime text etc.).
                    const cartiFormatate = json.data.map((item: any) => {
                        const ts = item.creat_la ? new Date(item.creat_la).getTime() : 0;
                        const accessIso = item.ultima_accesare ?? null;
                        const txt = item.text_curatat ?? "";
                        return {
                            id: item.id,
                            titlu: item.titlu || t("home.untitledArticle"),
                            url_sursa: item.url,
                            status: t("home.statusComplete"),
                            link_audio: item.audio_link,
                            text_extras: item.text_curatat,
                            data_generare: formatBookCreatedLabel(item.creat_la, locale, t),
                            creat_la_ts: Number.isFinite(ts) ? ts : 0,
                            ultima_accesare: accessIso,
                            ultima_accesare_ts: bookAccessTimestamp(accessIso),
                            data_accesare: formatBookAccessLabel(accessIso, locale, t),
                            lungime_text: typeof txt === "string" ? txt.length : 0,
                        };
                    });
                    // Daca utilizatorul n-a inchis cartea de prezentare, o pun prima in lista (cu un timestamp urias ca sa stea sus).
                    const ws = getWelcomeState();
                    if (!ws.dismissed) {
                        const welcomeText = t("home.welcomeText");
                        cartiFormatate.unshift({
                            id: WELCOME_BOOK_ID,
                            titlu: ws.title || t("home.welcomeTitle"),
                            url_sursa: null,
                            status: t("home.statusComplete"),
                            link_audio: locale === "en" ? "/welcome-en.mp3" : "/welcome-ro.mp3",
                            text_extras: welcomeText,
                            data_generare: formatBookCreatedLabel(new Date().toISOString(), locale, t),
                            creat_la_ts: Number.MAX_SAFE_INTEGER,
                            ultima_accesare: null,
                            ultima_accesare_ts: 0,
                            data_accesare: formatBookAccessLabel(null, locale, t),
                            lungime_text: welcomeText.length,
                            is_welcome: true,
                        });
                    }
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

    /** Incarca segmentele playlist pentru cartea selectata din biblioteca. */
    useEffect(() => {
        if (!carteaCurenta?.id || carteaCurenta.is_welcome) {
            setLibSegments([]);
            return;
        }
        let cancelled = false;
        (async () => {
            const rows = await fetchCarteSegmente(Number(carteaCurenta.id));
            if (cancelled) return;
            const mode = (carteaCurenta.playlist_mode as PlaylistMode) || (rows.some((r) => r.chapter_index != null) ? "chapters" : "parts");
            setLibPlaylistMode(mode);
            setLibSegments(rows.length ? segmentsFromCarteDb(rows, mode) : []);
        })();
        return () => { cancelled = true; };
    }, [carteaCurenta?.id, carteaCurenta?.playlist_mode]);

    /** Incarca rezumatul din cache local cand se deschide o carte. */
    useEffect(() => {
        if (!carteaCurenta?.id || carteaCurenta.is_welcome) {
            setSummaryText(null);
            return;
        }
        setSummaryText(getStoredSummary(carteaCurenta.id));
    }, [carteaCurenta?.id, carteaCurenta?.is_welcome]);

    /** Anunta AppShell ca utilizatorul vizualizeaza o carte (pentru butonul din header). */
    useEffect(() => {
        window.dispatchEvent(
            new CustomEvent(LIBRARY_BOOK_VIEW_EVENT, { detail: { open: Boolean(carteaCurenta) } }),
        );
    }, [carteaCurenta]);

    // De aici incep handlerele (functiile chemate la actiunile utilizatorului), incepand cu generarea prin job-ul global.
    const handleTtsVoiceChange = (voiceId: string) => {
        // Cand schimba vocea: o tin in stare si o salvez in localStorage ca s-o regasesc data viitoare.
        setTtsVoice(voiceId);
        setStoredTtsVoice(voiceId);
    };

    /** POST /carti/{id}/rezumat — doar text, fara impact pe audio. */
    const handleGenereazaRezumat = useCallback(async () => {
        if (!carteaCurenta?.id || carteaCurenta.is_welcome || summaryLoading) return;
        setSummaryLoading(true);
        clearStoredSummary(carteaCurenta.id);
        setSummaryText(null);
        try {
            const rezumat = await fetchCarteRezumat(Number(carteaCurenta.id));
            setSummaryText(rezumat);
            setStoredSummary(carteaCurenta.id, rezumat);
        } catch (err) {
            const msg = err instanceof Error && err.message ? err.message : t("home.summaryError");
            showToast(msg, "error");
        } finally {
            setSummaryLoading(false);
        }
    }, [carteaCurenta, summaryLoading, t]);

    /** POST /extrage/stream: URL → extract + TTS cu playlist live. */
    const handleGenereaza = async () => {
        if (!url) {
            showToast(t("home.alertValidUrl"), "error");
            return;
        }
        if (!guardGenerationStart(t)) return;
        const ok = await runStreamExtrageUrl(
            { url, forceRegenerate, ttsVoice, label: url },
            t,
        );
        if (ok) {
            setIsModalOpen(false);
            setUrl("");
            window.dispatchEvent(new Event("reseteaza-meniu"));
        }
    };

    /** POST /genereaza_text/stream: curatare Gemini + TTS pe segmente + playlist live. */
    const handleGenereazaDinText = async () => {
        if (!titluText || !textManual) {
            showToast(t("home.alertTitleAndText"), "error");
            return;
        }
        if (!guardGenerationStart(t)) return;
        const charLen = textManual.trim().length;
        const ok = await runStreamGenereazaText(
            {
                titlu: titluText,
                text: textManual,
                curataCuGemini,
                ttsVoice,
                charLen,
                guestPreview: isGuestSession() && charLen > GUEST_PREVIEW_CHARS,
            },
            t,
        );
        if (ok) {
            setTitluText("");
            setTextManual("");
            setEditorSourceName(null);
            setShowTextEditor(false);
            window.dispatchEvent(new Event("reseteaza-meniu"));
        }
    };

    // Handlerele meniului contextual de pe fiecare card de carte (cele trei puncte).
    /** Deschid/inchid meniul "..." al unui card; tin doar unul deschis la un moment dat. */
    const toggleMeniu = (e: React.MouseEvent, id: number) => {
        // stopPropagation ca sa nu se inchida instant meniul din cauza click-ului global de "inchide la click in afara".
        e.stopPropagation();
        setMeniuDeschisId(meniuDeschisId === id ? null : id);
    };

    // Actiunile din meniul contextual: copiere link, descarcare, redenumire, stergere.
    const handleShare = (e: React.MouseEvent, link: string) => {
        // Copiez link-ul audio in clipboard si confirm printr-un toast.
        e.stopPropagation();
        navigator.clipboard.writeText(link);
        setMeniuDeschisId(null);
        showToast(t("home.linkCopied"), "success");
    };

    const handleDownload = async (e: React.MouseEvent, link: string, titlu: string) => {
        e.stopPropagation();
        setMeniuDeschisId(null);
        try {
            // Descarc fisierul ca blob si fortez download-ul cu un <a> ascuns, ca sa pot pune numele cartii.
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
            // Daca descarcarea cu blob nu merge (ex. CORS), deschid pur si simplu link-ul intr-un tab nou.
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
        // Cartea de prezentare e doar locala, deci ii salvez titlul in localStorage, nu pe server.
        if (carteDeRedenumit?.id === WELCOME_BOOK_ID) {
            const nou = titluNou.trim();
            setWelcomeTitle(nou);
            setIstoricCarti(istoricCarti.map((c) => c.id === WELCOME_BOOK_ID ? { ...c, titlu: nou } : c));
            setCarteaCurenta((prev: any) => prev && prev.id === WELCOME_BOOK_ID ? { ...prev, titlu: nou } : prev);
            setModalRedenumire(false);
            return;
        }
        try {
            await fetch(`${getApiBase()}/redenumeste/${carteDeRedenumit.id}`, {
                method: "PUT",
                headers: authHeadersJson(),
                body: JSON.stringify({ titlu_nou: titluNou }),
            });
            setIstoricCarti(istoricCarti.map((c) => c.id === carteDeRedenumit.id ? { ...c, titlu: titluNou } : c));
            setModalRedenumire(false);
        } catch {
            showToast(t("home.alertRenameError"), "error");
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
        // La fel ca la redenumire: cartea de prezentare o "sterg" doar local (o marchez ca inchisa).
        if (carteDeSters === WELCOME_BOOK_ID) {
            setWelcomeDismissed();
            setIstoricCarti(istoricCarti.filter((c) => c.id !== WELCOME_BOOK_ID));
            setCarteaCurenta((prev: any) => prev && prev.id === WELCOME_BOOK_ID ? null : prev);
            setModalStergere(false);
            setCarteDeSters(null);
            return;
        }
        try {
            await fetch(`${getApiBase()}/sterge/${carteDeSters}`, {
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
            showToast(t("home.alertDeleteError"), "error");
        }
    };

    /** Inchid meniul contextual cand utilizatorul da click oriunde in afara lui. */
    useEffect(() => {
        const handleClickOutside = () => setMeniuDeschisId(null);
        window.addEventListener("click", handleClickOutside);
        return () => window.removeEventListener("click", handleClickOutside);
    }, []);

    const deschideCarte = useCallback(
        (carte: { id: number | string; is_welcome?: boolean }) => {
            // Deschid cartea in ecranul de redare.
            setCarteaCurenta(carte);
            // Cartea de prezentare nu exista pe server, deci nu marchez accesul pentru ea.
            if (carte.id === WELCOME_BOOK_ID || carte.is_welcome) return;
            const id = Number(carte.id);
            if (!Number.isFinite(id)) return;
            // Anunt serverul ca am deschis-o (actualizeaza ultima_accesare) si apoi reflect noua data in UI.
            void touchCarteAccess(id).then((iso) => {
                if (!iso) return;
                const ts = bookAccessTimestamp(iso);
                const label = formatBookAccessLabel(iso, locale, t);
                const patch = {
                    ultima_accesare: iso,
                    ultima_accesare_ts: ts,
                    data_accesare: label,
                };
                setIstoricCarti((prev) => prev.map((c) => (c.id === carte.id ? { ...c, ...patch } : c)));
                setCarteaCurenta((prev: typeof carte | null) =>
                    prev && prev.id === carte.id ? { ...prev, ...patch } : prev,
                );
            });
        },
        [locale, t],
    );

    // Valori derivate (calculate din stare cu useMemo): lista filtrata si sortata + gruparea pe dosare.
    const cartiFiltrate = useMemo(() => {
        // Pornesc de la o copie a listei ca sa nu modific starea direct.
        let list = [...istoricCarti];
        // Aplic filtrul de cautare dupa titlu, daca exista.
        const q = nameFilter.trim().toLowerCase();
        if (q) list = list.filter((c) => (c.titlu || "").toLowerCase().includes(q));
        // dir = 1 pentru crescator, -1 pentru descrescator (inversez rezultatul comparatiei).
        const dir = sortDir === "asc" ? 1 : -1;
        list.sort((a, b) => {
            if (sortKey === "nume") {
                return dir * (a.titlu || "").localeCompare(b.titlu || "", locale === "en" ? "en" : "ro", { sensitivity: "base" });
            }
            if (sortKey === "dimensiune") {
                return dir * ((a.lungime_text || 0) - (b.lungime_text || 0));
            }
            if (sortKey === "acces") {
                return dir * ((a.ultima_accesare_ts || 0) - (b.ultima_accesare_ts || 0));
            }
            return dir * ((a.creat_la_ts || 0) - (b.creat_la_ts || 0));
        });
        return list;
    }, [istoricCarti, nameFilter, sortKey, sortDir, locale]);

    type CarteRow = (typeof istoricCarti)[number];

    /** Grupez cartile filtrate pe dosare, plus o sectiune "fara dosar" pentru restul. */
    const librarySections = useMemo(() => {
        const unfiledLabel = t("library.sectionUnfiled");
        // Aflu in ce dosar e o carte; daca dosarul a fost sters intre timp, o tratez ca fiind in radacina.
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

    // Handlerele pentru dosarele bibliotecii (creare/stergere/mutare carti).
    const stergeDosar = (e: React.MouseEvent, folderId: string) => {
        // Sterg dosarul din lista si scot maparea cartilor care erau in el (cartile raman, doar ies din dosar).
        e.stopPropagation();
        setFolders((prev) => prev.filter((f) => f.id !== folderId));
        setBookFolderId((prev) => removeBookAssignmentsForFolder(prev, folderId));
    };

    const mutaCarteInDosar = (carteId: number, folderId: string | null) => {
        // Mut cartea in dosarul ales (sau o scot din dosar daca folderId e null) si inchid meniurile.
        setBookFolderId((prev) => mapSetBookFolder(prev, carteId, folderId));
        setMutaCarteTarget(null);
        setMeniuDeschisId(null);
    };

    return (
        <div
            className={`relative flex h-full min-h-0 flex-col ${
                showTextEditor ? "p-2 lg:p-4" : "p-4 lg:p-8"
            }`}
        >

            {carteaCurenta ? (
                /* Ecranul de redare: aici afisez player-ul audio si textul extras al cartii deschise. */
                <div
                    className="w-full max-w-4xl mx-auto p-10 rounded-3xl mt-4"
                    style={{
                        animation: "fade-in 0.3s ease-out",
                        background: "var(--card-bg)",
                        boxShadow: "var(--shadow-card-lg)",
                        border: "1px solid var(--border-card)",
                    }}
                >
                    <div className="mb-8" style={{ borderBottom: "1px solid var(--divider)", paddingBottom: "1.5rem" }}>
                        <h2
                            className="text-3xl font-extrabold mb-2 leading-tight"
                            style={{ color: "var(--heading-on-surface)" }}
                        >
                            {carteaCurenta.titlu}
                        </h2>
                        {(() => {
                            if (carteaCurenta.is_welcome) return null;
                            const sursa = (carteaCurenta.url_sursa ?? "").trim();
                            const esteUrlWeb = /^https?:\/\//i.test(sursa);
                            if (esteUrlWeb) {
                                return (
                                    <a
                                        href={sursa}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-sm font-semibold inline-flex items-center transition-colors duration-150"
                                        style={{ color: "var(--link-accent)" }}
                                        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--heading-on-surface)")}
                                        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--link-accent)")}
                                    >
                                        {t("home.openOriginal")} <span className="ml-1 text-xs">↗</span>
                                    </a>
                                );
                            }
                            let eticheta: string;
                            if (sursa === t("home.manualSourceValue")) {
                                eticheta = t("home.sourceManual");
                            } else if (sursa === t("home.multiSourceValue")) {
                                eticheta = t("home.sourceMulti");
                            } else if (sursa) {
                                eticheta = `${t("home.sourcePrefix")}: ${sursa}`;
                            } else {
                                eticheta = t("home.sourceLibrary");
                            }
                            return (
                                <span className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                                    {eticheta}
                                </span>
                            );
                        })()}
                    </div>

                    <div
                        className="p-8 rounded-2xl mb-8"
                        style={{
                            background: "linear-gradient(135deg, var(--player-well-a) 0%, var(--player-well-b) 100%)",
                            boxShadow: "var(--shadow-player-inset)",
                            border: "1px solid var(--border-card)",
                        }}
                    >
                        <GenerationPlaylist
                            segments={libSegments}
                            phase={null}
                            segmentsTotal={libSegments.length}
                            playlistMode={libPlaylistMode}
                            activeIndex={genActiveSegment}
                            onActiveChange={setGenActiveSegment}
                            isGuestPreview={Boolean(carteaCurenta.is_guest_preview)}
                            onGuestPreviewFinished={() => setShowGuestSignupPrompt(true)}
                            fullAudioUrl={carteaCurenta.link_audio}
                            variant="library"
                        />
                    </div>

                    <div
                        className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3"
                        style={{
                            borderColor: readingFontOn ? "rgba(64,138,113,0.45)" : "var(--divider)",
                            background: readingFontOn ? "rgba(64,138,113,0.08)" : "var(--card-bg-muted)",
                        }}
                    >
                        <div className="min-w-0">
                            <p className="text-sm font-extrabold" style={{ color: "var(--heading-on-surface)" }}>
                                {t("readingFont.title")}
                            </p>
                            <p className="mt-0.5 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                                {t("readingFont.hint")}
                            </p>
                        </div>
                        <ReadingFontToggle />
                    </div>

                    {!carteaCurenta.is_welcome ? (
                        <div className="mb-8">
                            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <h3
                                        className="font-extrabold text-xs uppercase tracking-widest"
                                        style={{ color: "var(--text-muted)" }}
                                    >
                                        {t("home.summaryTitle")}
                                    </h3>
                                    <p className="mt-1 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                                        {t("home.summaryHint")}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void handleGenereazaRezumat()}
                                    disabled={summaryLoading}
                                    className="rounded-xl px-5 py-2.5 text-sm font-extrabold text-white transition-all duration-200 disabled:opacity-50"
                                    style={{
                                        background: "linear-gradient(135deg, #408A71, #285A48)",
                                        boxShadow: "var(--shadow-btn-sm)",
                                    }}
                                >
                                    {summaryLoading
                                        ? t("home.generating")
                                        : summaryText
                                          ? t("home.summaryRegenerate")
                                          : t("home.summaryGenerate")}
                                </button>
                            </div>
                            <div
                                className="p-6 rounded-2xl min-h-[6rem]"
                                style={{
                                    background: "var(--text-block-bg)",
                                    border: "1px solid var(--divider)",
                                }}
                            >
                                {summaryText ? (
                                    <p className={readingContentClass(readingFontOn)}>
                                        {summaryText}
                                    </p>
                                ) : (
                                    <p className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                                        {t("home.summaryEmpty")}
                                    </p>
                                )}
                            </div>
                        </div>
                    ) : null}

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
                            <p className={readingContentClass(readingFontOn)}>
                                {carteaCurenta.text_extras}
                            </p>
                        </div>
                    </div>
                </div>

            ) : showTextEditor ? (

                /* Ecranul editorului de text: scriu/lipesc text (sau il aduc dintr-un document) si pornesc generarea. */
                <div
                    className="mx-auto mt-1 flex min-h-0 w-full max-w-6xl flex-1 flex-col xl:max-w-7xl"
                    style={{ animation: "fade-in 0.3s ease-out" }}
                >
                    <div
                        className="flex min-h-0 flex-1 flex-col rounded-3xl p-5 lg:p-7"
                        style={{
                            background: "var(--card-bg)",
                            boxShadow: "var(--shadow-card-lg)",
                            border: "1px solid var(--border-card)",
                        }}
                    >
                        <input
                            type="text"
                            placeholder={t("home.materialTitlePlaceholder")}
                            lang={locale === "en" ? "en" : "ro"}
                            className="mb-3 w-full border-0 bg-transparent p-1 text-center text-xl font-extrabold placeholder-[var(--text-faint)]"
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

                        {documentExtractMeta ? (
                            <details
                                className="mb-3 rounded-xl border px-3 py-2 text-xs"
                                style={{ borderColor: "var(--divider)", background: "var(--card-bg-muted)" }}
                            >
                                <summary
                                    className="cursor-pointer list-none font-bold"
                                    style={{ color: "var(--text-muted)" }}
                                >
                                    {t("gen.extractPreviewTitle")}
                                    {documentExtractMeta.source_type
                                        ? ` · ${documentExtractMeta.source_type.toUpperCase()}`
                                        : ""}
                                    {documentExtractMeta.page_count != null
                                        ? ` · ${documentExtractMeta.pages_with_text ?? 0}/${documentExtractMeta.page_count} ${t("gen.extractPageStats").toLowerCase()}`
                                        : ""}
                                </summary>
                                <div className="mt-2 space-y-1.5" style={{ color: "var(--text-body)" }}>
                                    {(documentExtractMeta.pages_empty ?? 0) > 0 ? (
                                        <p style={{ color: "var(--text-muted)" }}>
                                            ⚠ {documentExtractMeta.pages_empty} {t("gen.extractEmptyPages")}
                                        </p>
                                    ) : null}
                                    {(documentExtractMeta.pages_ocr ?? 0) > 0 ? (
                                        <p style={{ color: "var(--text-muted)" }}>
                                            {documentExtractMeta.pages_ocr} {t("gen.extractOcrPages")}
                                        </p>
                                    ) : null}
                                    {documentExtractMeta.extract_preview ? (
                                        <p className="leading-relaxed" style={{ color: "var(--text-muted)" }}>
                                            <span className="font-semibold">{t("gen.extractStartsWith")}: </span>
                                            «{documentExtractMeta.extract_preview}»
                                        </p>
                                    ) : null}
                                </div>
                            </details>
                        ) : null}

                        <textarea
                            placeholder={t("home.textPlaceholder")}
                            lang={locale === "en" ? "en" : "ro"}
                            className="min-h-0 w-full flex-1 resize-none border-0 bg-transparent p-2 text-base leading-relaxed lg:text-lg"
                            style={{ color: "var(--text-body)", outline: "none" }}
                            value={textManual}
                            onChange={(e) => setTextManual(e.target.value)}
                        />

                        <div
                            className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t pt-3 text-[11px] font-semibold"
                            style={{ borderColor: "var(--divider)", color: "var(--text-muted)" }}
                        >
                            <span>
                                {t("home.charCount")}: {textManual.length}
                                {isGuestSession()
                                    ? ` / ${guestCredits?.credits_per_job_max ?? GUEST_JOB_MAX_CHARS}`
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
                            <p className="mt-1 text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
                                {t("gen.guestPreviewHint")}
                            </p>
                        ) : null}

                        <div
                            className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(220px,280px)] lg:items-stretch"
                        >
                            <div
                                className="rounded-2xl border p-4"
                                style={{
                                    borderColor: "var(--border-card)",
                                    background: "var(--card-bg-muted)",
                                }}
                            >
                                <TtsVoicePicker
                                    value={ttsVoice}
                                    onChange={handleTtsVoiceChange}
                                    disabled={streamBusy}
                                />
                            </div>

                            <label
                                className="flex cursor-pointer select-none items-start gap-3.5 rounded-2xl border-2 p-4 transition-colors duration-200"
                                style={{
                                    borderColor: curataCuGemini ? "#408A71" : "var(--border-card)",
                                    background: curataCuGemini
                                        ? "rgba(64,138,113,0.1)"
                                        : "var(--card-bg-muted)",
                                }}
                                onMouseEnter={(e) => {
                                    if (!curataCuGemini && !streamBusy) {
                                        e.currentTarget.style.borderColor = "rgba(64,138,113,0.45)";
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!curataCuGemini) {
                                        e.currentTarget.style.borderColor = "var(--border-card)";
                                    }
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={curataCuGemini}
                                    onChange={(e) => setCurataCuGemini(e.target.checked)}
                                    disabled={streamBusy}
                                    className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded accent-[#408A71] disabled:cursor-not-allowed disabled:opacity-50"
                                />
                                <span className="min-w-0">
                                    <span
                                        className="block text-sm font-extrabold leading-snug"
                                        style={{ color: "var(--heading-on-surface)" }}
                                    >
                                        {t("home.cleanWithAi")}
                                    </span>
                                    <span
                                        className="mt-1.5 block text-xs font-medium leading-relaxed"
                                        style={{ color: "var(--text-muted)" }}
                                    >
                                        {t("home.cleanWithAiHint")}
                                    </span>
                                </span>
                            </label>
                        </div>

                        {(streamBusy || genJob.segments.length > 0 || genJob.phase) ? (
                            <div className="mt-3 max-h-48 overflow-y-auto">
                                <GenerationPlaylist
                                    segments={genJob.segments}
                                    phase={genJob.phase}
                                    segmentsTotal={genJob.segmentsTotal}
                                    playlistMode={genJob.playlistMode}
                                    activeIndex={genActiveSegment}
                                    onActiveChange={setGenActiveSegment}
                                    isGuestPreview={genJob.isGuestPreview}
                                    onGuestPreviewFinished={() => setShowGuestSignupPrompt(true)}
                                />
                            </div>
                        ) : null}

                        <div className="mt-4 flex flex-wrap justify-center gap-3">
                            {(streamBusy || genJob.phase) ? (
                                <>
                                    <button
                                        type="button"
                                        onClick={cancelGeneration}
                                        className="rounded-full border-2 px-6 py-3 text-sm font-extrabold transition-all duration-200"
                                        style={{
                                            color: "var(--text-muted)",
                                            borderColor: "var(--divider)",
                                            background: "var(--card-bg)",
                                        }}
                                    >
                                        {t("gen.cancelGeneration")}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={minimizeStreamView}
                                        className="rounded-full border-2 px-6 py-3 text-sm font-extrabold transition-all duration-200"
                                        style={{
                                            color: "var(--heading-on-surface)",
                                            borderColor: "var(--input-border)",
                                            background: "var(--card-bg)",
                                        }}
                                    >
                                        {t("gen.continueInBackground")}
                                    </button>
                                </>
                            ) : null}
                            <button
                                onClick={handleGenereazaDinText}
                                disabled={streamBusy}
                                className="flex items-center rounded-full px-8 py-3 text-sm font-extrabold text-white transition-all duration-200 disabled:opacity-50"
                                style={{
                                    background: "linear-gradient(135deg, #408A71, #285A48)",
                                    boxShadow: "var(--shadow-btn-primary)",
                                }}
                            >
                                {streamBusy ? t("home.generating") : t("home.generateAudio")}
                            </button>
                        </div>
                    </div>
                </div>

            ) : (

                /* Ecranul bibliotecii: cartile afisate ca grid sau lista, grupate pe dosare. */
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
                                            <span className="shrink-0" style={{ color: "var(--heading-on-surface)" }} aria-hidden>
                                                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinejoin="round">
                                                    <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h3.88a1.5 1.5 0 0 1 1.06.44l1.12 1.12A1.5 1.5 0 0 0 12.62 7H18.5A1.5 1.5 0 0 1 20 8.5V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.5Z" />
                                                </svg>
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
                                        className={`rounded-2xl cursor-pointer group flex flex-col h-full relative overflow-visible ${
                                            meniuDeschisId === carte.id ? "z-30" : ""
                                        }`}
                                        style={{
                                            background: "var(--card-bg)",
                                            boxShadow: "var(--shadow-card-sm)",
                                            border: "1px solid var(--border-card)",
                                            transition: "transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease",
                                        }}
                                        onClick={() => deschideCarte(carte)}
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
                                        {/* Accent gradient sus la hover */}
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
                                            {/* Buton meniu kebab */}
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

                                            {/* Meniu dropdown actiuni carte */}
                                            {meniuDeschisId === carte.id && (
                                                <div
                                                    className="absolute top-11 right-3.5 rounded-xl py-1.5 w-48 z-50"
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
                                                        <span className="mr-3 opacity-60">▤</span>
                                                        {t("home.moveToFolder")}
                                                    </button>
                                                    <button
                                                        onClick={(e) => handleSterge(e, carte.id)}
                                                        className="w-full text-left px-4 py-2 text-sm font-medium flex items-center transition-colors duration-100"
                                                        style={{ color: "var(--text-body)" }}
                                                        onMouseEnter={(e) => {
                                                            e.currentTarget.style.backgroundColor = "var(--hover-bg)";
                                                            e.currentTarget.style.color = "#dc2626";
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

                                            {/* Iconita card */}
                                            <div
                                                className="w-11 h-11 rounded-xl flex items-center justify-center mb-4 text-lg transition-transform duration-200 group-hover:scale-110"
                                                style={{
                                                    background: "linear-gradient(135deg, rgba(176,228,204,0.5), rgba(176,228,204,0.2))",
                                                    boxShadow: "0 2px 8px rgba(64,138,113,0.15)",
                                                }}
                                            >
                                                🎧
                                            </div>

                                            {/* Titlu card */}
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

                                            {/* Sursa card */}
                                            <p
                                                className="text-xs font-medium mb-4 truncate flex-grow"
                                                style={{ color: "var(--text-muted)" }}
                                                title={carte.url_sursa}
                                            >
                                                {carte.url_sursa}
                                            </p>

                                            {/* Footer card: data si CTA asculta */}
                                            <div
                                                className="flex justify-between items-end gap-2 text-xs font-bold mt-auto pt-4"
                                                style={{
                                                    borderTop: "1px solid var(--divider)",
                                                    color: "var(--link-accent)",
                                                }}
                                            >
                                                <div className="flex min-w-0 flex-col gap-0.5">
                                                    <span className="truncate">{carte.data_accesare}</span>
                                                    <span
                                                        className="truncate text-[10px] font-semibold"
                                                        style={{ color: "var(--text-muted)" }}
                                                    >
                                                        {carte.data_generare}
                                                    </span>
                                                </div>
                                                <span
                                                    className="flex shrink-0 items-center transition-all duration-150 group-hover:translate-x-0.5"
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
                                        className={`rounded-2xl cursor-pointer group flex flex-row items-center gap-3 w-full relative overflow-visible py-3 pl-3 pr-3 sm:pl-4 sm:pr-4 ${
                                            meniuDeschisId === carte.id ? "z-30" : ""
                                        }`}
                                        style={{
                                            background: "var(--card-bg)",
                                            boxShadow: "var(--shadow-card-sm)",
                                            border: "1px solid var(--border-card)",
                                            transition: "border-color 0.2s ease",
                                        }}
                                        onClick={() => deschideCarte(carte)}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.borderColor = "rgba(176,228,204,0.5)";
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.borderColor = "var(--border-card)";
                                        }}
                                    >
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
                                                className="absolute top-11 right-2 rounded-xl py-1.5 w-48 z-50"
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
                                                    <span className="mr-3 opacity-60">▤</span>
                                                    {t("home.moveToFolder")}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(e) => handleSterge(e, carte.id)}
                                                    className="w-full text-left px-4 py-2 text-sm font-medium flex items-center transition-colors duration-100"
                                                    style={{ color: "var(--text-body)" }}
                                                    onMouseEnter={(e) => {
                                                        e.currentTarget.style.backgroundColor = "var(--hover-bg)";
                                                        e.currentTarget.style.color = "#dc2626";
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
                                            className="text-right text-[11px] sm:text-xs font-bold shrink-0 hidden sm:flex flex-col gap-0.5 self-center"
                                            style={{ color: "var(--link-accent)" }}
                                        >
                                            <span>{carte.data_accesare}</span>
                                            <span className="text-[10px] font-semibold" style={{ color: "var(--text-muted)" }}>
                                                {carte.data_generare}
                                            </span>
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

            {/* Modalul de URL: aici lipesc un link web ca sa extrag textul si sa generez audio din el. */}
            {isModalOpen && (
                <div
                    className="fixed inset-0 flex items-center justify-center z-50 p-4"
                    style={{
                        background: "var(--overlay-scrim)",
                        backdropFilter: "blur(6px)",
                        animation: "fade-in 0.2s ease-out",
                    }}
                    onClick={(e) => {
                        if (e.target === e.currentTarget && streamBusy) minimizeStreamView();
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
                            readOnly={streamBusy}
                        />

                        <TtsVoicePicker
                            value={ttsVoice}
                            onChange={handleTtsVoiceChange}
                            disabled={streamBusy}
                            compact
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

                        {(streamBusy || genJob.segments.length > 0 || genJob.phase) ? (
                            <GenerationPlaylist
                                segments={genJob.segments}
                                phase={genJob.phase}
                                segmentsTotal={genJob.segmentsTotal}
                                playlistMode={genJob.playlistMode}
                                activeIndex={genActiveSegment}
                                onActiveChange={setGenActiveSegment}
                                isGuestPreview={genJob.isGuestPreview}
                                onGuestPreviewFinished={() => setShowGuestSignupPrompt(true)}
                            />
                        ) : null}

                        {streamBusy ? (
                            <p className="mb-4 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                                {t("gen.backgroundHint")}
                            </p>
                        ) : null}

                        <div className="flex flex-wrap justify-end gap-3">
                            <button
                                onClick={() => {
                                    if (streamBusy) {
                                        void cancelGeneration();
                                        return;
                                    }
                                    setIsModalOpen(false);
                                    resetGenStreamUi();
                                }}
                                className="px-6 py-3 font-bold rounded-xl text-sm transition-colors duration-150"
                                style={{ color: "var(--text-muted)" }}
                                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--hover-bg)")}
                                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                            >
                                {streamBusy ? t("gen.cancelGeneration") : t("library.modalCancel")}
                            </button>
                            {streamBusy ? (
                                <button
                                    type="button"
                                    onClick={minimizeStreamView}
                                    className="px-6 py-3 font-bold rounded-xl text-sm transition-colors duration-150"
                                    style={{ color: "var(--heading-on-surface)" }}
                                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--hover-bg)")}
                                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                                >
                                    {t("gen.continueInBackground")}
                                </button>
                            ) : null}
                            <button
                                onClick={handleGenereaza}
                                disabled={streamBusy}
                                className="px-8 py-3 text-white font-extrabold text-sm rounded-xl flex items-center disabled:opacity-50 transition-all duration-200"
                                style={{
                                    background: "linear-gradient(135deg, #408A71, #285A48)",
                                    boxShadow: "var(--shadow-btn-primary)",
                                }}
                                onMouseEnter={(e) => {
                                    if (!streamBusy) e.currentTarget.style.boxShadow = "var(--shadow-btn-primary-hover)";
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.boxShadow = "var(--shadow-btn-primary)";
                                }}
                            >
                                {streamBusy ? t("home.aiReading") : t("home.generateAudioShort")}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modalul de redenumire a unei carti. */}
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

            {/* Modalul de confirmare a stergerii unei carti. */}
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

            {/* Modalul prin care mut o carte intr-un dosar. */}
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
                                    className="w-full flex items-center gap-2.5 text-left px-4 py-3 rounded-xl text-sm font-bold transition-colors duration-150"
                                    style={{
                                        border: "2px solid var(--input-border)",
                                        background: "var(--card-bg-muted)",
                                        color: "var(--text-body)",
                                    }}
                                >
                                    <svg className="h-4 w-4 shrink-0" style={{ color: "var(--heading-on-surface)" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinejoin="round" aria-hidden>
                                        <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h3.88a1.5 1.5 0 0 1 1.06.44l1.12 1.12A1.5 1.5 0 0 0 12.62 7H18.5A1.5 1.5 0 0 1 20 8.5V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.5Z" />
                                    </svg>
                                    {fd.name}
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
            {/* Invitatia de a-ti face cont, aratata oaspetelui dupa ce a ascultat preview-ul. */}
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
