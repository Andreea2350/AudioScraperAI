import type { Locale, MessageKey } from "@/lib/i18n";

/**
 * Functii care transforma datele (ISO) ale cartilor in etichete prietenoase, traduse si localizate:
 * "azi", "ieri" sau o data scurta de tip "12 mar. 2026".
 */

// Functia de traducere (i18n) primita din componente.
type TFn = (key: MessageKey) => string;

function startOfLocalDay(d: Date): Date {
    // Intorc inceputul zilei (ora 00:00) in fusul local, ca sa pot compara zile, nu momente exacte.
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Eticheta pentru "ultima accesare": azi / ieri / data scurta. */
export function formatBookAccessLabel(iso: string | null | undefined, locale: Locale, t: TFn): string {
    // Fara data inseamna ca nu a fost deschisa niciodata.
    if (!iso) return t("library.bookNeverAccessed");
    const d = new Date(iso);
    // Data invalida o tratez la fel ca lipsa ei.
    if (!Number.isFinite(d.getTime())) return t("library.bookNeverAccessed");

    // Calculez diferenta in zile intre azi si ziua accesarii.
    const today = startOfLocalDay(new Date());
    const day = startOfLocalDay(d);
    const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);  // 86.400.000 ms = o zi

    if (diff === 0) return t("library.bookAccessedToday");
    if (diff === 1) return t("library.bookAccessedYesterday");

    // Pentru zile mai vechi, afisez o data scurta formatata in functie de limba.
    const loc = locale === "en" ? "en-GB" : "ro-RO";
    const formatted = d.toLocaleDateString(loc, { day: "numeric", month: "short", year: "numeric" });
    return t("library.bookAccessed").replace("{date}", formatted);
}

/** Eticheta pentru data crearii cartii (creat_la). */
export function formatBookCreatedLabel(iso: string | null | undefined, locale: Locale, t: TFn): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "—";
    const loc = locale === "en" ? "en-GB" : "ro-RO";
    const formatted = d.toLocaleDateString(loc, { day: "numeric", month: "short", year: "numeric" });
    return t("library.bookCreated").replace("{date}", formatted);
}

/** Intorc data accesarii ca numar (timestamp), folosit la sortare. 0 daca lipseste sau e invalida. */
export function bookAccessTimestamp(iso: string | null | undefined): number {
    if (!iso) return 0;
    const ts = new Date(iso).getTime();
    return Number.isFinite(ts) ? ts : 0;
}
