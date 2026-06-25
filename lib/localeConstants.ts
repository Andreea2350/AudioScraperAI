/**
 * Cheia sub care tin limba interfetei in localStorage. O pun in fisierul asta separat (fara "use client")
 * ca sa o poata importa si layout-ul (care ruleaza pe server) fara sa devina componenta de client.
 * Important: stringul trebuie sa fie identic cu cel din app/layout.tsx, altfel limba nu s-ar mai potrivi.
 */
export const LANG_STORAGE_KEY = "audiobooks-lang";
