/**
 * Cache local pentru rezumatele generate de AI. Inca nu am o coloana in baza de date pentru ele,
 * asa ca le tin in localStorage, ca utilizatorul sa nu plateasca o noua generare cand redeschide cartea.
 */

// Prefixul cheilor; dupa el adaug id-ul cartii.
const PREFIX = "audiobooks-summary:";

/** Citesc rezumatul salvat pentru o carte (null daca nu exista sau localStorage nu e disponibil). */
export function getStoredSummary(bookId: number | string): string | null {
    if (typeof window === "undefined") return null;
    try {
        return localStorage.getItem(`${PREFIX}${bookId}`);
    } catch {
        return null;
    }
}

/** Salvez rezumatul generat pentru o carte. */
export function setStoredSummary(bookId: number | string, text: string): void {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(`${PREFIX}${bookId}`, text);
    } catch {
        // Ignor daca localStorage e plin (depasire de quota).
    }
}

/** Sterg rezumatul salvat (ex. cand utilizatorul cere regenerarea lui). */
export function clearStoredSummary(bookId: number | string): void {
    if (typeof window === "undefined") return;
    try {
        localStorage.removeItem(`${PREFIX}${bookId}`);
    } catch {
        // Ignor erorile de stergere.
    }
}
