/**
 * Organizare biblioteca doar in browser (per utilizator): dosare, mutari, mod afisare, sortare.
 * Nu exista inca camp pe server; la alt browser sau dupa clear cookies se pierde maparea.
 */

/** Eveniment: detail.open = true cand o carte e deschisa pe pagina principala. */
export const LIBRARY_BOOK_VIEW_EVENT = "library-book-view";

export type LibraryViewMode = "grid" | "list";
export type LibrarySortKey = "nume" | "dimensiune" | "data" | "acces";
export type LibrarySortDir = "asc" | "desc";

export type LibraryFolder = { id: string; name: string };

export type LibraryPersisted = {
    folders: LibraryFolder[];
    /** id carte (string in JSON) -> id dosar sau null = radacina */
    bookFolderId: Record<string, string | null>;
    viewMode: LibraryViewMode;
    sortKey: LibrarySortKey;
    sortDir: LibrarySortDir;
    /** Filtru cautare titlu in biblioteca (doar client) */
    nameFilter: string;
};

const STORAGE_PREFIX = "audiobooks-library-ui:";

/** Construiesc cheia localStorage pe baza emailului sau rolului guest. */
export function libraryStorageUserKey(): string {
    if (typeof window === "undefined") return "default";
    const email = (localStorage.getItem("email") || "").trim().toLowerCase();
    const rol = localStorage.getItem("rol") || "guest";
    return email ? `u:${email}` : `g:${rol}`;
}

function key(): string {
    return STORAGE_PREFIX + libraryStorageUserKey();
}

const defaultState: LibraryPersisted = {
    folders: [],
    bookFolderId: {},
    viewMode: "grid",
    sortKey: "acces",
    sortDir: "desc",
    nameFilter: "",
};

/** Citesc starea UI a bibliotecii din localStorage. */
export function loadLibraryUi(): LibraryPersisted {
    if (typeof window === "undefined") return { ...defaultState };
    try {
        const raw = localStorage.getItem(key());
        if (!raw) return { ...defaultState };
        const j = JSON.parse(raw) as Partial<LibraryPersisted>;
        return {
            folders: Array.isArray(j.folders) ? j.folders : [],
            bookFolderId: j.bookFolderId && typeof j.bookFolderId === "object" ? j.bookFolderId : {},
            viewMode: j.viewMode === "list" ? "list" : "grid",
            sortKey:
                j.sortKey === "nume" || j.sortKey === "dimensiune" || j.sortKey === "data" || j.sortKey === "acces"
                    ? j.sortKey
                    : "acces",
            sortDir: j.sortDir === "asc" ? "asc" : "desc",
            nameFilter: typeof j.nameFilter === "string" ? j.nameFilter : "",
        };
    } catch {
        return { ...defaultState };
    }
}

/** Salvez starea UI a bibliotecii in localStorage. */
export function saveLibraryUi(state: LibraryPersisted): void {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(key(), JSON.stringify(state));
    } catch {
        /* ignor */
    }
}

/** Actualizez campuri fara a pierde restul starii din localStorage. */
export function patchLibraryUi(patch: Partial<LibraryPersisted>): LibraryPersisted {
    const s = loadLibraryUi();
    const next = { ...s, ...patch };
    saveLibraryUi(next);
    return next;
}

export const LIBRARY_FILTERS_CHANGE_EVENT = "audiobooks-library-filters" as const;

export type LibraryFiltersDetail = {
    nameFilter: string;
    sortKey: LibrarySortKey;
    sortDir: LibrarySortDir;
};

/** Notific pagina principala ca s-au schimbat filtrele de sortare/cautare. */
export function emitLibraryFiltersChange(detail: LibraryFiltersDetail): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(LIBRARY_FILTERS_CHANGE_EVENT, { detail }));
}

export const LIBRARY_FOLDERS_CHANGED_EVENT = "audiobooks-library-folders-changed" as const;

/** Notific ca s-a creat/sters un dosar in biblioteca. */
export function emitLibraryFoldersChanged(): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(LIBRARY_FOLDERS_CHANGED_EVENT));
}

/** Parsez valoarea din select-ul de sortare (ex. "data-desc"). */
export function parseSortPresetValue(v: string): { sortKey: LibrarySortKey; sortDir: LibrarySortDir } {
    const parts = v.split("-");
    const k = parts[0];
    const d = parts[1];
    let sortKey: LibrarySortKey = "acces";
    if (k === "nume" || k === "dimensiune" || k === "data" || k === "acces") sortKey = k;
    const sortDir: LibrarySortDir = d === "asc" ? "asc" : "desc";
    return { sortKey, sortDir };
}

export function formatSortPreset(sortKey: LibrarySortKey, sortDir: LibrarySortDir): string {
    return `${sortKey}-${sortDir}`;
}

/** Schimb modul grid/list si notific shell-ul si pagina principala. */
export function setPersistedLibraryViewMode(mode: LibraryViewMode): void {
    if (typeof window === "undefined") return;
    const s = loadLibraryUi();
    saveLibraryUi({ ...s, viewMode: mode });
    window.dispatchEvent(new CustomEvent("audiobooks-library-view-mode", { detail: { mode } }));
}

/* --- Audiobook-ul de prezentare (carte virtuala, per utilizator/guest) --- */

/** Id rezervat pentru audiobook-ul de prezentare; nu se ciocneste cu id-uri numerice din DB. */
export const WELCOME_BOOK_ID = "welcome" as const;

const WELCOME_PREFIX = "audiobooks-welcome:";

export type WelcomeState = { dismissed: boolean; title: string | null };

/** Citesc starea cartii de prezentare (stearsa? redenumita?) pentru utilizatorul curent. */
export function getWelcomeState(): WelcomeState {
    if (typeof window === "undefined") return { dismissed: false, title: null };
    try {
        const raw = localStorage.getItem(WELCOME_PREFIX + libraryStorageUserKey());
        if (!raw) return { dismissed: false, title: null };
        const j = JSON.parse(raw) as Partial<WelcomeState>;
        return {
            dismissed: j.dismissed === true,
            title: typeof j.title === "string" ? j.title : null,
        };
    } catch {
        return { dismissed: false, title: null };
    }
}

function saveWelcomeState(state: WelcomeState): void {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(WELCOME_PREFIX + libraryStorageUserKey(), JSON.stringify(state));
    } catch {
        /* ignor */
    }
}

/** Marchez cartea de prezentare ca stearsa (nu mai reapare la reincarcare). */
export function setWelcomeDismissed(): void {
    saveWelcomeState({ ...getWelcomeState(), dismissed: true });
}

/** Salvez titlul redenumit pentru cartea de prezentare. */
export function setWelcomeTitle(title: string): void {
    saveWelcomeState({ ...getWelcomeState(), title });
}

export function getBookFolderId(map: Record<string, string | null>, bookId: number): string | null {
    const v = map[String(bookId)];
    return v === undefined || v === null ? null : v;
}

export function setBookFolderId(
    map: Record<string, string | null>,
    bookId: number,
    folderId: string | null,
): Record<string, string | null> {
    const k = String(bookId);
    const next = { ...map };
    if (folderId === null) delete next[k];
    else next[k] = folderId;
    return next;
}

/** Scot asignarile cartilor dintr-un dosar sters. */
export function removeBookAssignmentsForFolder(
    map: Record<string, string | null>,
    folderId: string,
): Record<string, string | null> {
    const next = { ...map };
    for (const [bid, fid] of Object.entries(next)) {
        if (fid === folderId) delete next[bid];
    }
    return next;
}
