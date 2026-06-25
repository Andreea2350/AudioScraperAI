/**
 * Tin intr-un singur loc caile (rutele) importante ale aplicatiei si cateva functii prin care
 * verific in ce zona ma aflu. Asa nu mai scriu string-uri de tip "/app" imprastiate prin cod.
 */

/** Pagina publica de prezentare (landing), pe domeniul "curat". */
export const LANDING_PATH = "/";

/** Aplicatia propriu-zisa: biblioteca si fluxul de creare audio. */
export const APP_HOME_PATH = "/app";

/** True daca sunt pe landing. */
export function isLandingPath(pathname: string | null): boolean {
    return pathname === LANDING_PATH;
}

/** True daca pagina e publica (nu cere autentificare): landing, login sau paginile de intro. */
export function isPublicPath(pathname: string | null): boolean {
    return (
        isLandingPath(pathname) ||
        pathname === "/login" ||
        pathname === "/intro" ||
        // Acopar si sub-paginile de intro (ex. /intro/pas-2).
        (pathname?.startsWith("/intro/") ?? false)
    );
}

/** True daca sunt chiar pe pagina principala a aplicatiei. */
export function isAppHomePath(pathname: string | null): boolean {
    return pathname === APP_HOME_PATH;
}
