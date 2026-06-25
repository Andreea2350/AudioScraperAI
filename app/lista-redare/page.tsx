"use client";

/**
 * Lista de redare: adaugi URL-uri sau fisiere, extragi text (POST /extrage_fisier), apoi generezi audio
 * in ordinea randurilor. Drag-and-drop reordoneaza; fiecare rand are propriul status in UI.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE, authHeadersMultipart, isGuestSession } from "@/lib/api";
import { DOCUMENT_FILE_ACCEPT, IMAGE_FILE_ACCEPT } from "@/lib/fileUploadAccept";
import { useI18n } from "@/lib/i18n";
import { showToast } from "@/lib/toast";
import { confirmDialog } from "@/lib/confirm";
import { TtsVoicePicker } from "@/components/TtsVoicePicker";
import { getStoredTtsVoice, setStoredTtsVoice } from "@/lib/ttsVoiceStorage";
import {
    cancelActiveGenerationJob,
    guardGenerationStart,
    isGenerationBusy,
    registerPlaylistBatchCallbacks,
    runPlaylistCombined,
    runPlaylistSeparate,
    useGenerationJob,
    type PlaylistItemStatus,
} from "@/lib/generationJob";

export type { PlaylistItemStatus };

/** Tip sursa: link web sau document incarcat. */
export type PlaylistSourceKind = "url" | "document";

/** Rand din coada playlist-ului batch. */
export type PlaylistItem = {
    id: string;
    sourceKind: PlaylistSourceKind;
    label: string;
    url?: string;
    titlu?: string;
    filename?: string;
    extractedText?: string;
    status: PlaylistItemStatus;
    errorMessage?: string;
};

/** Titlu sugerat pentru modul „o singură carte” (varianta C hibrid). */
function buildSuggestedCombinedTitle(
    items: PlaylistItem[],
    suffix: string,
    fallback: string,
): string {
    const withContent = items.filter(
        (it) =>
            (it.sourceKind === "url" && it.url) ||
            (it.sourceKind === "document" && it.extractedText),
    );
    if (withContent.length === 0) return "";
    const firstTitle = (withContent[0].titlu || withContent[0].label || "").trim();
    if (withContent.length === 1) return firstTitle;
    if (firstTitle) return `${firstTitle} ${suffix}`;
    return `${fallback} (${withContent.length})`;
}

/** Genereaza ID unic pentru rand nou (crypto.randomUUID sau fallback). */
function newId() {
    return typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `pl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function ListaRedarePage() {
    const { t } = useI18n();

    /** Etichete traduse pentru statusul fiecarui rand din playlist. */
    const statusLabels = useMemo(
        (): Record<PlaylistItemStatus, string> => ({
            pregatit: t("playlist.statusReady"),
            asteptare: t("playlist.statusWaiting"),
            extragere: t("playlist.statusExtracting"),
            generare: t("playlist.statusGenerating"),
            gata: t("playlist.statusDone"),
            eroare: t("playlist.statusError"),
        }),
        [t],
    );

    // Stare pentru randurile din coada, modalul de URL, drag-and-drop si modul de generare in lot (batch).
    const [items, setItems] = useState<PlaylistItem[]>([]);     // randurile din playlist
    const [urlInput, setUrlInput] = useState("");               // textul din input-ul de URL
    const [urlModalOpen, setUrlModalOpen] = useState(false);    // e deschis modalul de adaugare link?
    const [dragId, setDragId] = useState<string | null>(null);  // id-ul randului care e tras acum (drag)
    const [guestLockedMsg, setGuestLockedMsg] = useState<string | null>(null);  // mesaj cand un oaspete incearca ceva blocat
    const [ttsVoice, setTtsVoice] = useState(() => getStoredTtsVoice());  // vocea aleasa (initial cea salvata)
    const [combinedMode, setCombinedMode] = useState(false);    // false = cate o carte per sursa; true = totul intr-una singura
    const [combinedTitle, setCombinedTitle] = useState("");     // titlul cartii combinate
    const [combinedTitleTouched, setCombinedTitleTouched] = useState(false);  // a editat userul titlul manual? (ca sa nu-l mai suprascriu automat)
    const isGuest = isGuestSession();  // sesiune de oaspete? (lista de redare e blocata pentru ei)
    const genJob = useGenerationJob();  // ma abonez la jobul global de generare
    // Ruleaza chiar acum un lot din lista de redare (separat sau combinat)?
    const batchRunning =
        genJob.busy &&
        (genJob.kind === "playlist-separate" || genJob.kind === "playlist-combined");
    const docRef = useRef<HTMLInputElement>(null);  // input ascuns pentru documente
    const imgRef = useRef<HTMLInputElement>(null);  // input ascuns pentru imagini

    // Inregistrez callback-uri prin care jobul global imi spune cand se schimba statusul unui rand sau cand se anuleaza lotul.
    useEffect(() => {
        registerPlaylistBatchCallbacks({
            // Cand un rand isi schimba statusul (ex. "generare" -> "gata"), il actualizez in lista.
            onItemStatus: (id, status, errorMessage) => {
                setItems((prev) =>
                    prev.map((it) =>
                        it.id === id ? { ...it, status, errorMessage } : it,
                    ),
                );
            },
            // La anulare, readuc la "pregatit" randurile care erau in lucru, ca sa le pot relua.
            onBatchCancelled: () => {
                setItems((prev) =>
                    prev.map((it) =>
                        it.status === "generare" || it.status === "extragere"
                            ? { ...it, status: "pregatit", errorMessage: undefined }
                            : it,
                    ),
                );
            },
        });
        // La demontare scot callback-urile ca sa nu ramana legate de o pagina care nu mai exista.
        return () => registerPlaylistBatchCallbacks(null);
    }, []);

    const suggestedCombinedTitle = useMemo(
        () =>
            buildSuggestedCombinedTitle(
                items,
                t("playlist.combinedTitleSuffix"),
                t("playlist.combinedTitleFallback"),
            ),
        [items, t],
    );

    // Cat timp suntem in modul combinat si userul n-a scris manual titlul, il completez automat cu sugestia.
    useEffect(() => {
        if (!combinedMode || combinedTitleTouched) return;
        setCombinedTitle(suggestedCombinedTitle);
    }, [combinedMode, suggestedCombinedTitle, combinedTitleTouched]);

    const showGuestSourceLocked = useCallback(() => {
        setGuestLockedMsg(t("shell.playlistGuestLocked"));
    }, [t]);

    const cancelBatch = useCallback(async () => {
        // Cer confirmare inainte sa opresc lotul, ca sa nu se intample din greseala.
        const ok = await confirmDialog({ message: t("gen.cancelConfirm"), title: t("gen.cancelGeneration") });
        if (!ok) return;
        await cancelActiveGenerationJob();
    }, [t]);

    // De aici incep handlerele de adaugare a surselor (link sau fisier) in coada.
    /** Validez URL-ul si adaug un rand nou in coada. */
    const addUrl = () => {
        // Oaspetii nu pot folosi lista de redare.
        if (isGuest) {
            showGuestSourceLocked();
            return;
        }
        const u = urlInput.trim();
        if (!u) return;
        try {
            /**
             * Folosim constructorul URL strict ca validator;
             * eslint se plange de "new pentru side effect" fara variabila.
             */
            // eslint-disable-next-line no-new
            new URL(u);
        } catch {
            showToast(t("playlist.invalidUrl"), "error");
            return;
        }
        // Adaug randul cu eticheta scurtata (daca link-ul e prea lung) si statusul initial "pregatit".
        setItems((prev) => [
            ...prev,
            {
                id: newId(),
                sourceKind: "url",
                label: u.length > 64 ? `${u.slice(0, 61)}…` : u,
                url: u,
                status: "pregatit",
            },
        ]);
        setUrlInput("");
        setUrlModalOpen(false);
    };

    /** POST /extrage_fisier: extrage text din document sau imagine. */
    const extractFile = useCallback(async (file: File) => {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`${API_BASE}/extrage_fisier`, {
            method: "POST",
            headers: authHeadersMultipart(),
            body: fd,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(typeof data.detail === "string" ? data.detail : t("playlist.fileReadError"));
        }
        if (data.status !== "success" || !data.text) {
            throw new Error(t("playlist.invalidResponse"));
        }
        return {
            titlu: (data.titlu_sugerat as string) || file.name.replace(/\.[^/.]+$/, ""),
            text: data.text as string,
        };
    }, [t]);

    /** Adaug fisierul in lista cu status "extragere", apoi ii extrag textul si actualizez randul cand e gata. */
    const onPickFile = async (file: File | undefined) => {
        if (!file) return;
        if (isGuest) {
            showGuestSourceLocked();
            return;
        }
        setGuestLockedMsg(null);
        // Adaug randul imediat (cu status "extragere") ca utilizatorul sa vada ca lucrez la el.
        const id = newId();
        setItems((prev) => [
            ...prev,
            {
                id,
                sourceKind: "document",
                label: file.name,
                filename: file.name,
                status: "extragere",
            },
        ]);
        try {
            const { titlu, text } = await extractFile(file);
            setItems((prev) =>
                prev.map((it) =>
                    it.id === id
                        ? {
                              ...it,
                              titlu,
                              extractedText: text,
                              label: titlu,
                              status: "pregatit",
                          }
                        : it,
                ),
            );
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Eroare";
            setItems((prev) =>
                prev.map((it) =>
                    it.id === id ? { ...it, status: "eroare", errorMessage: msg } : it,
                ),
            );
        }
    };

    // De aici incep handlerele de reordonare si stergere a randurilor.
    const removeItem = (id: string) => {
        // Scot randul cu id-ul dat din lista.
        setItems((prev) => prev.filter((x) => x.id !== id));
    };

    const moveItem = (id: string, dir: -1 | 1) => {
        // Mut randul cu o pozitie in sus (dir -1) sau in jos (dir +1), interschimband cu vecinul.
        setItems((prev) => {
            const i = prev.findIndex((x) => x.id === id);
            const j = i + dir;
            // Daca as iesi din lista (primul rand in sus / ultimul in jos), nu fac nimic.
            if (i < 0 || j < 0 || j >= prev.length) return prev;
            const next = [...prev];
            [next[i], next[j]] = [next[j], next[i]];
            return next;
        });
    };

    /** Handlere drag-and-drop pentru reordonare randuri. */
    const onDragStart = (id: string) => setDragId(id);
    const onDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };
    const onDropRow = (targetId: string) => {
        // Daca n-am nimic in mana sau dau drumul peste acelasi rand, doar resetez.
        if (!dragId || dragId === targetId) {
            setDragId(null);
            return;
        }
        // Scot randul tras din pozitia lui si il insert pe pozitia randului-tinta.
        setItems((prev) => {
            const i = prev.findIndex((x) => x.id === dragId);
            const j = prev.findIndex((x) => x.id === targetId);
            if (i < 0 || j < 0) return prev;
            const next = [...prev];
            const [row] = next.splice(i, 1);
            next.splice(j, 0, row);
            return next;
        });
        setDragId(null);
    };

    const runBatch = async () => {
        // Iau in lucru doar randurile pregatite sau cele care au dat eroare (ca sa le reincerc).
        const queue = items.filter((it) => it.status === "pregatit" || it.status === "eroare");
        if (queue.length === 0) {
            showToast(t("playlist.nothingToGenerate"), "error");
            return;
        }
        // guardGenerationStart blocheaza daca ruleaza deja altceva.
        if (!guardGenerationStart(t)) return;

        // In modul combinat fac o singura carte (cu titlu obligatoriu); altfel cate o carte per sursa.
        if (combinedMode) {
            const title = combinedTitle.trim();
            if (!title) {
                showToast(t("playlist.combinedTitleRequired"), "error");
                return;
            }
            await runPlaylistCombined(queue, title, ttsVoice, t);
        } else {
            await runPlaylistSeparate(queue, ttsVoice, t);
        }
    };

    // Cate randuri sunt gata de generat (folosit si pe butonul de generare).
    const readyCount = items.filter((it) => it.status === "pregatit" || it.status === "eroare").length;
    // Pot genera daca am randuri pregatite, (in mod combinat) am titlu si nu ruleaza deja altceva.
    const canGenerate =
        readyCount > 0 &&
        (!combinedMode || combinedTitle.trim().length > 0) &&
        !isGenerationBusy();

    return (
        <div className="p-4 lg:p-8 max-w-4xl mx-auto pb-24">
            {/* Antet pagina lista de redare */}
            <div className="mb-8">
                <h1 className="text-3xl font-extrabold tracking-tight mb-2" style={{ color: "var(--heading-on-surface)" }}>
                    {t("playlist.title")}
                </h1>
                <p className="text-sm font-medium leading-relaxed" style={{ color: "var(--text-muted)" }}>
                    {t("playlist.subtitle")}
                </p>
            </div>

            <div className="mb-6 max-w-md">
                <TtsVoicePicker
                    value={ttsVoice}
                    onChange={(id) => {
                        setTtsVoice(id);
                        setStoredTtsVoice(id);
                    }}
                    disabled={batchRunning}
                    compact
                />
            </div>

            {/* Butoane adaugare sursa: link, document, imagine */}
            <div className="flex flex-wrap gap-3 mb-6">
                <button
                    type="button"
                    onClick={() => {
                        if (isGuest) {
                            showGuestSourceLocked();
                            return;
                        }
                        setGuestLockedMsg(null);
                        setUrlModalOpen(true);
                    }}
                    disabled={batchRunning}
                    title={isGuest ? t("shell.playlistGuestLockedTitle") : undefined}
                    className={`px-4 py-2.5 rounded-xl text-sm font-extrabold disabled:opacity-50 flex items-center gap-2 ${
                        isGuest
                            ? "border-2 border-[var(--border-card)] cursor-not-allowed opacity-70 font-bold"
                            : "text-white"
                    }`}
                    style={{
                        background: isGuest ? "var(--card-bg)" : "linear-gradient(135deg, #408A71, #285A48)",
                        boxShadow: isGuest ? "none" : "var(--shadow-btn-sm)",
                        color: isGuest ? "var(--text-muted)" : undefined,
                    }}
                >
                    {t("playlist.addWebLink")}
                    {isGuest ? <span className="text-sm leading-none opacity-60" aria-hidden>🔒</span> : null}
                </button>
                <button
                    type="button"
                    onClick={() => {
                        if (isGuest) {
                            showGuestSourceLocked();
                            return;
                        }
                        setGuestLockedMsg(null);
                        docRef.current?.click();
                    }}
                    disabled={batchRunning}
                    title={isGuest ? t("shell.playlistGuestLockedTitle") : undefined}
                    className={`px-4 py-2.5 rounded-xl text-sm font-bold border-2 disabled:opacity-50 flex items-center gap-2 ${
                        isGuest
                            ? "border-[var(--border-card)] cursor-not-allowed opacity-70"
                            : "border-mid-green text-mid-green hover:bg-surface-green/50"
                    }`}
                    style={{ background: "var(--card-bg)", color: isGuest ? "var(--text-muted)" : undefined }}
                >
                    {t("playlist.addDocument")}
                    {isGuest ? <span className="text-sm leading-none opacity-60" aria-hidden>🔒</span> : null}
                </button>
                <button
                    type="button"
                    onClick={() => {
                        if (isGuest) {
                            showGuestSourceLocked();
                            return;
                        }
                        setGuestLockedMsg(null);
                        imgRef.current?.click();
                    }}
                    disabled={batchRunning}
                    title={isGuest ? t("shell.playlistGuestLockedTitle") : undefined}
                    className={`px-4 py-2.5 rounded-xl text-sm font-bold border-2 disabled:opacity-50 flex items-center gap-2 ${
                        isGuest
                            ? "border-[var(--border-card)] cursor-not-allowed opacity-70"
                            : "border-ocean text-ocean hover:bg-ocean-light/30"
                    }`}
                    style={{ background: "var(--card-bg)", color: isGuest ? "var(--text-muted)" : undefined }}
                >
                    {t("playlist.addImage")}
                    {isGuest ? <span className="text-sm leading-none opacity-60" aria-hidden>🔒</span> : null}
                </button>
                {guestLockedMsg ? (
                    <p className="w-full text-xs font-medium px-1" style={{ color: "#C4933F" }}>
                        {guestLockedMsg}
                    </p>
                ) : null}
                <input
                    ref={docRef}
                    type="file"
                    className="hidden"
                    suppressHydrationWarning
                    accept={DOCUMENT_FILE_ACCEPT}
                    onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        void onPickFile(f);
                    }}
                />
                <input
                    ref={imgRef}
                    type="file"
                    className="hidden"
                    suppressHydrationWarning
                    accept={IMAGE_FILE_ACCEPT}
                    onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        void onPickFile(f);
                    }}
                />
            </div>

            {/* Lista randuri sau stare goala */}
            {items.length === 0 ? (
                <div
                    className="rounded-2xl p-12 text-center border border-dashed"
                    style={{ borderColor: "var(--border-card)", background: "var(--card-bg-muted)" }}
                >
                    <div className="text-4xl mb-4 opacity-40">📋</div>
                    <p className="font-bold" style={{ color: "var(--text-body)" }}>{t("playlist.emptyTitle")}</p>
                    <p className="text-sm mt-2" style={{ color: "var(--text-muted)" }}>{t("playlist.emptyHint")}</p>
                </div>
            ) : (
                <ul className="space-y-2">
                    {items.map((it, idx) => (
                        <li
                            key={it.id}
                            draggable={!batchRunning}
                            onDragStart={() => onDragStart(it.id)}
                            onDragOver={onDragOver}
                            onDrop={() => onDropRow(it.id)}
                            className="flex items-stretch gap-2 rounded-xl border overflow-hidden"
                            style={{
                                background: "var(--card-bg)",
                                borderColor: "var(--border-card)",
                                boxShadow: "var(--shadow-card-sm)",
                                opacity: dragId === it.id ? 0.65 : 1,
                            }}
                        >
                            <div
                                className="flex items-center px-2 cursor-grab active:cursor-grabbing hover:text-mid-green shrink-0"
                                style={{ color: "var(--text-faint)" }}
                                title={t("playlist.dragHint")}
                            >
                                ⋮⋮
                            </div>
                            <div className="flex-1 py-3 pr-2 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <span className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                                            {it.sourceKind === "url" ? t("playlist.rowLink") : t("playlist.rowDocument")}
                                        </span>
                                        <p className="font-bold text-sm truncate" style={{ color: "var(--text-primary)" }}>{it.label}</p>
                                        {it.errorMessage && (
                                            <p className="text-xs mt-1" style={{ color: "#b04060" }}>
                                                {it.errorMessage}
                                            </p>
                                        )}
                                    </div>
                                    <span
                                        className="shrink-0 text-[10px] font-extrabold uppercase px-2 py-1 rounded-lg"
                                        style={{
                                            background:
                                                it.status === "gata"
                                                    ? "rgba(64,138,113,0.12)"
                                                    : it.status === "eroare"
                                                      ? "rgba(194,91,111,0.1)"
                                                      : it.status === "generare" || it.status === "extragere"
                                                        ? "rgba(58,143,181,0.12)"
                                                        : "var(--hover-bg)",
                                            color:
                                                it.status === "gata"
                                                    ? "#408A71"
                                                    : it.status === "eroare"
                                                      ? "#b04060"
                                                      : "#3A8FB5",
                                        }}
                                    >
                                        {statusLabels[it.status]}
                                    </span>
                                </div>
                            </div>
                            <div className="flex flex-col border-l" style={{ borderColor: "var(--divider)" }}>
                                <button
                                    type="button"
                                    disabled={batchRunning || idx === 0}
                                    onClick={() => moveItem(it.id, -1)}
                                    className="px-2 py-1 text-xs font-bold disabled:opacity-30"
                                    style={{ color: "var(--text-muted)" }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = "var(--hover-bg)";
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = "transparent";
                                    }}
                                >
                                    ↑
                                </button>
                                <button
                                    type="button"
                                    disabled={batchRunning || idx === items.length - 1}
                                    onClick={() => moveItem(it.id, 1)}
                                    className="px-2 py-1 text-xs font-bold disabled:opacity-30"
                                    style={{ color: "var(--text-muted)" }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = "var(--hover-bg)";
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = "transparent";
                                    }}
                                >
                                    ↓
                                </button>
                                <button
                                    type="button"
                                    disabled={batchRunning}
                                    onClick={() => removeItem(it.id)}
                                    className="px-2 py-2 text-xs font-bold disabled:opacity-30"
                                    style={{ color: "#C25B6F" }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = "var(--hover-bg)";
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = "transparent";
                                    }}
                                >
                                    ✕
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {items.length > 0 && (
                <div
                    className="mt-6 rounded-2xl border p-5"
                    style={{
                        background: "var(--card-bg)",
                        borderColor: "var(--border-card)",
                        boxShadow: "var(--shadow-card-sm)",
                    }}
                >
                    <p
                        className="text-[10px] font-extrabold uppercase tracking-wider mb-3"
                        style={{ color: "var(--text-muted)" }}
                    >
                        {t("playlist.outputModeLabel")}
                    </p>
                    <div className="flex flex-wrap gap-2 mb-3">
                        <button
                            type="button"
                            disabled={batchRunning}
                            onClick={() => setCombinedMode(false)}
                            className="px-4 py-2 rounded-xl text-sm font-bold border-2 transition-colors disabled:opacity-50"
                            style={{
                                borderColor: !combinedMode ? "#408A71" : "var(--border-card)",
                                background: !combinedMode ? "rgba(64,138,113,0.12)" : "var(--card-bg)",
                                color: !combinedMode ? "#408A71" : "var(--text-muted)",
                            }}
                        >
                            {t("playlist.outputModeSeparate")}
                        </button>
                        <button
                            type="button"
                            disabled={batchRunning}
                            onClick={() => {
                                setCombinedMode(true);
                                setCombinedTitleTouched(false);
                            }}
                            className="px-4 py-2 rounded-xl text-sm font-bold border-2 transition-colors disabled:opacity-50"
                            style={{
                                borderColor: combinedMode ? "#408A71" : "var(--border-card)",
                                background: combinedMode ? "rgba(64,138,113,0.12)" : "var(--card-bg)",
                                color: combinedMode ? "#408A71" : "var(--text-muted)",
                            }}
                        >
                            {t("playlist.outputModeCombined")}
                        </button>
                    </div>
                    <p className="text-xs font-medium mb-4 leading-relaxed" style={{ color: "var(--text-muted)" }}>
                        {combinedMode ? t("playlist.outputModeHintCombined") : t("playlist.outputModeHintSeparate")}
                    </p>
                    {combinedMode ? (
                        <div>
                            <label
                                className="block text-xs font-extrabold uppercase tracking-wider mb-2"
                                style={{ color: "var(--text-muted)" }}
                                htmlFor="combined-title"
                            >
                                {t("playlist.combinedTitleLabel")}
                            </label>
                            <input
                                id="combined-title"
                                type="text"
                                value={combinedTitle}
                                onChange={(e) => {
                                    setCombinedTitleTouched(true);
                                    setCombinedTitle(e.target.value);
                                }}
                                placeholder={t("playlist.combinedTitlePlaceholder")}
                                disabled={batchRunning}
                                className="w-full rounded-xl p-3 text-sm border-2"
                                style={{
                                    borderColor: "var(--input-border)",
                                    background: "var(--input-bg)",
                                    color: "var(--text-body)",
                                }}
                            />
                        </div>
                    ) : null}
                </div>
            )}

            {/* Buton fix jos: genereaza batch pentru randurile pregatite */}
            {items.length > 0 && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 lg:left-[calc(50%+8rem)] z-40 flex gap-3">
                    {batchRunning ? (
                        <button
                            type="button"
                            onClick={cancelBatch}
                            className="px-8 py-4 rounded-full font-extrabold text-sm shadow-lg"
                            style={{
                                color: "var(--text-muted)",
                                border: "2px solid var(--divider)",
                                background: "var(--card-bg)",
                            }}
                        >
                            {t("gen.cancelGeneration")}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        disabled={batchRunning || !canGenerate}
                        onClick={() => void runBatch()}
                        className="px-8 py-4 rounded-full font-extrabold text-sm text-white shadow-lg disabled:opacity-50"
                        style={{
                            background: "linear-gradient(135deg, #285A48, #1a3d2f)",
                            boxShadow: "var(--shadow-btn-primary)",
                        }}
                    >
                        {batchRunning ? t("playlist.processing") : `${t("playlist.generate")} (${readyCount})`}
                    </button>
                </div>
            )}

            {/* Modal adaugare link web */}
            {urlModalOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    style={{ background: "var(--overlay-scrim)", backdropFilter: "blur(6px)" }}
                    onClick={() => setUrlModalOpen(false)}
                >
                    <div
                        className="rounded-3xl p-8 w-full max-w-md shadow-2xl"
                        style={{ background: "var(--card-bg)" }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h2 className="text-xl font-extrabold mb-4" style={{ color: "var(--heading-on-surface)" }}>
                            Adaugă link
                        </h2>
                        <input
                            type="url"
                            placeholder="https://…"
                            value={urlInput}
                            onChange={(e) => setUrlInput(e.target.value)}
                            className="w-full rounded-xl p-4 mb-4 text-sm border-2"
                            style={{
                                borderColor: "var(--input-border)",
                                background: "var(--input-bg)",
                                color: "var(--text-body)",
                            }}
                            autoFocus
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setUrlModalOpen(false)}
                                className="px-4 py-2 text-sm font-bold"
                                style={{ color: "var(--text-muted)" }}
                            >
                                Anulează
                            </button>
                            <button
                                type="button"
                                onClick={addUrl}
                                className="px-6 py-2 rounded-xl text-sm font-extrabold text-white"
                                style={{ background: "linear-gradient(135deg, #408A71, #285A48)" }}
                            >
                                Adaugă
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
