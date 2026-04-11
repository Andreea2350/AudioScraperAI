"use client";

import { useCallback, useSyncExternalStore } from "react";
import { LANG_STORAGE_KEY } from "@/lib/localeConstants";

export type Locale = "ro" | "en";

export { LANG_STORAGE_KEY };

const LOCALE_EVENT = "audiobooks-locale-change";

/** Dictionar romanesc: fiecare cheie exista si in messagesEn (TypeScript forteaza perechile). */
export const messagesRo = {
    "login.back": "← Înapoi la început",
    "login.loading": "Se încarcă…",
    "login.registerTitle": "Înregistrare cont",
    "login.registerSubtitle": "Completează datele (cheia admin e setată de administrator).",
    "login.welcomeBack": "Bine ai venit înapoi!",
    "login.chooseRole": "Alege rolul tău pentru a continua",
    "login.email": "Email",
    "login.password": "Parolă",
    "login.roleAccount": "Rol cont",
    "login.regOptionUser": "Utilizator",
    "login.regOptionGuest": "Oaspete",
    "login.adminKey": "Cheie admin",
    "login.creating": "Se creează…",
    "login.createAccount": "Creează contul",
    "login.haveAccount": "← Am deja cont (autentificare)",
    "login.errorGeneric": "Eroare la autentificare.",
    "login.serverError": "Nu s-a putut conecta la server. Verifică că backend-ul rulează.",
    "login.serverErrorShort": "Nu s-a putut conecta la server.",
    "login.accountCreated": "Cont creat. Te poți autentifica.",
    "login.guestBlurb":
        "Poți folosi aplicația fără cont. Nu este nevoie de email sau parolă.",
    "login.continueNoAccount": "Continuă fără cont →",
    "login.opening": "Se deschide...",
    "login.emailAddress": "Adresă Email",
    "login.emailPlaceholder": "nume@exemplu.ro",
    "login.passwordLabel": "Parolă",
    "login.connecting": "Se conectează...",
    "login.enterAs": "Intră ca",
    "login.enterAsSuffix": "→",
    "login.footerNoAccount": "Nu ai cont?",
    "login.footerRegister": "Înregistrare",
    "login.footerContact": "Contactează administratorul",
    "login.brandSubtitle": "Platforma ta de ascultare inteligentă",
    "login.headline": "Transformă orice text în experiențe audio captivante.",
    "login.feature1": "Extrage text din orice URL în câteva secunde",
    "login.feature2": "Generare audio de înaltă calitate cu AI",
    "login.feature3": "Bibliotecă personală organizată și mereu la îndemână",
    "login.role.admin": "Admin",
    "login.role.adminDesc": "Acces complet",
    "login.role.user": "Utilizator",
    "login.role.userDesc": "Cont personal",
    "login.role.guest": "Oaspete",
    "login.role.guestDesc": "Fără cont",

    "intro.navLibrary": "Bibliotecă",
    "intro.navListen": "Ascultă",
    "intro.app": "Aplicație",
    "intro.auth": "Autentificare",
    "intro.register": "Înregistrare",
    "intro.heroTitle": "Creează și ascultă cărți audio",
    "intro.heroBody":
        "Extrage text din web sau documente, generează audio și alege ce publici în biblioteca deschisă mai jos — ca un mic magazin pentru ascultători.",
    "intro.startNow": "Începe acum",
    "intro.includes": "Include",
    "intro.incUrl": "✦ URL, PDF, DOCX, imagini",
    "intro.incPlaylist": "✦ Listă de redare & ordine",
    "intro.incPublish": "✦ Publică în Bibliotecă",
    "intro.listenTitle": "Ascultă din bibliotecă",
    "intro.listenDesc": "Până la patru cărți audio publice (cele mai recente din catalog).",
    "intro.loading": "Se încarcă…",
    "intro.noSamples": "Încă nu există cărți publice. După ce marchezi cărți ca „Public” în aplicație, vor apărea aici.",
    "intro.publicLibrary": "Bibliotecă publică",
    "intro.publicLibrarySub": "Cărți audio împărtășite de comunitate",
    "intro.adminBadge": "Mod admin — poți șterge din catalog",
    "intro.loadError": "Nu s-a putut încărca catalogul.",
    "intro.serverDown": "Server indisponibil.",
    "intro.emptyLibrary": "Încă nu există cărți publice.",
    "intro.emptyHint": "Utilizatorii pot bifa „Public” pe cărțile lor.",
    "intro.play": "▶ Ascultă",
    "intro.delete": "Șterge",
    "intro.footer": "AudioScraperAI — platformă audio inteligentă",
    "intro.audioUnsupported": "Browser-ul nu suportă audio HTML5.",
    "intro.confirmDelete": "Ștergi această carte din catalog și din bibliotecă?",
    "intro.deleteFail": "Eroare la ștergere.",
    "intro.networkError": "Eroare de rețea.",

    "settings.back": "← Înapoi la aplicație",
    "settings.title": "Setări și opțiuni",
    "settings.subtitleAdmin": "Cont administrator — opțiuni și drepturi extinse.",
    "settings.subtitleUser": "Personalizează experiența și consultă drepturile contului tău.",
    "settings.cardAccount": "Cont",
    "settings.displayedEmail": "Email afișat",
    "settings.guestNoEmail": "Oaspete (fără email)",
    "settings.role": "Rol",
    "settings.authNote":
        "Datele de autentificare se schimbă doar prin re-autentificare sau prin administratorul sistemului.",
    "settings.cardAppearance": "Aspect",
    "settings.appearanceHint":
        "Alege tema pentru zona principală a aplicației (meniul din stânga rămâne neschimbat).",
    "settings.light": "Luminos",
    "settings.dark": "Întunecat",
    "settings.cardLanguage": "Limbă",
    "settings.languageHint": "Schimbă limba interfeței pentru paginile publice, autentificare și setări.",
    "settings.langRo": "Română",
    "settings.langEn": "English",
    "settings.cardAdmin": "Panou administrator",
    "settings.publicCatalog": "Catalog public",
    "settings.publicCatalogBody":
        "Moderarea cărților vizibile pe pagina de start se face acolo. Poți șterge din catalog cărțile marcate public.",
    "settings.openCatalog": "Deschide catalogul public →",
    "settings.adminRegNote":
        "Înregistrarea utilizatorilor noi din aplicație folosește cheia de administrare setată în configurarea serverului (variabilă de mediu).",
    "settings.cardYourRights": "Drepturile contului tău",
    "settings.cardRights": "Drepturi",
    "settings.roleReadError": "Nu s-a putut citi rolul. Reîncarcă pagina sau autentifică-te din nou.",
    "settings.cardPublicPage": "Pagină publică",
    "settings.publicPageBody": "Catalogul deschis pentru vizitatori și materiale de prezentare.",
    "settings.openLanding": "Deschide pagina de start →",

    "role.label.admin": "Administrator",
    "role.label.user": "Utilizator",
    "role.label.guest": "Oaspete",
    "role.label.unknown": "—",
} as const;

export type MessageKey = keyof typeof messagesRo;

export const messagesEn: Record<MessageKey, string> = {
    "login.back": "← Back to start",
    "login.loading": "Loading…",
    "login.registerTitle": "Create account",
    "login.registerSubtitle": "Fill in the details (the admin key is set by your administrator).",
    "login.welcomeBack": "Welcome back!",
    "login.chooseRole": "Choose your role to continue",
    "login.email": "Email",
    "login.password": "Password",
    "login.roleAccount": "Account role",
    "login.regOptionUser": "User",
    "login.regOptionGuest": "Guest",
    "login.adminKey": "Admin key",
    "login.creating": "Creating…",
    "login.createAccount": "Create account",
    "login.haveAccount": "← I already have an account (sign in)",
    "login.errorGeneric": "Sign-in error.",
    "login.serverError": "Could not reach the server. Make sure the backend is running.",
    "login.serverErrorShort": "Could not reach the server.",
    "login.accountCreated": "Account created. You can sign in.",
    "login.guestBlurb": "You can use the app without an account. No email or password needed.",
    "login.continueNoAccount": "Continue without an account →",
    "login.opening": "Opening...",
    "login.emailAddress": "Email address",
    "login.emailPlaceholder": "you@example.com",
    "login.passwordLabel": "Password",
    "login.connecting": "Signing in...",
    "login.enterAs": "Sign in as",
    "login.enterAsSuffix": "→",
    "login.footerNoAccount": "No account?",
    "login.footerRegister": "Register",
    "login.footerContact": "Contact your administrator",
    "login.brandSubtitle": "Your smart listening platform",
    "login.headline": "Turn any text into engaging audio experiences.",
    "login.feature1": "Extract text from any URL in seconds",
    "login.feature2": "High-quality AI audio generation",
    "login.feature3": "A tidy personal library always at hand",
    "login.role.admin": "Admin",
    "login.role.adminDesc": "Full access",
    "login.role.user": "User",
    "login.role.userDesc": "Personal account",
    "login.role.guest": "Guest",
    "login.role.guestDesc": "No account",

    "intro.navLibrary": "Library",
    "intro.navListen": "Listen",
    "intro.app": "App",
    "intro.auth": "Sign in",
    "intro.register": "Register",
    "intro.heroTitle": "Create and listen to audiobooks",
    "intro.heroBody":
        "Pull text from the web or documents, generate audio, and choose what to publish in the open library below — a small storefront for listeners.",
    "intro.startNow": "Get started",
    "intro.includes": "Includes",
    "intro.incUrl": "✦ URL, PDF, DOCX, images",
    "intro.incPlaylist": "✦ Playlists & order",
    "intro.incPublish": "✦ Publish to the library",
    "intro.listenTitle": "Listen from the library",
    "intro.listenDesc": "Up to four public audiobooks (most recent in the catalog).",
    "intro.loading": "Loading…",
    "intro.noSamples":
        "No public books yet. After you mark books as “Public” in the app, they will appear here.",
    "intro.publicLibrary": "Public library",
    "intro.publicLibrarySub": "Audiobooks shared by the community",
    "intro.adminBadge": "Admin mode — you can remove from the catalog",
    "intro.loadError": "Could not load the catalog.",
    "intro.serverDown": "Server unavailable.",
    "intro.emptyLibrary": "No public books yet.",
    "intro.emptyHint": 'Users can mark their books as “Public”.',
    "intro.play": "▶ Listen",
    "intro.delete": "Delete",
    "intro.footer": "AudioScraperAI — smart audio platform",
    "intro.audioUnsupported": "Your browser does not support HTML5 audio.",
    "intro.confirmDelete": "Remove this book from the catalog and library?",
    "intro.deleteFail": "Could not delete.",
    "intro.networkError": "Network error.",

    "settings.back": "← Back to app",
    "settings.title": "Settings & options",
    "settings.subtitleAdmin": "Administrator account — extended options and permissions.",
    "settings.subtitleUser": "Customize your experience and review your account permissions.",
    "settings.cardAccount": "Account",
    "settings.displayedEmail": "Displayed email",
    "settings.guestNoEmail": "Guest (no email)",
    "settings.role": "Role",
    "settings.authNote":
        "Sign-in details change only by signing in again or through your system administrator.",
    "settings.cardAppearance": "Appearance",
    "settings.appearanceHint":
        "Choose the theme for the main app area (the left menu stays the same).",
    "settings.light": "Light",
    "settings.dark": "Dark",
    "settings.cardLanguage": "Language",
    "settings.languageHint": "Change the interface language for public pages, sign-in, and settings.",
    "settings.langRo": "Română",
    "settings.langEn": "English",
    "settings.cardAdmin": "Administrator panel",
    "settings.publicCatalog": "Public catalog",
    "settings.publicCatalogBody":
        "Moderation of books shown on the landing page happens there. You can remove public books from the catalog.",
    "settings.openCatalog": "Open public catalog →",
    "settings.adminRegNote":
        "New user registration in the app uses the admin key configured on the server (environment variable).",
    "settings.cardYourRights": "Your account permissions",
    "settings.cardRights": "Permissions",
    "settings.roleReadError": "Could not read your role. Reload the page or sign in again.",
    "settings.cardPublicPage": "Public page",
    "settings.publicPageBody": "The catalog open to visitors and showcase content.",
    "settings.openLanding": "Open landing page →",

    "role.label.admin": "Administrator",
    "role.label.user": "User",
    "role.label.guest": "Guest",
    "role.label.unknown": "—",
};

export function translate(locale: Locale, key: MessageKey): string {
    const table = locale === "en" ? messagesEn : messagesRo;
    return table[key] ?? messagesRo[key] ?? key;
}

export function applyLocaleToDocument(locale: Locale): void {
    if (typeof document === "undefined") return;
    document.documentElement.lang = locale === "en" ? "en" : "ro";
}

export function getStoredLocale(): Locale {
    if (typeof window === "undefined") return "ro";
    try {
        const v = localStorage.getItem(LANG_STORAGE_KEY);
        return v === "en" ? "en" : "ro";
    } catch {
        return "ro";
    }
}

export function setStoredLocale(locale: Locale): void {
    try {
        localStorage.setItem(LANG_STORAGE_KEY, locale);
    } catch {
        /* ignore */
    }
    applyLocaleToDocument(locale);
    if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(LOCALE_EVENT));
    }
}

function subscribeLocale(cb: () => void) {
    if (typeof window === "undefined") return () => {};
    window.addEventListener(LOCALE_EVENT, cb);
    return () => window.removeEventListener(LOCALE_EVENT, cb);
}

export function useLocale(): Locale {
    return useSyncExternalStore(subscribeLocale, getStoredLocale, () => "ro");
}

export function useI18n() {
    const locale = useLocale();
    const setLocale = useCallback((l: Locale) => setStoredLocale(l), []);
    const t = useCallback((key: MessageKey) => translate(locale, key), [locale]);
    return { locale, setLocale, t };
}

export function rightsUserList(locale: Locale): string[] {
    if (locale === "en") {
        return [
            "You only see and manage books in your personal library.",
            "You can generate audio from URLs, documents, or text.",
            'You can mark books as “Public” so they appear in the landing catalog.',
            "You can rename and delete only your own books.",
        ];
    }
    return [
        "Vezi și gestionezi doar cărțile din biblioteca ta personală.",
        "Poți genera audio din URL, documente sau text.",
        "Poți marca cărți ca „Public” ca să apară în catalogul de pe pagina de start.",
        "Poți redenumi și șterge doar propriile cărți.",
    ];
}

export function rightsGuestList(locale: Locale): string[] {
    if (locale === "en") {
        return [
            "You see books tied to your guest session.",
            "You can generate audio like a signed-in user.",
            "You cannot mark books as public in the catalog — disabled for guests.",
            "You can rename and delete only your own books.",
        ];
    }
    return [
        "Vezi cărțile asociate sesiunii tale de oaspete.",
        "Poți genera audio la fel ca un utilizator autentificat.",
        "Nu poți marca cărți ca publice în catalog — această opțiune este dezactivată pentru oaspeți.",
        "Poți redenumi și șterge doar cărțile tale.",
    ];
}

export function rightsAdminList(locale: Locale): string[] {
    if (locale === "en") {
        return [
            "You see every book in the system in the library.",
            "You can rename, delete, and set public visibility for any book.",
            "On the landing page you can remove books from the public catalog (moderation).",
            "You can create new accounts via registration with the admin key configured on the server.",
        ];
    }
    return [
        "Vezi toate cărțile din sistem în bibliotecă.",
        "Poți redenumi, șterge și seta vizibilitatea publică pentru orice carte.",
        "Pe pagina de start poți șterge cărți din catalogul public (moderare).",
        "Poți crea conturi noi prin fluxul de înregistrare, cu cheia de administrare configurată pe server.",
    ];
}

export function roleLabel(locale: Locale, rol: "admin" | "user" | "guest" | null): string {
    if (rol === "admin") return translate(locale, "role.label.admin");
    if (rol === "user") return translate(locale, "role.label.user");
    if (rol === "guest") return translate(locale, "role.label.guest");
    return translate(locale, "role.label.unknown");
}
