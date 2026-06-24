/**
 * Client API pentru FastAPI: URL baza, autentificare, streaming SSE, segmente playlist.
 */
function resolveApiBase(): string {
    if (process.env.NEXT_PUBLIC_API_URL) {
        return process.env.NEXT_PUBLIC_API_URL;
    }
    // In dev local folosesc direct backend-ul (8765) ca SSE sa nu fie buffer-uit de proxy
    if (typeof window !== "undefined") {
        const host = window.location.hostname;
        if (host === "localhost" || host === "127.0.0.1") {
            return "http://127.0.0.1:8765";
        }
    }
    // In productie request-urile merg la /api (Vercel monteaza FastAPI)
    return "/api";
}

export const API_BASE = resolveApiBase();

/** Citesc token-ul JWT din localStorage (sau format Supabase legacy). */
function getActiveSessionToken(): string | null {
    if (typeof window === "undefined") return null;

    const legacyToken = localStorage.getItem("token");
    if (legacyToken) return legacyToken;

    const directAccessToken = localStorage.getItem("access_token");
    if (directAccessToken) return directAccessToken;

    // Compatibilitate: formatul folosit de Supabase JS in localStorage
    for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        try {
            const parsed = JSON.parse(raw) as { access_token?: string };
            if (parsed.access_token) return parsed.access_token;
        } catch {
            // ignor cheile invalide
        }
    }

    return null;
}

/**
 * Construiesc headere JSON cu Bearer token pentru rute protejate.
 */
export function authHeadersJson(): HeadersInit {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const t = getActiveSessionToken();
    if (t) headers.Authorization = `Bearer ${t}`;
    return headers;
}

/**
 * Doar Authorization, fara Content-Type: la FormData lasam browserul sa puna boundary-ul multipart.
 */

/** Parsez raspunsul FastAPI (detail string sau lista Pydantic) intr-un mesaj pentru UI. */
export function mesajEroareFastAPI(data: unknown, fallback: string): string {
    if (!data || typeof data !== "object") return fallback;
    const d = (data as Record<string, unknown>).detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) {
        return d
            .map((item: unknown) => {
                if (item && typeof item === "object" && "msg" in item) {
                    return String((item as { msg: string }).msg);
                }
                return JSON.stringify(item);
            })
            .join(" ");
    }
    return fallback;
}

export const GUEST_SESSION_STORAGE_KEY = "guest_session_id";

export type GuestCreditsInfo = {
    guest_session_id?: string;
    credits_remaining: number | null;
    credits_total: number | null;
    credits_per_job_max: number | null;
    migration_required?: boolean;
};

export type PlaylistMode = "parts" | "chapters";

export type GenerationSegment = {
    index: number;
    total: number;
    text_preview: string;
    char_count: number;
    audio_link: string | null;
    chapter_index?: number | null;
    chapter_title?: string | null;
};

/** Metadate returnate de POST /extrage_fisier pentru preview in editor. */
export type DocumentExtractMeta = {
    source_type?: string;
    char_count?: number;
    extract_preview?: string;
    page_count?: number;
    pages_with_text?: number;
    pages_empty?: number;
    pages_ocr?: number;
    pages_ocr_skipped?: number;
    engine?: string;
};

export type GenerationStreamEvent =
    | { type: "job"; job_id: string }
    | { type: "cancelled" }
    | { type: "phase"; phase: string; segments_total?: number; char_count?: number }
    | { type: "playlist_mode"; mode: PlaylistMode; book_threshold?: number }
    | { type: "preview"; source_char_total: number; processed_char_count: number }
    | { type: "chapter_start"; chapter_index: number; chapter_title: string }
    | ({ type: "segment" } & GenerationSegment)
    | ({ type: "done" } & Record<string, unknown>)
    | { type: "error"; detail: unknown; status_code?: number };

export const GUEST_PREVIEW_CHARS = 5000;
export const GUEST_JOB_MAX_CHARS = 5000;

/** True daca eroarea provine din AbortController (anulare generare). */
export function isAbortError(err: unknown): boolean {
    if (err instanceof DOMException && err.name === "AbortError") return true;
    return err instanceof Error && err.name === "AbortError";
}

/** Citesc fluxul SSE de generare si apelez onEvent pentru fiecare eveniment. */
async function consumeGenerationSse(
    res: Response,
    onEvent: (evt: GenerationStreamEvent) => void,
): Promise<Record<string, unknown> | null> {
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const detail = mesajEroareFastAPI(data, `HTTP ${res.status}`);
        onEvent({ type: "error", detail, status_code: res.status });
        throw new Error(detail);
    }
    const reader = res.body?.getReader();
    if (!reader) {
        onEvent({ type: "error", detail: "Stream indisponibil." });
        throw new Error("Stream indisponibil.");
    }
    const decoder = new TextDecoder();
    let buffer = "";
    let streamError: string | null = null;
    let donePayload: Record<string, unknown> | null = null;
    for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
            chunk = await reader.read();
        } catch (err) {
            if (isAbortError(err)) throw err;
            throw err;
        }
        const { done, value } = chunk;
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith("data:")) continue;
            try {
                const parsed = JSON.parse(line.slice(5).trim()) as GenerationStreamEvent;
                if (parsed.type === "cancelled") {
                    throw new DOMException("Generation cancelled", "AbortError");
                }
                if (parsed.type === "error") {
                    const detail = parsed.detail;
                    streamError =
                        typeof detail === "string"
                            ? detail
                            : mesajEroareFastAPI({ detail }, "Eroare la generare.");
                }
                onEvent(parsed);
                if (parsed.type === "done") donePayload = parsed;
            } catch {
                // ignoram
            }
        }
    }
    if (streamError) throw new Error(streamError);
    return donePayload;
}

/** Generez audio din text cu SSE — segmentele apar pe masura ce sunt gata. */
export async function streamGenereazaText(
    body: { titlu: string; text: string; curata_cu_gemini?: boolean; tts_voice?: string | null },
    onEvent: (evt: GenerationStreamEvent) => void,
    signal?: AbortSignal,
): Promise<Record<string, unknown> | null> {
    const res = await fetch(`${API_BASE}/genereaza_text/stream`, {
        method: "POST",
        headers: authHeadersJson(),
        body: JSON.stringify({ curata_cu_gemini: false, ...body }),
        signal,
    });
    return consumeGenerationSse(res, onEvent);
}

/** Extrag URL + generez audio cu SSE (playlist live). */
export async function streamExtrageUrl(
    body: { url: string; force_regenerate?: boolean; tts_voice?: string | null },
    onEvent: (evt: GenerationStreamEvent) => void,
    signal?: AbortSignal,
): Promise<Record<string, unknown> | null> {
    const res = await fetch(`${API_BASE}/extrage/stream`, {
        method: "POST",
        headers: authHeadersJson(),
        body: JSON.stringify(body),
        signal,
    });
    return consumeGenerationSse(res, onEvent);
}

/** Anuleaza un job SSE de generare pe server (stergere fisiere partiale, fara salvare carte). */
export async function cancelGenerationJob(jobId: string): Promise<void> {
    if (!jobId) return;
    await fetch(`${API_BASE}/generare/cancel`, {
        method: "POST",
        headers: authHeadersJson(),
        body: JSON.stringify({ job_id: jobId }),
    });
}

/** Incarc fisier + generez audio cu SSE. */
export async function streamGenereazaFisier(
    file: File,
    opts: { titlu?: string; curata_cu_gemini?: boolean; tts_voice?: string | null },
    onEvent: (evt: GenerationStreamEvent) => void,
    signal?: AbortSignal,
): Promise<Record<string, unknown> | null> {
    const fd = new FormData();
    fd.append("file", file);
    if (opts.titlu) fd.append("titlu", opts.titlu);
    fd.append("curata_cu_gemini", String(Boolean(opts.curata_cu_gemini)));
    if (opts.tts_voice) fd.append("tts_voice", opts.tts_voice);
    const res = await fetch(`${API_BASE}/genereaza_fisier/stream`, {
        method: "POST",
        headers: authHeadersMultipart(),
        body: fd,
        signal,
    });
    return consumeGenerationSse(res, onEvent);
}

export type CarteSegment = {
    segment_index: number;
    text_fragment: string;
    audio_link: string;
    char_count: number;
    chapter_index?: number | null;
    chapter_title?: string | null;
};

/** Incarc segmentele salvate pentru o carte din biblioteca. */
export async function fetchCarteSegmente(carteId: number): Promise<CarteSegment[]> {
    const res = await fetch(`${API_BASE}/carti/${carteId}/segmente`, { headers: authHeadersJson() });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: CarteSegment[] };
    return data.data ?? [];
}

/** Generează rezumat AI pentru o carte (nu modifică audio). */
export async function fetchCarteRezumat(carteId: number): Promise<string> {
    const res = await fetch(`${API_BASE}/carti/${carteId}/rezumat`, {
        method: "POST",
        headers: authHeadersJson(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(mesajEroareFastAPI(data, `HTTP ${res.status}`));
    }
    const rezumat = (data as { rezumat?: string }).rezumat;
    if (!rezumat?.trim()) {
        throw new Error(mesajEroareFastAPI(data, "Rezumat gol."));
    }
    return rezumat.trim();
}

/** Înregistrează deschiderea unei cărți în bibliotecă (ultima_accesare în Supabase). */
export async function touchCarteAccess(carteId: number): Promise<string | null> {
    const res = await fetch(`${API_BASE}/carti/${carteId}/acces`, {
        method: "PATCH",
        headers: authHeadersJson(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ultima_accesare?: string };
    return data.ultima_accesare ?? null;
}

/** Transform randurile din DB in formatul folosit de GenerationPlaylist. */
export function segmentsFromCarteDb(rows: CarteSegment[], playlistMode: PlaylistMode = "parts"): GenerationSegment[] {
    return rows.map((r) => ({
        index: r.segment_index,
        total: rows.length,
        text_preview: r.text_fragment.slice(0, 120) + (r.text_fragment.length > 120 ? "…" : ""),
        char_count: r.char_count,
        audio_link: r.audio_link,
        chapter_index: r.chapter_index ?? null,
        chapter_title: r.chapter_title ?? null,
    }));
}

/** Headere pentru FormData (fara Content-Type — browserul seteaza boundary). */
export function authHeadersMultipart(): HeadersInit {
    const headers: Record<string, string> = {};
    const t = getActiveSessionToken();
    if (t) headers.Authorization = `Bearer ${t}`;
    return headers;
}

/** Sterg sesiunea din localStorage (logout). */
export function clearAuthSession(): void {
    if (typeof window === "undefined") return;
    localStorage.removeItem("token");
    localStorage.removeItem("rol");
    localStorage.removeItem("email");
    localStorage.removeItem(GUEST_SESSION_STORAGE_KEY);
}

export function getStoredGuestSessionId(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(GUEST_SESSION_STORAGE_KEY);
}

export function setStoredGuestSessionId(id: string): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(GUEST_SESSION_STORAGE_KEY, id);
}

export async function fetchGuestCredits(): Promise<GuestCreditsInfo | null> {
    if (!isGuestSession()) return null;
    const res = await fetch(`${API_BASE}/guest/credits`, { headers: authHeadersJson() });
    if (!res.ok) return null;
    return (await res.json()) as GuestCreditsInfo;
}

/** Optiune voce TTS returnata de GET /tts/voices. */
export type TtsVoiceOption = {
    id: string;
    engine?: "edge" | "gtts";
    demo_locale?: "ro" | "en";
    name: string;
    gender: string;
    trait: string;
    language: string;
    sample_text: string;
};

/** Incarc catalogul de voci Edge pentru dropdown. */
export async function fetchTtsVoices(locale: string): Promise<TtsVoiceOption[]> {
    const loc = locale === "en" ? "en" : "ro";
    const res = await fetch(`${API_BASE}/tts/voices?locale=${loc}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: TtsVoiceOption[] };
    return data.data ?? [];
}

/** URL MP3 scurt pentru previzualizarea unei voci in browser. */
export function ttsPreviewUrl(voiceId: string, locale: string): string {
    const loc = locale === "en" ? "en" : "ro";
    return `${API_BASE}/tts/preview?voice=${encodeURIComponent(voiceId)}&locale=${loc}`;
}

export function getStoredUserRole(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("rol");
}

export function isGuestSession(): boolean {
    return getStoredUserRole() === "guest";
}
