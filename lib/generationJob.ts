"use client";

/**
 * Job global unic de generare audio: ruleaza independent de pagina curenta,
 * expune progres pentru bara globala si playlist live (SSE).
 */
import { useSyncExternalStore } from "react";
import {
    API_BASE,
    authHeadersJson,
    cancelGenerationJob,
    isAbortError,
    streamExtrageUrl,
    streamGenereazaText,
    type GenerationSegment,
    type GenerationStreamEvent,
    type PlaylistMode,
} from "@/lib/api";
import { showToast } from "@/lib/toast";
import type { MessageKey } from "@/lib/i18n";

export type GenerationJobKind = "stream" | "playlist-separate" | "playlist-combined" | null;

export type PlaylistQueueItem = {
    id: string;
    sourceKind: "url" | "document";
    label: string;
    url?: string;
    titlu?: string;
    filename?: string;
    extractedText?: string;
};

export type PlaylistItemStatus =
    | "pregatit"
    | "asteptare"
    | "extragere"
    | "generare"
    | "gata"
    | "eroare";

export type GenerationJobState = {
    busy: boolean;
    kind: GenerationJobKind;
    label: string;
    batchCurrent: number;
    batchTotal: number;
    phase: string | null;
    segments: GenerationSegment[];
    segmentsTotal: number | null;
    playlistMode: PlaylistMode;
    isGuestPreview: boolean;
    /** Pentru redeschiderea ecranului de progres (URL vs editor text). */
    streamOrigin: "url" | "text" | null;
};

type TranslateFn = (key: MessageKey) => string;

type PlaylistBatchCallbacks = {
    onItemStatus: (id: string, status: PlaylistItemStatus, errorMessage?: string) => void;
    onBatchCancelled?: () => void;
};

const idleState: GenerationJobState = {
    busy: false,
    kind: null,
    label: "",
    batchCurrent: 0,
    batchTotal: 0,
    phase: null,
    segments: [],
    segmentsTotal: null,
    playlistMode: "parts",
    isGuestPreview: false,
    streamOrigin: null,
};

export const GENERATION_PROGRESS_VIEW_EVENT = "deschide-generare-activa";

let pendingProgressView = false;

export function requestGenerationProgressView(): void {
    if (typeof window === "undefined") return;
    pendingProgressView = true;
    window.dispatchEvent(new Event(GENERATION_PROGRESS_VIEW_EVENT));
}

export function consumePendingProgressView(): boolean {
    if (!pendingProgressView) return false;
    pendingProgressView = false;
    return true;
}

let state: GenerationJobState = { ...idleState };
const listeners = new Set<() => void>();

let abortRef: AbortController | null = null;
let serverJobId: string | null = null;
let playlistCallbacks: PlaylistBatchCallbacks | null = null;

function emit() {
    listeners.forEach((l) => l());
}

function patch(partial: Partial<GenerationJobState>) {
    state = { ...state, ...partial };
    emit();
}

function resetState() {
    state = { ...idleState };
    abortRef = null;
    serverJobId = null;
    emit();
}

export function getGenerationJobState(): GenerationJobState {
    return state;
}

export function subscribeGenerationJob(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function useGenerationJob(): GenerationJobState {
    return useSyncExternalStore(subscribeGenerationJob, getGenerationJobState, () => idleState);
}

export function isGenerationBusy(): boolean {
    return state.busy;
}

export function registerPlaylistBatchCallbacks(cb: PlaylistBatchCallbacks | null): void {
    playlistCallbacks = cb;
}

function notifyItem(id: string, status: PlaylistItemStatus, errorMessage?: string) {
    playlistCallbacks?.onItemStatus(id, status, errorMessage);
}

/** Porneste un job nou; returneaza false daca exista deja unul activ. */
export function acquireGenerationJob(
    kind: NonNullable<GenerationJobKind>,
    label: string,
    extra?: Partial<GenerationJobState>,
): boolean {
    if (state.busy) return false;
    abortRef?.abort();
    abortRef = new AbortController();
    serverJobId = null;
    patch({
        busy: true,
        kind,
        label,
        batchCurrent: 0,
        batchTotal: 0,
        phase: null,
        segments: [],
        segmentsTotal: null,
        playlistMode: "parts",
        isGuestPreview: false,
        ...extra,
    });
    return true;
}

export async function cancelActiveGenerationJob(): Promise<void> {
    const jobId = serverJobId;
    serverJobId = null;
    if (jobId) {
        void cancelGenerationJob(jobId).catch(() => {});
    }
    abortRef?.abort();
    abortRef = null;
    playlistCallbacks?.onBatchCancelled?.();
    resetState();
}

function applyStreamEvent(evt: GenerationStreamEvent, t: TranslateFn): "done" | "error" | null {
    if (evt.type === "job") {
        serverJobId = evt.job_id;
        return null;
    }
    if (evt.type === "cancelled") return null;
    if (evt.type === "playlist_mode") {
        patch({ playlistMode: evt.mode });
        return null;
    }
    if (evt.type === "preview") {
        patch({ isGuestPreview: true });
        return null;
    }
    if (evt.type === "phase") {
        patch({
            phase: evt.phase,
            segmentsTotal: evt.segments_total ?? state.segmentsTotal,
        });
        return null;
    }
    if (evt.type === "segment") {
        const prev = getGenerationJobState().segments;
        patch({
            phase: "tts",
            segments: [...prev.filter((s) => s.index !== evt.index), evt].sort((a, b) => a.index - b.index),
        });
        return null;
    }
    if (evt.type === "done") {
        return "done";
    }
    if (evt.type === "error") {
        const msg = typeof evt.detail === "string" ? evt.detail : t("home.alertGenerateError");
        showToast(msg, "error");
        return "error";
    }
    return null;
}

function finishSuccess(t: TranslateFn) {
    showToast(t("gen.bookReady"), "success");
    window.dispatchEvent(new Event("reincarca-istoric"));
    resetState();
}

/** SSE: URL → audiobook */
export async function runStreamExtrageUrl(
    params: {
        url: string;
        forceRegenerate: boolean;
        ttsVoice: string;
        label: string;
    },
    t: TranslateFn,
): Promise<boolean> {
    if (!acquireGenerationJob("stream", params.label, { phase: "extracting", streamOrigin: "url" })) return false;
    const signal = abortRef!.signal;
    try {
        const donePayload = await streamExtrageUrl(
            { url: params.url, force_regenerate: params.forceRegenerate, tts_voice: params.ttsVoice },
            (evt) => {
                applyStreamEvent(evt, t);
            },
            signal,
        );
        if (!donePayload) {
            showToast(t("home.alertUrlError"), "error");
            resetState();
            return false;
        }
        if (donePayload.from_cache) {
            finishSuccess(t);
            return true;
        }
        finishSuccess(t);
        return true;
    } catch (err) {
        if (!isAbortError(err)) {
            const msg = err instanceof Error && err.message ? err.message : t("home.alertServerError");
            showToast(msg, "error");
        }
        resetState();
        return false;
    }
}

/** SSE: text manual / document din editor */
export async function runStreamGenereazaText(
    params: {
        titlu: string;
        text: string;
        curataCuGemini: boolean;
        ttsVoice: string;
        charLen: number;
        guestPreview: boolean;
    },
    t: TranslateFn,
): Promise<boolean> {
    const phase = params.curataCuGemini ? "cleaning" : "tts";
    const segmentsTotal = params.curataCuGemini
        ? null
        : Math.max(1, Math.ceil(params.charLen / 2800));
    if (
        !acquireGenerationJob("stream", params.titlu, {
            phase,
            segmentsTotal,
            playlistMode: params.charLen >= 50000 ? "chapters" : "parts",
            isGuestPreview: params.guestPreview,
            streamOrigin: "text",
        })
    ) {
        return false;
    }
    const signal = abortRef!.signal;
    try {
        const donePayload = await streamGenereazaText(
            {
                titlu: params.titlu,
                text: params.text,
                curata_cu_gemini: params.curataCuGemini,
                tts_voice: params.ttsVoice,
            },
            (evt) => {
                applyStreamEvent(evt, t);
            },
            signal,
        );
        if (!donePayload) {
            showToast(t("home.alertTextGenerateError"), "error");
            resetState();
            return false;
        }
        finishSuccess(t);
        return true;
    } catch (err) {
        if (!isAbortError(err)) {
            const msg = err instanceof Error && err.message ? err.message : t("home.alertTextGenerateError");
            showToast(msg, "error");
        }
        resetState();
        return false;
    }
}

/** Lista de redare: câte o carte per sursă */
export async function runPlaylistSeparate(
    queue: PlaylistQueueItem[],
    ttsVoice: string,
    t: TranslateFn,
): Promise<boolean> {
    if (queue.length === 0) return false;
    if (
        !acquireGenerationJob("playlist-separate", queue[0].label, {
            batchCurrent: 0,
            batchTotal: queue.length,
        })
    ) {
        return false;
    }
    const ac = abortRef!;
    let index = 0;
    for (const q of queue) {
        if (ac.signal.aborted) break;
        index += 1;
        patch({ batchCurrent: index, label: q.titlu || q.label });
        notifyItem(q.id, "generare");
        try {
            if (q.sourceKind === "url" && q.url) {
                const res = await fetch(`${API_BASE}/extrage`, {
                    method: "POST",
                    headers: authHeadersJson(),
                    body: JSON.stringify({ url: q.url, force_regenerate: false, tts_voice: ttsVoice }),
                    signal: ac.signal,
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(typeof data.detail === "string" ? data.detail : "Eroare URL");
                }
                if (data.status === "Eroare") {
                    throw new Error(data.detalii || data.message || "Eroare");
                }
            } else if (q.sourceKind === "document" && q.titlu && q.extractedText) {
                const res = await fetch(`${API_BASE}/genereaza_text`, {
                    method: "POST",
                    headers: authHeadersJson(),
                    body: JSON.stringify({
                        titlu: q.titlu,
                        text: q.extractedText,
                        tts_voice: ttsVoice,
                        source_label: q.filename || q.label,
                    }),
                    signal: ac.signal,
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(typeof data.detail === "string" ? data.detail : "Eroare generare");
                }
                if (data.status === "error") {
                    throw new Error(data.message || "Eroare");
                }
            } else {
                throw new Error(t("playlist.incompleteItem"));
            }
            notifyItem(q.id, "gata");
        } catch (e) {
            if (isAbortError(e)) {
                notifyItem(q.id, "pregatit");
                break;
            }
            const msg = e instanceof Error ? e.message : t("playlist.unknownError");
            notifyItem(q.id, "eroare", msg);
        }
    }
    if (!ac.signal.aborted) {
        finishSuccess(t);
    } else {
        resetState();
    }
    return true;
}

/** Lista de redare: o singură carte combinată */
export async function runPlaylistCombined(
    queue: PlaylistQueueItem[],
    combinedTitle: string,
    ttsVoice: string,
    t: TranslateFn,
): Promise<boolean> {
    if (queue.length === 0) return false;
    if (
        !acquireGenerationJob("playlist-combined", combinedTitle, {
            batchCurrent: 0,
            batchTotal: queue.length,
            phase: "extracting",
        })
    ) {
        return false;
    }
    const ac = abortRef!;
    const parts: { id: string; titlu: string; text: string }[] = [];
    let failed = 0;
    let step = 0;

    for (const q of queue) {
        if (ac.signal.aborted) break;
        step += 1;
        patch({
            batchCurrent: step,
            batchTotal: queue.length,
            label: q.titlu || q.label,
            phase: "extracting",
        });

        if (q.sourceKind === "url" && q.url) {
            notifyItem(q.id, "extragere");
            try {
                const res = await fetch(`${API_BASE}/extrage_url_text`, {
                    method: "POST",
                    headers: authHeadersJson(),
                    body: JSON.stringify({ url: q.url }),
                    signal: ac.signal,
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(typeof data.detail === "string" ? data.detail : "Eroare URL");
                }
                if (!data.text) throw new Error(t("playlist.invalidResponse"));
                const titluExtras = (data.titlu as string) || q.label;
                parts.push({ id: q.id, titlu: titluExtras, text: data.text as string });
                notifyItem(q.id, "pregatit");
            } catch (e) {
                if (isAbortError(e)) {
                    notifyItem(q.id, "pregatit");
                    break;
                }
                failed += 1;
                const msg = e instanceof Error ? e.message : t("playlist.unknownError");
                notifyItem(q.id, "eroare", msg);
            }
        } else if (q.sourceKind === "document" && q.extractedText) {
            parts.push({
                id: q.id,
                titlu: q.titlu || q.filename || q.label,
                text: q.extractedText,
            });
        } else {
            failed += 1;
            notifyItem(q.id, "eroare", t("playlist.incompleteItem"));
        }
    }

    if (ac.signal.aborted) {
        resetState();
        return false;
    }
    if (parts.length === 0) {
        showToast(t("playlist.combinedNothingExtracted"), "error");
        resetState();
        return false;
    }

    const combinedText =
        parts.length === 1
            ? parts[0].text
            : parts.map((p) => `\n\n--- ${p.titlu} ---\n\n${p.text}`).join("");

    const partIds = new Set(parts.map((p) => p.id));
    for (const id of partIds) notifyItem(id, "generare");
    patch({ phase: "tts", label: combinedTitle });

    try {
        const res = await fetch(`${API_BASE}/genereaza_text`, {
            method: "POST",
            headers: authHeadersJson(),
            body: JSON.stringify({
                titlu: combinedTitle,
                text: combinedText,
                curata_cu_gemini: true,
                tts_voice: ttsVoice,
                source_label: t("home.multiSourceValue"),
            }),
            signal: ac.signal,
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(typeof data.detail === "string" ? data.detail : t("playlist.combinedGenerateError"));
        }
        if (data.status === "error") {
            throw new Error(data.message || t("playlist.combinedGenerateError"));
        }
        for (const id of partIds) notifyItem(id, "gata");
        if (failed > 0) {
            const msg = t("playlist.partialSourcesIncluded")
                .replace("{included}", String(parts.length))
                .replace("{total}", String(queue.length));
            showToast(msg, "info");
        }
        finishSuccess(t);
        return true;
    } catch (e) {
        if (isAbortError(e)) {
            for (const id of partIds) notifyItem(id, "pregatit");
        } else {
            const msg = e instanceof Error ? e.message : t("playlist.combinedGenerateError");
            for (const id of partIds) notifyItem(id, "eroare", msg);
            showToast(msg, "error");
        }
        resetState();
        return false;
    }
}

/** Helper: refuză pornirea dacă există job activ. */
export function guardGenerationStart(t: TranslateFn): boolean {
    if (!isGenerationBusy()) return true;
    showToast(t("gen.alreadyRunning"), "info");
    return false;
}
