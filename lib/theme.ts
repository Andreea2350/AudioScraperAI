/** Cheie in localStorage pentru tema; acelasi nume e folosit in scriptul din layout pentru first paint. */
export const THEME_STORAGE_KEY = "audiobooks-theme";

/** Aplic tema light/dark pe html si o salvez in localStorage. */
export function applyTheme(mode: "light" | "dark"): void {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", mode === "dark");
    try {
        localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
        /* ignor */
    }
}

/** Citesc tema curenta din clasa dark pe elementul html. */
export function readDomTheme(): "light" | "dark" {
    if (typeof document === "undefined") return "light";
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
}
