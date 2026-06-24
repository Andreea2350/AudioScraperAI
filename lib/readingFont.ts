"use client";

import { useCallback, useSyncExternalStore } from "react";

export const READING_FONT_STORAGE_KEY = "audiobooks-reading-font";
export const READING_FONT_EVENT = "audiobooks-reading-font-change";

function readEnabled(): boolean {
    if (typeof window === "undefined") return false;
    try {
        return localStorage.getItem(READING_FONT_STORAGE_KEY) === "1";
    } catch {
        return false;
    }
}

function subscribe(listener: () => void): () => void {
    const onChange = () => listener();
    window.addEventListener(READING_FONT_EVENT, onChange);
    return () => window.removeEventListener(READING_FONT_EVENT, onChange);
}

/** Citește preferința fontului Lexend pentru blocurile de citit. */
export function readReadingFontEnabled(): boolean {
    return readEnabled();
}

/** Persistă și notifică componentele despre schimbarea preferinței. */
export function setReadingFontEnabled(enabled: boolean): void {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(READING_FONT_STORAGE_KEY, enabled ? "1" : "0");
    } catch {
        /* ignor */
    }
    window.dispatchEvent(new CustomEvent(READING_FONT_EVENT, { detail: { enabled } }));
}

/** Clasă CSS pentru conținutul de citit când Lexend e activ. */
export function readingContentClass(enabled: boolean): string {
    return enabled ? "reading-accessible" : "leading-relaxed text-sm whitespace-pre-wrap";
}

export function useReadingFont(): { enabled: boolean; setEnabled: (on: boolean) => void; toggle: () => void } {
    const enabled = useSyncExternalStore(subscribe, readEnabled, () => false);
    const setEnabled = useCallback((on: boolean) => setReadingFontEnabled(on), []);
    const toggle = useCallback(() => setReadingFontEnabled(!readEnabled()), []);
    return { enabled, setEnabled, toggle };
}
