/** Cheie in localStorage pentru tema; acelasi nume e folosit in scriptul din layout pentru first paint. */
export const THEME_STORAGE_KEY = "audiobooks-theme";

export function applyTheme(mode: "light" | "dark"): void {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", mode === "dark");
    try {
        localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
        /* ignore */
    }
}

/** Citeste starea curenta din clasa `dark` pe elementul html (dupa applyTheme sau script initial). */
export function readDomTheme(): "light" | "dark" {
    if (typeof document === "undefined") return "light";
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
}
