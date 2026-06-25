/**
 * Aici tin tot ce tine de "vorbitul" cu backend-ul FastAPI: de unde stiu adresa API-ului,
 * cum atasez token-ul de autentificare, cum citesc fluxul SSE de generare si cum transform
 * datele din baza in ce are nevoie playlistul. Practic, e stratul prin care frontend-ul cere date.
 */

// Decid adresa de baza a API-ului in functie de unde ruleaza aplicatia.
function resolveApiBase(): string {
    // Daca am setat explicit o variabila de mediu, o respect (are prioritate).
    if (process.env.NEXT_PUBLIC_API_URL) {
        return process.env.NEXT_PUBLIC_API_URL;
    }
    // In dezvoltare locala lovesc direct backend-ul pe portul 8765, ca SSE-ul sa nu fie buffer-uit de vreun proxy.
    if (typeof window !== "undefined") {
        const host = window.location.hostname;
        if (host === "localhost" || host === "127.0.0.1") {
            return "http://127.0.0.1:8765";
        }
    }
    // In productie cererile merg la /api, unde Vercel monteaza aplicatia FastAPI.
    return "/api";
}

// Adresa de baza o calculez o singura data si o refolosesc peste tot.
export const API_BASE = resolveApiBase();

/** Scot token-ul JWT din localStorage (suport si pentru formatul vechi folosit de Supabase). */
function getActiveSessionToken(): string | null {
    // Pe server (SSR) nu exista localStorage, deci nu am ce token sa intorc.
    if (typeof window === "undefined") return null;

    // Intai incerc cheia mea simpla "token".
    const legacyToken = localStorage.getItem("token");
    if (legacyToken) return legacyToken;

    // Apoi varianta "access_token" (alt format pe care l-am folosit la un moment dat).
    const directAccessToken = localStorage.getItem("access_token");
    if (directAccessToken) return directAccessToken;

    // Ultima varianta, de compatibilitate: Supabase JS salveaza token-ul sub o cheie de tip "sb-...-auth-token".
    for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        try {
            const parsed = JSON.parse(raw) as { access_token?: string };
            if (parsed.access_token) return parsed.access_token;
        } catch {
            // Daca o cheie are JSON invalid, o ignor si trec mai departe.
        }
    }

    return null;
}

/**
 * Construiesc headerele pentru cererile JSON: Content-Type + Authorization cu Bearer token (daca exista).
 */
export function authHeadersJson(): HeadersInit {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const t = getActiveSessionToken();
    // Adaug token-ul doar daca sunt logat; rutele publice merg si fara el.
    if (t) headers.Authorization = `Bearer ${t}`;
    return headers;
}

/** Transform raspunsul de eroare FastAPI (poate fi string sau lista Pydantic) intr-un mesaj citibil pentru UI. */
export function mesajEroareFastAPI(data: unknown, fallback: string): string {
    // Daca nu am un obiect, folosesc mesajul de rezerva.
    if (!data || typeof data !== "object") return fallback;
    const d = (data as Record<string, unknown>).detail;
    // Cazul simplu: detail e direct un string.
    if (typeof d === "string") return d;
    // Cazul Pydantic: detail e o lista de erori, fiecare cu un camp "msg".
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

// Cheia sub care tin id-ul sesiunii de oaspete in localStorage.
export const GUEST_SESSION_STORAGE_KEY = "guest_session_id";

// Forma datelor despre creditele unui oaspete (cate caractere mai are de procesat).
export type GuestCreditsInfo = {
    guest_session_id?: string;
    credits_remaining: number | null;
    credits_total: number | null;
    credits_per_job_max: number | null;
    migration_required?: boolean;
};

// Modul in care se construieste playlistul: pe "parti" (text scurt) sau pe "capitole" (carte).
export type PlaylistMode = "parts" | "chapters";

// Un segment de generare asa cum il primesc prin SSE / il afisez in playlist.
export type GenerationSegment = {
    index: number;
    total: number;
    text_preview: string;
    char_count: number;
    audio_link: string | null;
    chapter_index?: number | null;
    chapter_title?: string | null;
};

/** Metadatele intoarse de POST /extrage_fisier, folosite pentru preview-ul din editor. */
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

// Toate tipurile de evenimente pe care le poate trimite backend-ul prin fluxul SSE de generare.
// E un "discriminated union": campul type imi spune ce forma are restul obiectului.
export type GenerationStreamEvent =
    | { type: "job"; job_id: string }                                                        // id-ul jobului (pentru anulare)
    | { type: "cancelled" }                                                                  // generarea a fost anulata
    | { type: "phase"; phase: string; segments_total?: number; char_count?: number }          // schimbare de etapa (extragere/curatare/tts)
    | { type: "playlist_mode"; mode: PlaylistMode; book_threshold?: number }                  // ce mod de playlist s-a ales
    | { type: "preview"; source_char_total: number; processed_char_count: number }            // preview de oaspete (text taiat)
    | { type: "chapter_start"; chapter_index: number; chapter_title: string }                 // incepe un capitol nou
    | ({ type: "segment" } & GenerationSegment)                                               // un segment gata
    | ({ type: "done" } & Record<string, unknown>)                                            // gata tot, cu rezultatul final
    | { type: "error"; detail: unknown; status_code?: number };                              // a aparut o eroare

// Limitele pentru oaspeti, tinute si pe frontend ca sa pot afisa avertismente inainte de a trimite cererea.
export const GUEST_PREVIEW_CHARS = 5000;
export const GUEST_JOB_MAX_CHARS = 5000;

/** True daca eroarea vine din AbortController (adica utilizatorul a anulat generarea). */
export function isAbortError(err: unknown): boolean {
    if (err instanceof DOMException && err.name === "AbortError") return true;
    return err instanceof Error && err.name === "AbortError";
}

/** Citesc fluxul SSE de generare bucata cu bucata si apelez onEvent pentru fiecare eveniment primit. */
async function consumeGenerationSse(
    res: Response,
    onEvent: (evt: GenerationStreamEvent) => void,
): Promise<Record<string, unknown> | null> {
    // Daca raspunsul HTTP e deja eroare, scot mesajul si arunc.
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const detail = mesajEroareFastAPI(data, `HTTP ${res.status}`);
        onEvent({ type: "error", detail, status_code: res.status });
        throw new Error(detail);
    }
    // Iau cititorul stream-ului ca sa pot procesa datele pe masura ce sosesc.
    const reader = res.body?.getReader();
    if (!reader) {
        onEvent({ type: "error", detail: "Stream indisponibil." });
        throw new Error("Stream indisponibil.");
    }
    const decoder = new TextDecoder();
    let buffer = "";                                          // aici adun ce a venit dar inca nu e un eveniment complet
    let streamError: string | null = null;                   // retin daca a aparut o eroare in flux
    let donePayload: Record<string, unknown> | null = null;  // retin rezultatul final de la evenimentul "done"
    for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
            chunk = await reader.read();
        } catch (err) {
            // Las atat anularea cat si alte erori sa urce (le tratez mai sus).
            if (isAbortError(err)) throw err;
            throw err;
        }
        const { done, value } = chunk;
        if (done) break;
        // Decodez bucata noua si o lipesc la buffer.
        buffer += decoder.decode(value, { stream: true });
        // Evenimentele SSE sunt separate prin linie goala ("\n\n").
        const parts = buffer.split("\n\n");
        // Ultima bucata poate fi incompleta, deci o las inapoi in buffer pentru runda urmatoare.
        buffer = parts.pop() ?? "";
        for (const part of parts) {
            const line = part.trim();
            // Ma intereseaza doar liniile care incep cu "data:" (restul sunt keepalive/comentarii).
            if (!line.startsWith("data:")) continue;
            try {
                // Scot prefixul "data:" si parsez JSON-ul evenimentului.
                const parsed = JSON.parse(line.slice(5).trim()) as GenerationStreamEvent;
                if (parsed.type === "cancelled") {
                    // Daca serverul confirma anularea, o transform intr-un AbortError pe care UI-ul il intelege.
                    throw new DOMException("Generation cancelled", "AbortError");
                }
                if (parsed.type === "error") {
                    const detail = parsed.detail;
                    streamError =
                        typeof detail === "string"
                            ? detail
                            : mesajEroareFastAPI({ detail }, "Eroare la generare.");
                }
                // Trimit evenimentul mai departe catre cel care asculta (componenta de UI).
                onEvent(parsed);
                if (parsed.type === "done") donePayload = parsed;
            } catch {
                // Ignor liniile pe care nu le pot parsa (pot aparea fragmente ciudate).
            }
        }
    }
    // Daca a fost o eroare in flux, o arunc la final.
    if (streamError) throw new Error(streamError);
    return donePayload;
}

/** Pornesc generarea audio din text liber, cu SSE: segmentele apar in UI pe masura ce sunt gata. */
export async function streamGenereazaText(
    body: { titlu: string; text: string; curata_cu_gemini?: boolean; tts_voice?: string | null },
    onEvent: (evt: GenerationStreamEvent) => void,
    signal?: AbortSignal,
): Promise<Record<string, unknown> | null> {
    const res = await fetch(`${API_BASE}/genereaza_text/stream`, {
        method: "POST",
        headers: authHeadersJson(),
        // Pun curata_cu_gemini: false ca default, dar body-ul primit il poate suprascrie.
        body: JSON.stringify({ curata_cu_gemini: false, ...body }),
        signal,  // semnalul de anulare (din AbortController) ca sa pot opri generarea
    });
    return consumeGenerationSse(res, onEvent);
}

/** Extrag textul dintr-un URL si generez audio, tot prin SSE (playlist live). */
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

/** Cer serverului sa anuleze un job de generare (sterge fisierele partiale, fara sa salveze cartea). */
export async function cancelGenerationJob(jobId: string): Promise<void> {
    if (!jobId) return;
    await fetch(`${API_BASE}/generare/cancel`, {
        method: "POST",
        headers: authHeadersJson(),
        body: JSON.stringify({ job_id: jobId }),
    });
}

/** Incarc un fisier si generez audio din el, cu SSE. */
export async function streamGenereazaFisier(
    file: File,
    opts: { titlu?: string; curata_cu_gemini?: boolean; tts_voice?: string | null },
    onEvent: (evt: GenerationStreamEvent) => void,
    signal?: AbortSignal,
): Promise<Record<string, unknown> | null> {
    // Fisierul se trimite ca multipart/form-data, nu ca JSON.
    const fd = new FormData();
    fd.append("file", file);
    if (opts.titlu) fd.append("titlu", opts.titlu);
    // Trimit boolean-ul ca string pentru ca FormData accepta doar text/fisiere.
    fd.append("curata_cu_gemini", String(Boolean(opts.curata_cu_gemini)));
    if (opts.tts_voice) fd.append("tts_voice", opts.tts_voice);
    const res = await fetch(`${API_BASE}/genereaza_fisier/stream`, {
        method: "POST",
        headers: authHeadersMultipart(),  // fara Content-Type, ca browserul sa puna boundary-ul corect
        body: fd,
        signal,
    });
    return consumeGenerationSse(res, onEvent);
}

// Forma unui segment asa cum e salvat in baza de date (carti_segmente).
export type CarteSegment = {
    segment_index: number;
    text_fragment: string;
    audio_link: string;
    char_count: number;
    chapter_index?: number | null;
    chapter_title?: string | null;
};

/** Incarc segmentele deja salvate ale unei carti din biblioteca (ca sa pot reda playlistul fara regenerare). */
export async function fetchCarteSegmente(carteId: number): Promise<CarteSegment[]> {
    const res = await fetch(`${API_BASE}/carti/${carteId}/segmente`, { headers: authHeadersJson() });
    // Daca ceva nu merge, intorc lista goala in loc sa stric pagina.
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: CarteSegment[] };
    return data.data ?? [];
}

/** Cer un rezumat AI pentru o carte (nu atinge audio-ul). Limba o detecteaza serverul din text. */
export async function fetchCarteRezumat(carteId: number): Promise<string> {
    const res = await fetch(`${API_BASE}/carti/${carteId}/rezumat`, {
        method: "POST",
        headers: authHeadersJson(),
        body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(mesajEroareFastAPI(data, `HTTP ${res.status}`));
    }
    const rezumat = (data as { rezumat?: string }).rezumat;
    // Daca rezumatul vine gol, il tratez tot ca eroare.
    if (!rezumat?.trim()) {
        throw new Error(mesajEroareFastAPI(data, "Rezumat gol."));
    }
    return rezumat.trim();
}

/** Anunt serverul ca am deschis o carte, ca sa actualizeze ultima_accesare (folosit la sortarea bibliotecii). */
export async function touchCarteAccess(carteId: number): Promise<string | null> {
    const res = await fetch(`${API_BASE}/carti/${carteId}/acces`, {
        method: "PATCH",
        headers: authHeadersJson(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ultima_accesare?: string };
    return data.ultima_accesare ?? null;
}

/** Transform randurile din baza de date in forma pe care o asteapta componenta de playlist. */
export function segmentsFromCarteDb(rows: CarteSegment[], playlistMode: PlaylistMode = "parts"): GenerationSegment[] {
    return rows.map((r) => ({
        index: r.segment_index,
        total: rows.length,
        // Pregatesc un preview scurt (max 120 caractere) la fel ca backend-ul.
        text_preview: r.text_fragment.slice(0, 120) + (r.text_fragment.length > 120 ? "…" : ""),
        char_count: r.char_count,
        audio_link: r.audio_link,
        chapter_index: r.chapter_index ?? null,
        chapter_title: r.chapter_title ?? null,
    }));
}

/** Headere pentru cererile cu FormData: doar Authorization, fara Content-Type (browserul pune boundary-ul). */
export function authHeadersMultipart(): HeadersInit {
    const headers: Record<string, string> = {};
    const t = getActiveSessionToken();
    if (t) headers.Authorization = `Bearer ${t}`;
    return headers;
}

/** Sterg sesiunea din localStorage (asta e practic logout-ul). */
export function clearAuthSession(): void {
    if (typeof window === "undefined") return;
    localStorage.removeItem("token");
    localStorage.removeItem("rol");
    localStorage.removeItem("email");
    localStorage.removeItem(GUEST_SESSION_STORAGE_KEY);
}

// Citesc id-ul sesiunii de oaspete din localStorage (null daca nu exista).
export function getStoredGuestSessionId(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(GUEST_SESSION_STORAGE_KEY);
}

// Salvez id-ul sesiunii de oaspete in localStorage.
export function setStoredGuestSessionId(id: string): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(GUEST_SESSION_STORAGE_KEY, id);
}

// Iau de la server creditele oaspetelui curent; daca nu sunt oaspete, nu are sens, deci null.
export async function fetchGuestCredits(): Promise<GuestCreditsInfo | null> {
    if (!isGuestSession()) return null;
    const res = await fetch(`${API_BASE}/guest/credits`, { headers: authHeadersJson() });
    if (!res.ok) return null;
    return (await res.json()) as GuestCreditsInfo;
}

/** Forma unei optiuni de voce TTS asa cum o intoarce GET /tts/voices. */
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

/** Incarc catalogul de voci pentru dropdown-ul de selectie, localizat. */
export async function fetchTtsVoices(locale: string): Promise<TtsVoiceOption[]> {
    const loc = locale === "en" ? "en" : "ro";
    const res = await fetch(`${API_BASE}/tts/voices?locale=${loc}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: TtsVoiceOption[] };
    return data.data ?? [];
}

/** Construiesc URL-ul catre MP3-ul scurt de previzualizare a unei voci (il pun direct intr-un <audio>). */
export function ttsPreviewUrl(voiceId: string, locale: string): string {
    const loc = locale === "en" ? "en" : "ro";
    // Encodez id-ul vocii ca sa fie sigur in URL.
    return `${API_BASE}/tts/preview?voice=${encodeURIComponent(voiceId)}&locale=${loc}`;
}

// Citesc rolul utilizatorului salvat in localStorage (admin/user/guest).
export function getStoredUserRole(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("rol");
}

// Scurtatura: sunt oaspete daca rolul salvat e "guest".
export function isGuestSession(): boolean {
    return getStoredUserRole() === "guest";
}
