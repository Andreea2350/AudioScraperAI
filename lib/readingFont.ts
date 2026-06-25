"use client";

/**
 * Optiunea de "font prietenos la citit" (Lexend), utila pentru cititorii cu dislexie.
 * Tin preferinta in localStorage si o expun ca hook React, ca sa o pot porni/opri din setari
 * si ca blocurile de text sa reactioneze imediat.
 */
import { useCallback, useSyncExternalStore } from "react";

// Cheia de stocare si numele evenimentului prin care anunt schimbarea.
export const READING_FONT_STORAGE_KEY = "audiobooks-reading-font";
export const READING_FONT_EVENT = "audiobooks-reading-font-change";

function readEnabled(): boolean {
    // Citesc din localStorage daca fontul accesibil e pornit ("1" = da).
    if (typeof window === "undefined") return false;
    try {
        return localStorage.getItem(READING_FONT_STORAGE_KEY) === "1";
    } catch {
        return false;
    }
}

function subscribe(listener: () => void): () => void {
    // Ma abonez la evenimentul de schimbare; intorc functia de dezabonare.
    const onChange = () => listener();
    window.addEventListener(READING_FONT_EVENT, onChange);
    return () => window.removeEventListener(READING_FONT_EVENT, onChange);
}

/** Citesc preferinta (font Lexend pornit/oprit) pentru blocurile de text. */
export function readReadingFontEnabled(): boolean {
    return readEnabled();
}

/** Salvez preferinta si anunt componentele ca s-a schimbat. */
export function setReadingFontEnabled(enabled: boolean): void {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(READING_FONT_STORAGE_KEY, enabled ? "1" : "0");
    } catch {
        // Ignor daca nu pot scrie in localStorage.
    }
    // Evenimentul declanseaza re-randarea componentelor abonate prin hook.
    window.dispatchEvent(new CustomEvent(READING_FONT_EVENT, { detail: { enabled } }));
}

/** Intorc clasa CSS potrivita pentru continutul de citit, in functie de starea fontului accesibil. */
export function readingContentClass(enabled: boolean): string {
    return enabled ? "reading-accessible" : "leading-relaxed text-sm whitespace-pre-wrap";
}

export function useReadingFont(): { enabled: boolean; setEnabled: (on: boolean) => void; toggle: () => void } {
    // Hook care expune starea curenta + functii de setare/comutare, sincronizat cu store-ul extern.
    const enabled = useSyncExternalStore(subscribe, readEnabled, () => false);
    const setEnabled = useCallback((on: boolean) => setReadingFontEnabled(on), []);
    const toggle = useCallback(() => setReadingFontEnabled(!readEnabled()), []);
    return { enabled, setEnabled, toggle };
}
