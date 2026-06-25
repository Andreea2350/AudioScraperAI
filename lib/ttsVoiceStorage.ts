/**
 * Tin minte ce voce TTS a ales utilizatorul, salvand-o in localStorage.
 * Asa, aceeasi voce e folosita peste tot: editorul de text, modalul de URL si lista de redare.
 */

// Vocea implicita (Alina, romaneasca) folosita cand utilizatorul n-a ales inca nimic.
export const DEFAULT_TTS_VOICE = "ro-RO-AlinaNeural";

// Cheia sub care salvez vocea in localStorage.
const STORAGE_KEY = "audiobooks-tts-voice";

/** Citesc vocea salvata; daca nu exista una, ma intorc la Alina. */
export function getStoredTtsVoice(): string {
    // Pe server nu am localStorage, deci dau direct vocea implicita.
    if (typeof window === "undefined") return DEFAULT_TTS_VOICE;
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_TTS_VOICE;
}

/** Salvez vocea aleasa de utilizator, ca s-o regasesc data viitoare. */
export function setStoredTtsVoice(voiceId: string): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEY, voiceId);
}
