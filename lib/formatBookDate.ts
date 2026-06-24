import type { Locale, MessageKey } from "@/lib/i18n";

type TFn = (key: MessageKey) => string;

function startOfLocalDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Etichetă scurtă pentru ultima accesare (azi / ieri / dată). */
export function formatBookAccessLabel(iso: string | null | undefined, locale: Locale, t: TFn): string {
    if (!iso) return t("library.bookNeverAccessed");
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return t("library.bookNeverAccessed");

    const today = startOfLocalDay(new Date());
    const day = startOfLocalDay(d);
    const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);

    if (diff === 0) return t("library.bookAccessedToday");
    if (diff === 1) return t("library.bookAccessedYesterday");

    const loc = locale === "en" ? "en-GB" : "ro-RO";
    const formatted = d.toLocaleDateString(loc, { day: "numeric", month: "short", year: "numeric" });
    return t("library.bookAccessed").replace("{date}", formatted);
}

/** Dată scurtă pentru generare (creat_la). */
export function formatBookCreatedLabel(iso: string | null | undefined, locale: Locale, t: TFn): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "—";
    const loc = locale === "en" ? "en-GB" : "ro-RO";
    const formatted = d.toLocaleDateString(loc, { day: "numeric", month: "short", year: "numeric" });
    return t("library.bookCreated").replace("{date}", formatted);
}

export function bookAccessTimestamp(iso: string | null | undefined): number {
    if (!iso) return 0;
    const ts = new Date(iso).getTime();
    return Number.isFinite(ts) ? ts : 0;
}
