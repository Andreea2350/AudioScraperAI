/**
 * Toast global in stilul site-ului. Orice componenta apeleaza showToast(...);
 * ToastHost (montat o singura data in layout) le afiseaza.
 */

export const TOAST_EVENT = "audiobooks-toast";

export type ToastType = "success" | "error" | "info";

export type ToastDetail = { message: string; type: ToastType; duration?: number };

/** Afiseaza un toast (success / error / info) consistent cu stilul aplicatiei. */
export function showToast(message: string, type: ToastType = "success", duration?: number): void {
    if (typeof window === "undefined" || !message) return;
    window.dispatchEvent(new CustomEvent<ToastDetail>(TOAST_EVENT, { detail: { message, type, duration } }));
}
