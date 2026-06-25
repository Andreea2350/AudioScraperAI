/**
 * Dialogul de confirmare al aplicatiei (inlocuieste urat-ul window.confirm cu unul in stilul site-ului).
 * confirmDialog(...) intoarce o promisiune care se rezolva cu true daca utilizatorul confirma, false altfel.
 */

// Optiunile cu care personalizez dialogul.
export type ConfirmOptions = {
    message: string;
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    /** Daca e true, butonul de confirmare e rosu (pentru actiuni distructive, ex. stergere). */
    destructive?: boolean;
};

// Tipul functiei reale care afiseaza dialogul (o furnizeaza componenta ConfirmHost).
type Handler = (opts: ConfirmOptions) => Promise<boolean>;

// Referinta catre handler-ul curent; null cat timp ConfirmHost nu e montat.
let handler: Handler | null = null;

/** ConfirmHost se inregistreaza aici cand se monteaza si se sterge (null) la demontare. */
export function registerConfirmHandler(h: Handler | null): void {
    handler = h;
}

/** Cer confirmarea utilizatorului. Daca host-ul nostru nu e montat, cad pe window.confirm clasic. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
    if (handler) return handler(opts);
    // Fallback: dialogul nativ al browserului.
    if (typeof window !== "undefined") return Promise.resolve(window.confirm(opts.message));
    // Pe server nu pot intreba nimic, deci raspund "nu".
    return Promise.resolve(false);
}
