/** Ruta publică landing (domeniu curat). */
export const LANDING_PATH = "/";

/** Biblioteca și fluxul principal de creare audio. */
export const APP_HOME_PATH = "/app";

export function isLandingPath(pathname: string | null): boolean {
    return pathname === LANDING_PATH;
}

export function isPublicPath(pathname: string | null): boolean {
    return (
        isLandingPath(pathname) ||
        pathname === "/login" ||
        pathname === "/intro" ||
        (pathname?.startsWith("/intro/") ?? false)
    );
}

export function isAppHomePath(pathname: string | null): boolean {
    return pathname === APP_HOME_PATH;
}
