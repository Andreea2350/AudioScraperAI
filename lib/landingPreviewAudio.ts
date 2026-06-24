/** Un singur preview audio activ pe landing (demo + voci). */

let current: HTMLAudioElement | null = null;
const stopListeners = new Set<() => void>();

export function subscribeLandingPreviewStop(fn: () => void): () => void {
    stopListeners.add(fn);
    return () => stopListeners.delete(fn);
}

function notifyStopped() {
    stopListeners.forEach((fn) => fn());
}

export function stopLandingPreview() {
    if (current) {
        current.pause();
        current = null;
    }
    notifyStopped();
}

/** Oprește orice preview anterior și pornește `url`. Returnează false dacă redarea eșuează. */
export async function playLandingPreview(url: string): Promise<boolean> {
    stopLandingPreview();
    const audio = new Audio(url);
    current = audio;
    const clear = () => {
        if (current === audio) current = null;
        notifyStopped();
    };
    audio.onended = clear;
    audio.onerror = clear;
    try {
        await audio.play();
        return true;
    } catch {
        clear();
        return false;
    }
}

export function isLandingPreviewPlaying(): boolean {
    return current != null && !current.paused;
}
