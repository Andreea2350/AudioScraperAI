/**
 * Pe pagina de prezentare (landing) am mai multe butoane de previzualizare audio (demo + voci).
 * Aici ma asigur ca ruleaza un singur preview la un moment dat: cand pornesc unul, il opresc pe cel vechi.
 */

// Elementul audio care canta acum (null daca nu canta nimic).
let current: HTMLAudioElement | null = null;
// Ascultatorii care vor sa stie cand s-a oprit redarea (ex. ca sa schimbe iconita butonului).
const stopListeners = new Set<() => void>();

export function subscribeLandingPreviewStop(fn: () => void): () => void {
    // Inregistrez un ascultator si intorc functia de dezabonare.
    stopListeners.add(fn);
    return () => stopListeners.delete(fn);
}

function notifyStopped() {
    // Anunt toti ascultatorii ca redarea s-a oprit.
    stopListeners.forEach((fn) => fn());
}

export function stopLandingPreview() {
    // Opresc redarea curenta (daca exista) si anunt ascultatorii.
    if (current) {
        current.pause();
        current = null;
    }
    notifyStopped();
}

/** Opresc orice preview anterior si pornesc url-ul dat. Intorc false daca redarea esueaza (ex. autoplay blocat). */
export async function playLandingPreview(url: string): Promise<boolean> {
    // Intai opresc ce canta acum, ca sa nu se suprapuna doua sunete.
    stopLandingPreview();
    const audio = new Audio(url);
    current = audio;
    // Functie de curatare folosita si la final, si la eroare.
    const clear = () => {
        // Curat doar daca inca eu sunt cel activ (altfel a pornit deja altul).
        if (current === audio) current = null;
        notifyStopped();
    };
    audio.onended = clear;
    audio.onerror = clear;
    try {
        await audio.play();
        return true;
    } catch {
        // play() poate fi respins de browser (politica de autoplay); curat si raportez esecul.
        clear();
        return false;
    }
}

export function isLandingPreviewPlaying(): boolean {
    // Canta ceva chiar acum?
    return current != null && !current.paused;
}
