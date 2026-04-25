/**
 * URL de baza pentru FastAPI.
 * Implicit `/api`: Next.js face proxy catre backend (acelasi domeniu/port la deploy).
 * Seteaza NEXT_PUBLIC_API_URL daca vrei sa apelezi direct backend-ul (ex. alt host).
 */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "/api";

function getActiveSessionToken(): string | null {
    if (typeof window === "undefined") return null;

    const legacyToken = localStorage.getItem("token");
    if (legacyToken) return legacyToken;

    const directAccessToken = localStorage.getItem("access_token");
    if (directAccessToken) return directAccessToken;

    // Compatibilitate: formatul folosit de Supabase JS in localStorage.
    for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        try {
            const parsed = JSON.parse(raw) as { access_token?: string };
            if (parsed.access_token) return parsed.access_token;
        } catch {
            // ignoram cheile invalide
        }
    }

    return null;
}

/**
 * Construieste headere pentru fetch JSON: Content-Type + Authorization Bearer daca exista token in localStorage.
 * Folosit la istoric, bifare public, stergere, redenumire etc.
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

/** Parseaza raspunsul FastAPI (detail string sau lista de erori Pydantic) intr-un singur string pentru UI. */
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

export function authHeadersMultipart(): HeadersInit {
    const headers: Record<string, string> = {};
    const t = getActiveSessionToken();
    if (t) headers.Authorization = `Bearer ${t}`;
    return headers;
}

/** Curata token, rol si email din localStorage (logout sau sesiune expirata). */
export function clearAuthSession(): void {
    if (typeof window === "undefined") return;
    localStorage.removeItem("token");
    localStorage.removeItem("rol");
    localStorage.removeItem("email");
}
