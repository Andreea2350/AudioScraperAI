/**
 * Sistemul de notificari "toast" (mesajele care apar scurt in colt). Orice componenta poate apela
 * showToast(...), iar ToastHost (montat o singura data in layout) le afiseaza. Comunicarea se face
 * printr-un eveniment pe fereastra, ca sa nu am nevoie sa pasez functii prin toata aplicatia.
 */

// Numele evenimentului pe care il asculta ToastHost.
export const TOAST_EVENT = "audiobooks-toast";

// Tipurile de toast: verde (succes), rosu (eroare), albastru (info).
export type ToastType = "success" | "error" | "info";

// Datele trimise odata cu evenimentul: mesajul, tipul si optional cat timp sa ramana pe ecran.
export type ToastDetail = { message: string; type: ToastType; duration?: number };

/** Afisez un toast: emit un eveniment pe fereastra, pe care ToastHost il prinde si il deseneaza. */
export function showToast(message: string, type: ToastType = "success", duration?: number): void {
    // Pe server sau cu mesaj gol nu am ce afisa.
    if (typeof window === "undefined" || !message) return;
    window.dispatchEvent(new CustomEvent<ToastDetail>(TOAST_EVENT, { detail: { message, type, duration } }));
}
