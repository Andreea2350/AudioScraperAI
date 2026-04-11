/** URL de baza al API-ului FastAPI; in dev folosim 8765 ca sa evitam conflicte cu portul 8000 pe Windows. */
export const API_BASE =
    process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8765";

/**
 * Construieste headere pentru fetch JSON: Content-Type + Authorization Bearer daca exista token in localStorage.
 * Folosit la istoric, bifare public, stergere, redenumire etc.
 */
export function authHeadersJson(): HeadersInit {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (typeof window !== "undefined") {
        const t = localStorage.getItem("token");
        if (t) headers.Authorization = `Bearer ${t}`;
    }
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
    if (typeof window !== "undefined") {
        const t = localStorage.getItem("token");
        if (t) headers.Authorization = `Bearer ${t}`;
    }
    return headers;
}

/** Curata token, rol si email din localStorage (logout sau sesiune expirata). */
export function clearAuthSession(): void {
    if (typeof window === "undefined") return;
    localStorage.removeItem("token");
    localStorage.removeItem("rol");
    localStorage.removeItem("email");
}
