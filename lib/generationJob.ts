"use client";

/**
 * Aici gestionez generarea audio pe partea de frontend. E un singur job global care ruleaza
 * independent de pagina pe care ma aflu: pot porni o generare, sa navighez prin aplicatie, iar
 * bara de progres globala si playlistul live continua sa se actualizeze. Tin starea intr-un store
 * propriu (cu subscribers) ca s-o pot afisa din orice componenta.
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

// Ce fel de job ruleaza acum: o generare simpla (stream), o lista de redare cu carti separate,
// o lista combinata intr-o singura carte, sau nimic (null).
export type GenerationJobKind = "stream" | "playlist-separate" | "playlist-combined" | null;

// Un element din coada listei de redare: poate veni dintr-un URL sau dintr-un document deja extras.
export type PlaylistQueueItem = {
    id: string;
    sourceKind: "url" | "document";
    label: string;
    url?: string;
    titlu?: string;
    filename?: string;
    extractedText?: string;
};

// Statusurile prin care trece un element din lista de redare (le afisez langa fiecare sursa).
export type PlaylistItemStatus =
    | "pregatit"
    | "asteptare"
    | "extragere"
    | "generare"
    | "gata"
    | "eroare";

// Toata starea jobului global de generare, exact ce vede UI-ul.
export type GenerationJobState = {
    busy: boolean;                  // ruleaza ceva acum?
    kind: GenerationJobKind;        // ce fel de job
    label: string;                  // ce afisez ca titlu in bara de progres
    batchCurrent: number;           // la a cata sursa sunt (pentru liste)
    batchTotal: number;             // cate surse sunt in total
    phase: string | null;           // etapa curenta (extragere/curatare/tts)
    segments: GenerationSegment[];  // segmentele aparute pana acum
    segmentsTotal: number | null;   // cate segmente se asteapta in total
    playlistMode: PlaylistMode;     // parti vs capitole
    isGuestPreview: boolean;        // e doar un preview de oaspete (text taiat)?
    /** Imi spune de unde a pornit stream-ul (URL sau editor de text), ca sa pot redeschide ecranul corect. */
    streamOrigin: "url" | "text" | null;
};

// Functia de traducere primita din componente (i18n), ca sa pot afisa mesaje in limba aleasa.
type TranslateFn = (key: MessageKey) => string;

// Callback-uri prin care anunt pagina de lista de redare ce status are fiecare element.
type PlaylistBatchCallbacks = {
    onItemStatus: (id: string, status: PlaylistItemStatus, errorMessage?: string) => void;
    onBatchCancelled?: () => void;
};

// Starea "de repaus": cum arata totul cand nu ruleaza niciun job.
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

// Numele evenimentului pe fereastra prin care cer deschiderea ecranului de progres din alta parte a aplicatiei.
export const GENERATION_PROGRESS_VIEW_EVENT = "deschide-generare-activa";

// Flag care retine ca cineva a cerut deschiderea ecranului de progres (consumat o singura data).
let pendingProgressView = false;

export function requestGenerationProgressView(): void {
    // Cer afisarea ecranului de progres: ridic flag-ul si emit un eveniment pe fereastra.
    if (typeof window === "undefined") return;
    pendingProgressView = true;
    window.dispatchEvent(new Event(GENERATION_PROGRESS_VIEW_EVENT));
}

export function consumePendingProgressView(): boolean {
    // Verific (o singura data) daca s-a cerut deschiderea ecranului si resetez flag-ul.
    if (!pendingProgressView) return false;
    pendingProgressView = false;
    return true;
}

// Starea curenta a jobului si lista de ascultatori care vor sa fie notificati la schimbari.
let state: GenerationJobState = { ...idleState };
const listeners = new Set<() => void>();

// Referinte interne: controllerul de anulare, id-ul jobului de pe server si callback-urile listei de redare.
let abortRef: AbortController | null = null;
let serverJobId: string | null = null;
let playlistCallbacks: PlaylistBatchCallbacks | null = null;

function emit() {
    // Anunt toti ascultatorii ca starea s-a schimbat (asa se re-randeaza componentele).
    listeners.forEach((l) => l());
}

function patch(partial: Partial<GenerationJobState>) {
    // Actualizez doar campurile date, pastrez restul, apoi notific.
    state = { ...state, ...partial };
    emit();
}

function resetState() {
    // Revin la starea de repaus si curat referintele de job.
    state = { ...idleState };
    abortRef = null;
    serverJobId = null;
    emit();
}

export function getGenerationJobState(): GenerationJobState {
    // Intorc starea curenta (folosit de useSyncExternalStore).
    return state;
}

export function subscribeGenerationJob(listener: () => void): () => void {
    // Inregistrez un ascultator si intorc functia de dezabonare.
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function useGenerationJob(): GenerationJobState {
    // Hook-ul prin care componentele React se aboneaza la starea jobului global.
    // Al treilea argument (() => idleState) e starea folosita pe server, unde nu exista store-ul live.
    return useSyncExternalStore(subscribeGenerationJob, getGenerationJobState, () => idleState);
}

export function isGenerationBusy(): boolean {
    // Ruleaza acum un job?
    return state.busy;
}

export function registerPlaylistBatchCallbacks(cb: PlaylistBatchCallbacks | null): void {
    // Pagina de lista de redare isi inregistreaza aici callback-urile de status.
    playlistCallbacks = cb;
}

function notifyItem(id: string, status: PlaylistItemStatus, errorMessage?: string) {
    // Scurtatura sigura ca sa anunt statusul unui element (daca exista callback-uri).
    playlistCallbacks?.onItemStatus(id, status, errorMessage);
}

/** Pornesc un job nou. Intorc false daca exista deja unul activ (nu pornesc doua deodata). */
export function acquireGenerationJob(
    kind: NonNullable<GenerationJobKind>,
    label: string,
    extra?: Partial<GenerationJobState>,
): boolean {
    // Daca deja ruleaza ceva, refuz pornirea.
    if (state.busy) return false;
    // Anulez orice controller vechi si fac unul nou pentru jobul asta.
    abortRef?.abort();
    abortRef = new AbortController();
    serverJobId = null;
    // Setez starea de start (cu posibilitatea de a o ajusta prin "extra").
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
    // Anulez jobul curent: intai pe server (sterge fisierele partiale), apoi local.
    const jobId = serverJobId;
    serverJobId = null;
    if (jobId) {
        // Trimit cererea de anulare, dar nu ma blochez si ignor eventualele erori.
        void cancelGenerationJob(jobId).catch(() => {});
    }
    // Abort pe fetch-ul SSE, ca sa se opreasca citirea stream-ului.
    abortRef?.abort();
    abortRef = null;
    // Anunt lista de redare ca s-a anulat tot.
    playlistCallbacks?.onBatchCancelled?.();
    resetState();
}

function applyStreamEvent(evt: GenerationStreamEvent, t: TranslateFn): "done" | "error" | null {
    // Traduc fiecare eveniment SSE intr-o actualizare de stare. Intorc "done"/"error" cand jobul se termina.
    if (evt.type === "job") {
        // Primul eveniment imi da id-ul jobului de pe server (necesar la anulare).
        serverJobId = evt.job_id;
        return null;
    }
    if (evt.type === "cancelled") return null;
    if (evt.type === "playlist_mode") {
        // Aflu daca e playlist pe parti sau pe capitole.
        patch({ playlistMode: evt.mode });
        return null;
    }
    if (evt.type === "preview") {
        // E un preview de oaspete (textul a fost taiat).
        patch({ isGuestPreview: true });
        return null;
    }
    if (evt.type === "phase") {
        // Schimbare de etapa; actualizez si totalul de segmente daca a venit.
        patch({
            phase: evt.phase,
            segmentsTotal: evt.segments_total ?? state.segmentsTotal,
        });
        return null;
    }
    if (evt.type === "segment") {
        // A venit un segment: il adaug (sau il inlocuiesc daca exista deja acelasi index) si tin lista sortata.
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
        // Eroare: aleg mesajul (string sau cel generic tradus) si il afisez ca toast.
        const msg = typeof evt.detail === "string" ? evt.detail : t("home.alertGenerateError");
        showToast(msg, "error");
        return "error";
    }
    return null;
}

function finishSuccess(t: TranslateFn) {
    // La final reusit: arat un toast, cer reincarcarea istoricului si revin la starea de repaus.
    showToast(t("gen.bookReady"), "success");
    window.dispatchEvent(new Event("reincarca-istoric"));
    resetState();
}

/** SSE: pornesc generarea unui audiobook dintr-un URL. */
export async function runStreamExtrageUrl(
    params: {
        url: string;
        forceRegenerate: boolean;
        ttsVoice: string;
        label: string;
    },
    t: TranslateFn,
): Promise<boolean> {
    // Daca nu pot porni jobul (e altul activ), ies imediat.
    if (!acquireGenerationJob("stream", params.label, { phase: "extracting", streamOrigin: "url" })) return false;
    const signal = abortRef!.signal;
    try {
        // Pornesc stream-ul si tratez fiecare eveniment prin applyStreamEvent.
        const donePayload = await streamExtrageUrl(
            { url: params.url, force_regenerate: params.forceRegenerate, tts_voice: params.ttsVoice },
            (evt) => {
                applyStreamEvent(evt, t);
            },
            signal,
        );
        // Daca nu am primit payload de final, ceva n-a mers.
        if (!donePayload) {
            showToast(t("home.alertUrlError"), "error");
            resetState();
            return false;
        }
        // from_cache inseamna ca exista deja cartea; oricum e succes.
        if (donePayload.from_cache) {
            finishSuccess(t);
            return true;
        }
        finishSuccess(t);
        return true;
    } catch (err) {
        // Daca nu e doar o anulare, arat eroarea.
        if (!isAbortError(err)) {
            const msg = err instanceof Error && err.message ? err.message : t("home.alertServerError");
            showToast(msg, "error");
        }
        resetState();
        return false;
    }
}

/** SSE: pornesc generarea din text manual sau dintr-un document deschis in editor. */
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
    // Daca curat cu Gemini, prima etapa e "cleaning"; altfel sar direct la "tts".
    const phase = params.curataCuGemini ? "cleaning" : "tts";
    // Estimez totalul de segmente doar daca nu curat (la curatare lungimea se poate schimba mult).
    const segmentsTotal = params.curataCuGemini
        ? null
        : Math.max(1, Math.ceil(params.charLen / 2800));
    if (
        !acquireGenerationJob("stream", params.titlu, {
            phase,
            segmentsTotal,
            // Peste 50.000 de caractere consider ca e carte (mod capitole), la fel ca backend-ul.
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

/** Lista de redare, varianta "separat": generez cate o carte distincta pentru fiecare sursa. */
export async function runPlaylistSeparate(
    queue: PlaylistQueueItem[],
    ttsVoice: string,
    t: TranslateFn,
): Promise<boolean> {
    if (queue.length === 0) return false;
    // Pornesc jobul cu totalul egal cu numarul de surse.
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
    // Parcurg fiecare sursa pe rand.
    for (const q of queue) {
        // Daca s-a cerut anulare, ma opresc.
        if (ac.signal.aborted) break;
        index += 1;
        patch({ batchCurrent: index, label: q.titlu || q.label });
        notifyItem(q.id, "generare");
        try {
            if (q.sourceKind === "url" && q.url) {
                // Sursa de tip URL: cer backend-ului sa o extraga si sa genereze.
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
                // Ruta veche /extrage intoarce uneori status "Eroare" cu cod 200, deci verific si asta.
                if (data.status === "Eroare") {
                    throw new Error(data.detalii || data.message || "Eroare");
                }
            } else if (q.sourceKind === "document" && q.titlu && q.extractedText) {
                // Sursa de tip document: am deja textul extras, trimit direct la generare.
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
                // Sursa incompleta (lipseste URL sau text).
                throw new Error(t("playlist.incompleteItem"));
            }
            notifyItem(q.id, "gata");
        } catch (e) {
            // La anulare marchez elementul inapoi ca "pregatit" si ies din bucla.
            if (isAbortError(e)) {
                notifyItem(q.id, "pregatit");
                break;
            }
            // Alta eroare: marchez doar acest element ca esuat si continui cu urmatorul.
            const msg = e instanceof Error ? e.message : t("playlist.unknownError");
            notifyItem(q.id, "eroare", msg);
        }
    }
    // Daca nu s-a anulat, consider intregul lot terminat cu succes.
    if (!ac.signal.aborted) {
        finishSuccess(t);
    } else {
        resetState();
    }
    return true;
}

/** Lista de redare, varianta "combinat": lipesc toate sursele intr-un singur text si fac o singura carte. */
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
    // Aici adun bucatile de text extrase din fiecare sursa, ca sa le lipesc la final.
    const parts: { id: string; titlu: string; text: string }[] = [];
    let failed = 0;  // cate surse au esuat la extragere
    let step = 0;

    // Etapa 1: extrag textul din fiecare sursa.
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
            // URL: extrag doar textul (fara audio inca).
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
            // Document: textul e deja extras, il adaug direct.
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

    // Daca s-a anulat in timpul extragerii, ma opresc.
    if (ac.signal.aborted) {
        resetState();
        return false;
    }
    // Daca n-am reusit sa extrag nimic, nu am ce genera.
    if (parts.length === 0) {
        showToast(t("playlist.combinedNothingExtracted"), "error");
        resetState();
        return false;
    }

    // Lipesc textele: daca e o singura sursa o las simpla, altfel pun un separator vizibil cu titlul fiecareia.
    // (Liniutele de aici fac parte din textul citit, marcheaza inceputul fiecarei sectiuni; nu sunt comentariu.)
    const combinedText =
        parts.length === 1
            ? parts[0].text
            : parts.map((p) => `\n\n--- ${p.titlu} ---\n\n${p.text}`).join("");

    // Marchez toate sursele incluse ca "in generare".
    const partIds = new Set(parts.map((p) => p.id));
    for (const id of partIds) notifyItem(id, "generare");
    patch({ phase: "tts", label: combinedTitle });

    // Etapa 2: trimit textul combinat la generare (cu curatare Gemini activata).
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
        // Daca unele surse au esuat la extragere dar restul a mers, informez ca am inclus doar o parte.
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
            // Anulat in timpul generarii: pun sursele inapoi pe "pregatit".
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

/** Verific inainte de pornire: daca exista deja un job activ, refuz si afisez un mesaj. */
export function guardGenerationStart(t: TranslateFn): boolean {
    if (!isGenerationBusy()) return true;
    showToast(t("gen.alreadyRunning"), "info");
    return false;
}
