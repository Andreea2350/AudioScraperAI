/**
 * Gestionez tema aplicatiei (luminos / intunecat / dupa setarile sistemului).
 * Tin preferinta in localStorage si o aplic pe elementul <html> prin clasa "dark".
 */

/** Cheia din localStorage pentru tema; acelasi nume e folosit si in scriptul din layout, ca sa nu palpaie ecranul la prima incarcare. */
export const THEME_STORAGE_KEY = "audiobooks-theme";

// Cele trei optiuni pe care le poate alege utilizatorul.
export type ThemePreference = "light" | "dark" | "system";

/** Transform preferinta "system" in tema reala (light/dark), uitandu-ma la setarea sistemului de operare. */
export function resolveEffectiveTheme(pref: ThemePreference): "light" | "dark" {
    if (pref === "system") {
        // Pe server nu stiu setarea sistemului, deci presupun light.
        if (typeof window === "undefined") return "light";
        // Intreb browserul daca utilizatorul prefera intunecat.
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    // Daca preferinta e explicit light/dark, o intorc ca atare.
    return pref;
}

/** Citesc preferinta salvata; daca nu exista una valida, ma intorc la "system". */
export function readStoredThemePreference(): ThemePreference {
    if (typeof window === "undefined") return "system";
    try {
        const t = localStorage.getItem(THEME_STORAGE_KEY);
        if (t === "light" || t === "dark" || t === "system") return t;
    } catch {
        // localStorage poate fi blocat (mod incognito strict); ignor si folosesc valoarea implicita.
    }
    return "system";
}

/** Aplic tema pe pagina: pun/scot clasa "dark" pe <html> si salvez preferinta. */
export function applyTheme(mode: ThemePreference): void {
    if (typeof document === "undefined") return;
    const effective = resolveEffectiveTheme(mode);
    // Clasa "dark" e cea pe care se bazeaza stilurile Tailwind pentru modul intunecat.
    document.documentElement.classList.toggle("dark", effective === "dark");
    try {
        localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
        // Ignor daca nu pot scrie in localStorage.
    }
}

/** Citesc tema activa direct din DOM (verific daca <html> are clasa "dark"). */
export function readDomTheme(): "light" | "dark" {
    if (typeof document === "undefined") return "light";
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** Calculez urmatoarea preferinta cand utilizatorul apasa comutatorul: light -> dark -> system -> light. */
export function nextThemePreference(current: ThemePreference): ThemePreference {
    if (current === "light") return "dark";
    if (current === "dark") return "system";
    return "light";
}
