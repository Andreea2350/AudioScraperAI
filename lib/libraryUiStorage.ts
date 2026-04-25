/**
 * Organizare biblioteca doar in browser (per utilizator): dosare, mutari, mod afisare, sortare.
 * Nu exista inca camp pe server; la alt browser sau dupa clear cookies se pierde maparea.
 */

export type LibraryViewMode = "grid" | "list";
export type LibrarySortKey = "nume" | "dimensiune" | "data";
export type LibrarySortDir = "asc" | "desc";

export type LibraryFolder = { id: string; name: string };

export type LibraryPersisted = {
    folders: LibraryFolder[];
    /** id carte (string in JSON) -> id dosar sau null = radacina */
    bookFolderId: Record<string, string | null>;
    viewMode: LibraryViewMode;
    sortKey: LibrarySortKey;
    sortDir: LibrarySortDir;
    /** Filtru cautare titlu in biblioteca (doar client). */
    nameFilter: string;
};

const STORAGE_PREFIX = "audiobooks-library-ui:";

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
    sortKey: "data",
    sortDir: "desc",
    nameFilter: "",
};

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
                j.sortKey === "nume" || j.sortKey === "dimensiune" || j.sortKey === "data"
                    ? j.sortKey
                    : "data",
            sortDir: j.sortDir === "asc" ? "asc" : "desc",
            nameFilter: typeof j.nameFilter === "string" ? j.nameFilter : "",
        };
    } catch {
        return { ...defaultState };
    }
}

export function saveLibraryUi(state: LibraryPersisted): void {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(key(), JSON.stringify(state));
    } catch {
        /* ignore */
    }
}

/** Actualizeaza campuri fara a pierde restul starii din localStorage. */
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

export function emitLibraryFiltersChange(detail: LibraryFiltersDetail): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(LIBRARY_FILTERS_CHANGE_EVENT, { detail }));
}

export const LIBRARY_FOLDERS_CHANGED_EVENT = "audiobooks-library-folders-changed" as const;

export function emitLibraryFoldersChanged(): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(LIBRARY_FOLDERS_CHANGED_EVENT));
}

export function parseSortPresetValue(v: string): { sortKey: LibrarySortKey; sortDir: LibrarySortDir } {
    const parts = v.split("-");
    const k = parts[0];
    const d = parts[1];
    let sortKey: LibrarySortKey = "data";
    if (k === "nume" || k === "dimensiune" || k === "data") sortKey = k;
    const sortDir: LibrarySortDir = d === "asc" ? "asc" : "desc";
    return { sortKey, sortDir };
}

export function formatSortPreset(sortKey: LibrarySortKey, sortDir: LibrarySortDir): string {
    return `${sortKey}-${sortDir}`;
}

/** Schimba doar modul de afisare; notifica shell-ul si pagina principala. */
export function setPersistedLibraryViewMode(mode: LibraryViewMode): void {
    if (typeof window === "undefined") return;
    const s = loadLibraryUi();
    saveLibraryUi({ ...s, viewMode: mode });
    window.dispatchEvent(new CustomEvent("audiobooks-library-view-mode", { detail: { mode } }));
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
