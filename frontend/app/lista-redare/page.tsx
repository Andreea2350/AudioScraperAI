"use client";

/**
 * Lista de redare: adaugi URL-uri sau fisiere, extragi text (POST /extrage_fisier), apoi generezi audio
 * in ordinea randurilor. Drag-and-drop reordoneaza; fiecare rand are propriul status in UI.
 */
import { useCallback, useRef, useState } from "react";
import { API_BASE, authHeadersJson, authHeadersMultipart } from "@/lib/api";
import { DOCUMENT_FILE_ACCEPT, IMAGE_FILE_ACCEPT } from "@/lib/fileUploadAccept";

export type PlaylistItemStatus =
    | "pregatit"
    | "asteptare"
    | "extragere"
    | "generare"
    | "gata"
    | "eroare";

export type PlaylistSourceKind = "url" | "document";

export type PlaylistItem = {
    id: string;
    sourceKind: PlaylistSourceKind;
    label: string;
    url?: string;
    titlu?: string;
    extractedText?: string;
    status: PlaylistItemStatus;
    errorMessage?: string;
};

function newId() {
    return typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `pl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const statusLabel: Record<PlaylistItemStatus, string> = {
    pregatit: "Pregătit",
    asteptare: "În așteptare",
    extragere: "Extrage text…",
    generare: "Generează audio…",
    gata: "Finalizat",
    eroare: "Eroare",
};

export default function ListaRedarePage() {
    const [items, setItems] = useState<PlaylistItem[]>([]);
    const [urlInput, setUrlInput] = useState("");
    const [urlModalOpen, setUrlModalOpen] = useState(false);
    const [batchRunning, setBatchRunning] = useState(false);
    const [dragId, setDragId] = useState<string | null>(null);
    const docRef = useRef<HTMLInputElement>(null);
    const imgRef = useRef<HTMLInputElement>(null);

    const addUrl = () => {
        const u = urlInput.trim();
        if (!u) return;
        try {
            // Folosim constructorul URL strict ca validator; eslint se plange de "new pentru side effect" fara variabila.
            // eslint-disable-next-line no-new
            new URL(u);
        } catch {
            alert("Introduceți un URL valid (https://…)");
            return;
        }
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
            throw new Error(typeof data.detail === "string" ? data.detail : "Nu s-a putut citi fișierul.");
        }
        if (data.status !== "success" || !data.text) {
            throw new Error("Răspuns invalid de la server.");
        }
        return {
            titlu: (data.titlu_sugerat as string) || file.name.replace(/\.[^/.]+$/, ""),
            text: data.text as string,
        };
    }, []);

    const onPickFile = async (file: File | undefined) => {
        if (!file) return;
        const id = newId();
        setItems((prev) => [
            ...prev,
            {
                id,
                sourceKind: "document",
                label: file.name,
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

    const removeItem = (id: string) => {
        setItems((prev) => prev.filter((x) => x.id !== id));
    };

    const moveItem = (id: string, dir: -1 | 1) => {
        setItems((prev) => {
            const i = prev.findIndex((x) => x.id === id);
            const j = i + dir;
            if (i < 0 || j < 0 || j >= prev.length) return prev;
            const next = [...prev];
            [next[i], next[j]] = [next[j], next[i]];
            return next;
        });
    };

    const onDragStart = (id: string) => setDragId(id);
    const onDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };
    const onDropRow = (targetId: string) => {
        if (!dragId || dragId === targetId) {
            setDragId(null);
            return;
        }
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
        const queue = items.filter(
            (it) =>
                it.status === "pregatit" ||
                it.status === "eroare",
        );
        if (queue.length === 0) {
            alert("Nu există elemente de generat. Adaugă surse sau corectează erorile.");
            return;
        }
        setBatchRunning(true);
        for (const q of queue) {
            setItems((prev) =>
                prev.map((it) =>
                    it.id === q.id ? { ...it, status: "generare", errorMessage: undefined } : it,
                ),
            );
            try {
                if (q.sourceKind === "url" && q.url) {
                    const res = await fetch(`${API_BASE}/extrage`, {
                        method: "POST",
                        headers: authHeadersJson(),
                        body: JSON.stringify({ url: q.url, force_regenerate: false }),
                    });
                    const data = await res.json();
                    if (!res.ok) {
                        throw new Error(
                            typeof data.detail === "string" ? data.detail : "Eroare la extragere URL",
                        );
                    }
                    if (data.status === "Eroare") {
                        throw new Error(data.detalii || data.message || "Eroare la procesare");
                    }
                } else if (q.sourceKind === "document" && q.titlu && q.extractedText) {
                    const res = await fetch(`${API_BASE}/genereaza_text`, {
                        method: "POST",
                        headers: authHeadersJson(),
                        body: JSON.stringify({ titlu: q.titlu, text: q.extractedText }),
                    });
                    const data = await res.json();
                    if (!res.ok) {
                        throw new Error(
                            typeof data.detail === "string" ? data.detail : "Eroare la generare",
                        );
                    }
                    if (data.status === "error") {
                        throw new Error(data.message || "Eroare");
                    }
                } else {
                    throw new Error("Element incomplet (lipsește textul sau URL-ul).");
                }
                setItems((prev) =>
                    prev.map((it) => (it.id === q.id ? { ...it, status: "gata" } : it)),
                );
            } catch (e) {
                const msg = e instanceof Error ? e.message : "Eroare necunoscută";
                setItems((prev) =>
                    prev.map((it) =>
                        it.id === q.id ? { ...it, status: "eroare", errorMessage: msg } : it,
                    ),
                );
            }
        }
        setBatchRunning(false);
        window.dispatchEvent(new Event("reincarca-istoric"));
    };

    const readyCount = items.filter((it) => it.status === "pregatit" || it.status === "eroare").length;

    return (
        <div className="p-4 lg:p-8 max-w-4xl mx-auto pb-24">
            <div className="mb-8">
                <h1 className="text-3xl font-extrabold tracking-tight mb-2" style={{ color: "var(--heading-on-surface)" }}>
                    Lista de redare
                </h1>
                <p className="text-sm font-medium leading-relaxed" style={{ color: "var(--text-muted)" }}>
                    Adaugă linkuri, documente (PDF, DOCX, TXT) sau imagini. Ordinea din listă este ordinea în care se
                    generează audio-ul — trage rândurile sau folosește săgețile.
                </p>
            </div>

            <div className="flex flex-wrap gap-3 mb-6">
                <button
                    type="button"
                    onClick={() => setUrlModalOpen(true)}
                    disabled={batchRunning}
                    className="px-4 py-2.5 rounded-xl text-sm font-extrabold text-white disabled:opacity-50"
                    style={{
                        background: "linear-gradient(135deg, #408A71, #285A48)",
                        boxShadow: "var(--shadow-btn-sm)",
                    }}
                >
                    + Link web
                </button>
                <button
                    type="button"
                    onClick={() => docRef.current?.click()}
                    disabled={batchRunning}
                    className="px-4 py-2.5 rounded-xl text-sm font-bold border-2 border-mid-green text-mid-green hover:bg-surface-green/50 disabled:opacity-50"
                    style={{ background: "var(--card-bg)" }}
                >
                    + Document
                </button>
                <button
                    type="button"
                    onClick={() => imgRef.current?.click()}
                    disabled={batchRunning}
                    className="px-4 py-2.5 rounded-xl text-sm font-bold border-2 border-ocean text-ocean hover:bg-ocean-light/30 disabled:opacity-50"
                    style={{ background: "var(--card-bg)" }}
                >
                    + Imagine
                </button>
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

            {items.length === 0 ? (
                <div
                    className="rounded-2xl p-12 text-center border border-dashed"
                    style={{ borderColor: "var(--border-card)", background: "var(--card-bg-muted)" }}
                >
                    <div className="text-4xl mb-4 opacity-40">📋</div>
                    <p className="font-bold" style={{ color: "var(--text-body)" }}>Lista este goală</p>
                    <p className="text-sm mt-2" style={{ color: "var(--text-muted)" }}>Adaugă surse cu butoanele de mai sus.</p>
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
                                title="Trage pentru a reordona"
                            >
                                ⋮⋮
                            </div>
                            <div className="flex-1 py-3 pr-2 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <span className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                                            {it.sourceKind === "url" ? "Link" : "Document"}
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
                                        {statusLabel[it.status]}
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
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 lg:left-[calc(50%+8rem)] z-40">
                    <button
                        type="button"
                        disabled={batchRunning || readyCount === 0}
                        onClick={() => void runBatch()}
                        className="px-8 py-4 rounded-full font-extrabold text-sm text-white shadow-lg disabled:opacity-50"
                        style={{
                            background: "linear-gradient(135deg, #285A48, #1a3d2f)",
                            boxShadow: "var(--shadow-btn-primary)",
                        }}
                    >
                        {batchRunning ? "Se procesează…" : `▶ Generează audio (${readyCount})`}
                    </button>
                </div>
            )}

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
