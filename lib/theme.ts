/** Cheie in localStorage pentru tema; acelasi nume e folosit in scriptul din layout pentru first paint. */
export const THEME_STORAGE_KEY = "audiobooks-theme";

export type ThemePreference = "light" | "dark" | "system";

/** Rezolva preferinta system la light/dark efectiv. */
export function resolveEffectiveTheme(pref: ThemePreference): "light" | "dark" {
    if (pref === "system") {
        if (typeof window === "undefined") return "light";
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return pref;
}

/** Citeste preferinta salvata (light / dark / system). */
export function readStoredThemePreference(): ThemePreference {
    if (typeof window === "undefined") return "system";
    try {
        const t = localStorage.getItem(THEME_STORAGE_KEY);
        if (t === "light" || t === "dark" || t === "system") return t;
    } catch {
        /* ignor */
    }
    return "system";
}

/** Aplica preferinta pe html si o salveaza in localStorage. */
export function applyTheme(mode: ThemePreference): void {
    if (typeof document === "undefined") return;
    const effective = resolveEffectiveTheme(mode);
    document.documentElement.classList.toggle("dark", effective === "dark");
    try {
        localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
        /* ignor */
    }
}

/** Citeste tema efectiva din clasa dark pe elementul html. */
export function readDomTheme(): "light" | "dark" {
    if (typeof document === "undefined") return "light";
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** Urmatorul mod la click pe comutator: light → dark → system. */
export function nextThemePreference(current: ThemePreference): ThemePreference {
    if (current === "light") return "dark";
    if (current === "dark") return "system";
    return "light";
}
