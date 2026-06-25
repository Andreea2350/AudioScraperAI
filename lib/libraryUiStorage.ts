/**
 * Organizarea bibliotecii care exista DOAR in browser (per utilizator): dosare, in ce dosar e fiecare carte,
 * modul de afisare (grid/list), sortarea si filtrul de cautare. Nu am inca un camp pe server pentru asta,
 * deci daca schimb browserul sau sterg datele site-ului, organizarea se pierde (cartile raman, doar maparea dispare).
 */

/** Eveniment lansat cand o carte e deschisa pe pagina principala (detail.open = true). */
export const LIBRARY_BOOK_VIEW_EVENT = "library-book-view";

// Tipurile pentru modul de afisare, cheia si directia de sortare.
export type LibraryViewMode = "grid" | "list";
export type LibrarySortKey = "nume" | "dimensiune" | "data" | "acces";
export type LibrarySortDir = "asc" | "desc";

// Un dosar din biblioteca (doar nume + id, totul local).
export type LibraryFolder = { id: string; name: string };

// Tot ce salvez in localStorage despre organizarea bibliotecii.
export type LibraryPersisted = {
    folders: LibraryFolder[];
    /** Maparea: id-ul cartii (ca string in JSON) -> id-ul dosarului, sau null daca e in radacina. */
    bookFolderId: Record<string, string | null>;
    viewMode: LibraryViewMode;
    sortKey: LibrarySortKey;
    sortDir: LibrarySortDir;
    /** Textul de cautare dupa titlu in biblioteca (filtru doar pe client). */
    nameFilter: string;
};

// Prefixul cheilor din localStorage; dupa el adaug identitatea utilizatorului.
const STORAGE_PREFIX = "audiobooks-library-ui:";

/** Construiesc o cheie de localStorage unica pe utilizator (dupa email, sau dupa rol daca e oaspete). */
export function libraryStorageUserKey(): string {
    if (typeof window === "undefined") return "default";
    const email = (localStorage.getItem("email") || "").trim().toLowerCase();
    const rol = localStorage.getItem("rol") || "guest";
    // Daca am email, cheia e "u:email"; altfel "g:rol" (oaspeti).
    return email ? `u:${email}` : `g:${rol}`;
}

function key(): string {
    // Cheia completa = prefix + identitatea utilizatorului.
    return STORAGE_PREFIX + libraryStorageUserKey();
}

// Starea implicita cand utilizatorul nu a salvat inca nimic.
const defaultState: LibraryPersisted = {
    folders: [],
    bookFolderId: {},
    viewMode: "grid",
    sortKey: "acces",
    sortDir: "desc",
    nameFilter: "",
};

/** Citesc starea bibliotecii din localStorage, validand fiecare camp ca sa nu crap pe date stricate. */
export function loadLibraryUi(): LibraryPersisted {
    if (typeof window === "undefined") return { ...defaultState };
    try {
        const raw = localStorage.getItem(key());
        if (!raw) return { ...defaultState };
        const j = JSON.parse(raw) as Partial<LibraryPersisted>;
        // Validez fiecare camp si cad pe valoarea implicita daca e ceva ciudat.
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
        // JSON invalid -> revin la starea implicita.
        return { ...defaultState };
    }
}

/** Salvez intreaga stare a bibliotecii in localStorage. */
export function saveLibraryUi(state: LibraryPersisted): void {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(key(), JSON.stringify(state));
    } catch {
        // Ignor daca nu pot scrie (ex. localStorage plin sau blocat).
    }
}

/** Actualizez doar cateva campuri, pastrand restul starii deja salvate. */
export function patchLibraryUi(patch: Partial<LibraryPersisted>): LibraryPersisted {
    const s = loadLibraryUi();
    const next = { ...s, ...patch };
    saveLibraryUi(next);
    return next;
}

// Eveniment prin care anunt pagina ca s-au schimbat filtrele de sortare/cautare.
export const LIBRARY_FILTERS_CHANGE_EVENT = "audiobooks-library-filters" as const;

export type LibraryFiltersDetail = {
    nameFilter: string;
    sortKey: LibrarySortKey;
    sortDir: LibrarySortDir;
};

/** Trimit pe fereastra un eveniment cu noile filtre, ca pagina principala sa se actualizeze. */
export function emitLibraryFiltersChange(detail: LibraryFiltersDetail): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(LIBRARY_FILTERS_CHANGE_EVENT, { detail }));
}

// Eveniment pentru cand s-a creat sau sters un dosar.
export const LIBRARY_FOLDERS_CHANGED_EVENT = "audiobooks-library-folders-changed" as const;

/** Anunt restul aplicatiei ca lista de dosare s-a schimbat. */
export function emitLibraryFoldersChanged(): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(LIBRARY_FOLDERS_CHANGED_EVENT));
}

/** Parsez valoarea din dropdown-ul de sortare (ex. "data-desc") in cheie + directie. */
export function parseSortPresetValue(v: string): { sortKey: LibrarySortKey; sortDir: LibrarySortDir } {
    const parts = v.split("-");
    const k = parts[0];
    const d = parts[1];
    let sortKey: LibrarySortKey = "acces";
    if (k === "nume" || k === "dimensiune" || k === "data" || k === "acces") sortKey = k;
    const sortDir: LibrarySortDir = d === "asc" ? "asc" : "desc";
    return { sortKey, sortDir };
}

/** Operatia inversa: din cheie + directie compun valoarea pentru dropdown (ex. "data-desc"). */
export function formatSortPreset(sortKey: LibrarySortKey, sortDir: LibrarySortDir): string {
    return `${sortKey}-${sortDir}`;
}

/** Schimb modul grid/list, salvez si anunt si shell-ul si pagina principala. */
export function setPersistedLibraryViewMode(mode: LibraryViewMode): void {
    if (typeof window === "undefined") return;
    const s = loadLibraryUi();
    saveLibraryUi({ ...s, viewMode: mode });
    window.dispatchEvent(new CustomEvent("audiobooks-library-view-mode", { detail: { mode } }));
}

// Mai jos: "audiobook-ul de prezentare" - o carte virtuala de bun venit, tinuta tot local, per utilizator/guest.

/** Id rezervat pentru cartea de prezentare; e un string, ca sa nu se ciocneasca cu id-urile numerice din DB. */
export const WELCOME_BOOK_ID = "welcome" as const;

const WELCOME_PREFIX = "audiobooks-welcome:";

// Starea cartii de prezentare: a fost inchisa? a fost redenumita?
export type WelcomeState = { dismissed: boolean; title: string | null };

/** Citesc starea cartii de prezentare pentru utilizatorul curent. */
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
    // Salvez starea cartii de prezentare, sub o cheie specifica utilizatorului.
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(WELCOME_PREFIX + libraryStorageUserKey(), JSON.stringify(state));
    } catch {
        // Ignor erorile de scriere.
    }
}

/** Marchez cartea de prezentare ca inchisa, ca sa nu mai reapara la reincarcare. */
export function setWelcomeDismissed(): void {
    saveWelcomeState({ ...getWelcomeState(), dismissed: true });
}

/** Salvez noul titlu daca utilizatorul redenumeste cartea de prezentare. */
export function setWelcomeTitle(title: string): void {
    saveWelcomeState({ ...getWelcomeState(), title });
}

/** Scot din mapare dosarul in care e o carte; null inseamna ca e in radacina. */
export function getBookFolderId(map: Record<string, string | null>, bookId: number): string | null {
    const v = map[String(bookId)];
    return v === undefined || v === null ? null : v;
}

/** Pun o carte intr-un dosar (sau o scot la radacina daca folderId e null). Intorc o mapare noua, nu o modific pe cea veche. */
export function setBookFolderId(
    map: Record<string, string | null>,
    bookId: number,
    folderId: string | null,
): Record<string, string | null> {
    const k = String(bookId);
    const next = { ...map };
    // folderId null = scot cartea din orice dosar.
    if (folderId === null) delete next[k];
    else next[k] = folderId;
    return next;
}

/** Cand sterg un dosar, scot din mapare toate cartile care erau in el (raman in radacina). */
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
