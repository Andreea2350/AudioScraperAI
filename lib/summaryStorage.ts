/** Cache local pentru rezumate generate (fără coloană DB încă). */
const PREFIX = "audiobooks-summary:";

export function getStoredSummary(bookId: number | string): string | null {
    if (typeof window === "undefined") return null;
    try {
        return localStorage.getItem(`${PREFIX}${bookId}`);
    } catch {
        return null;
    }
}

export function setStoredSummary(bookId: number | string, text: string): void {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(`${PREFIX}${bookId}`, text);
    } catch {
        // ignoră quota
    }
}

export function clearStoredSummary(bookId: number | string): void {
    if (typeof window === "undefined") return;
    try {
        localStorage.removeItem(`${PREFIX}${bookId}`);
    } catch {
        // ignoră
    }
}
