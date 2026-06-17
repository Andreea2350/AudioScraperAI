/**
 * Preferinta voce TTS in localStorage (partajata intre editor text, modal URL, lista redare).
 */
export const DEFAULT_TTS_VOICE = "ro-RO-AlinaNeural";

const STORAGE_KEY = "audiobooks-tts-voice";

/** Citesc vocea salvata sau implicita Alina. */
export function getStoredTtsVoice(): string {
    if (typeof window === "undefined") return DEFAULT_TTS_VOICE;
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_TTS_VOICE;
}

/** Persist vocea aleasa de utilizator. */
export function setStoredTtsVoice(voiceId: string): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEY, voiceId);
}
