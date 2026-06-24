/**
 * Dialog de confirmare global, in stilul site-ului (inlocuieste window.confirm).
 * confirmDialog(...) returneaza o promisiune cu raspunsul utilizatorului.
 */

export type ConfirmOptions = {
    message: string;
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    /** Buton de confirmare rosu (actiune distructiva). */
    destructive?: boolean;
};

type Handler = (opts: ConfirmOptions) => Promise<boolean>;

let handler: Handler | null = null;

/** ConfirmHost se inregistreaza la montare; null la demontare. */
export function registerConfirmHandler(h: Handler | null): void {
    handler = h;
}

/** Cere confirmare utilizatorului; cade pe window.confirm daca host-ul nu e montat. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
    if (handler) return handler(opts);
    if (typeof window !== "undefined") return Promise.resolve(window.confirm(opts.message));
    return Promise.resolve(false);
}
