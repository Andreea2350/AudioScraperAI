"use client";

/**
 * Setari cont: tema, limba (localStorage + eveniment global), drepturi explicate pe rol, link catre catalog public.
 */
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { LanguageToggle } from "@/components/LanguageToggle";
import { rightsAdminList, rightsGuestList, rightsUserList, roleLabel, useI18n } from "@/lib/i18n";
import { applyTheme, readDomTheme } from "@/lib/theme";

type RolUtilizator = "admin" | "user" | "guest" | null;

function Card({
    titlu,
    copii,
}: {
    titlu: string;
    copii: ReactNode;
}) {
    return (
        <section
            className="rounded-2xl p-6 lg:p-7"
            style={{
                background: "var(--card-bg)",
                border: "1px solid var(--border-card)",
                boxShadow: "var(--shadow-card-sm)",
            }}
        >
            <h2 className="text-lg font-extrabold" style={{ color: "var(--heading-on-surface)" }}>
                {titlu}
            </h2>
            <div className="mt-4">{copii}</div>
        </section>
    );
}

function ListaDrepturi({ elemente }: { elemente: string[] }) {
    return (
        <ul className="list-inside list-disc space-y-2 text-sm" style={{ color: "var(--text-body)" }}>
            {elemente.map((linie) => (
                <li key={linie}>{linie}</li>
            ))}
        </ul>
    );
}

export default function PaginaSetari() {
    const { locale, t } = useI18n();
    const [rol, setRol] = useState<RolUtilizator>(null);
    const [email, setEmail] = useState<string>("");
    const [tema, setTema] = useState<"light" | "dark">("light");

    useEffect(() => {
        setRol((typeof window !== "undefined" ? localStorage.getItem("rol") : null) as RolUtilizator);
        setEmail(typeof window !== "undefined" ? localStorage.getItem("email") || "" : "");
        setTema(readDomTheme());
    }, []);

    const seteazaTema = (mode: "light" | "dark") => {
        applyTheme(mode);
        setTema(mode);
    };

    const esteAdmin = rol === "admin";
    const esteUser = rol === "user";
    const esteGuest = rol === "guest";

    const drepturiUser = rightsUserList(locale);
    const drepturiGuest = rightsGuestList(locale);
    const drepturiAdmin = rightsAdminList(locale);

    return (
        <div className="mx-auto max-w-2xl px-4 py-8 lg:px-8 lg:py-10" style={{ animation: "fade-in 0.3s ease-out" }}>
            <Link
                href="/"
                className="mb-6 inline-flex text-xs font-extrabold uppercase tracking-widest transition-colors"
                style={{ color: "var(--text-muted)" }}
            >
                {t("settings.back")}
            </Link>

            <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: "var(--text-primary)" }}>
                {t("settings.title")}
            </h1>
            <p className="mt-2 text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                {esteAdmin ? t("settings.subtitleAdmin") : t("settings.subtitleUser")}
            </p>

            <div className="mt-8 space-y-6">
                <Card
                    titlu={t("settings.cardAccount")}
                    copii={
                        <>
                            <p className="text-xs font-extrabold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                                {t("settings.displayedEmail")}
                            </p>
                            <p className="mt-1 font-semibold" style={{ color: "var(--text-primary)" }}>
                                {email.trim() || (esteGuest ? t("settings.guestNoEmail") : "—")}
                            </p>
                            <p className="mt-4 text-xs font-extrabold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                                {t("settings.role")}
                            </p>
                            <p className="mt-1 font-semibold capitalize" style={{ color: "var(--text-primary)" }}>
                                {roleLabel(locale, rol)}
                                {rol ? (
                                    <span
                                        className="ml-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-extrabold tracking-widest uppercase"
                                        style={{
                                            background:
                                                rol === "admin"
                                                    ? "rgba(196,147,63,0.14)"
                                                    : rol === "guest"
                                                      ? "rgba(58,143,181,0.14)"
                                                      : "rgba(64,138,113,0.14)",
                                            color:
                                                rol === "admin"
                                                    ? "#C4933F"
                                                    : rol === "guest"
                                                      ? "#3A8FB5"
                                                      : "#408A71",
                                        }}
                                    >
                                        {rol}
                                    </span>
                                ) : null}
                            </p>
                            <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--text-faint)" }}>
                                {t("settings.authNote")}
                            </p>
                        </>
                    }
                />

                <Card
                    titlu={t("settings.cardLanguage")}
                    copii={
                        <>
                            <p className="text-sm" style={{ color: "var(--text-body)" }}>
                                {t("settings.languageHint")}
                            </p>
                            <div className="mt-4">
                                <LanguageToggle />
                            </div>
                        </>
                    }
                />

                <Card
                    titlu={t("settings.cardAppearance")}
                    copii={
                        <>
                            <p className="text-sm" style={{ color: "var(--text-body)" }}>
                                {t("settings.appearanceHint")}
                            </p>
                            <div className="mt-4 flex flex-wrap gap-3">
                                <button
                                    type="button"
                                    onClick={() => seteazaTema("light")}
                                    className="rounded-xl px-5 py-2.5 text-sm font-extrabold transition-all duration-200"
                                    style={{
                                        background: tema === "light" ? "linear-gradient(135deg, #408A71, #285A48)" : "var(--card-bg-muted)",
                                        color: tema === "light" ? "#fff" : "var(--text-body)",
                                        border: `2px solid ${tema === "light" ? "transparent" : "var(--border-card)"}`,
                                        boxShadow: tema === "light" ? "var(--shadow-btn-sm)" : "none",
                                    }}
                                >
                                    {t("settings.light")}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => seteazaTema("dark")}
                                    className="rounded-xl px-5 py-2.5 text-sm font-extrabold transition-all duration-200"
                                    style={{
                                        background: tema === "dark" ? "linear-gradient(135deg, #408A71, #285A48)" : "var(--card-bg-muted)",
                                        color: tema === "dark" ? "#fff" : "var(--text-body)",
                                        border: `2px solid ${tema === "dark" ? "transparent" : "var(--border-card)"}`,
                                        boxShadow: tema === "dark" ? "var(--shadow-btn-sm)" : "none",
                                    }}
                                >
                                    {t("settings.dark")}
                                </button>
                            </div>
                        </>
                    }
                />

                {esteAdmin ? (
                    <Card
                        titlu={t("settings.cardAdmin")}
                        copii={
                            <>
                                <ListaDrepturi elemente={drepturiAdmin} />
                                <div
                                    className="mt-5 rounded-xl p-4 text-sm"
                                    style={{
                                        background: "var(--card-bg-muted)",
                                        border: "1px solid var(--border-card)",
                                        color: "var(--text-body)",
                                    }}
                                >
                                    <p className="font-bold" style={{ color: "var(--heading-on-surface)" }}>
                                        {t("settings.publicCatalog")}
                                    </p>
                                    <p className="mt-1">{t("settings.publicCatalogBody")}</p>
                                    <Link
                                        href="/intro#biblioteca-publica"
                                        className="mt-3 inline-flex rounded-xl px-4 py-2 text-sm font-extrabold text-white transition-opacity hover:opacity-95"
                                        style={{
                                            background: "linear-gradient(135deg, #408A71, #285A48)",
                                            boxShadow: "var(--shadow-btn-sm)",
                                        }}
                                    >
                                        {t("settings.openCatalog")}
                                    </Link>
                                </div>
                                <p className="mt-4 text-xs leading-relaxed" style={{ color: "var(--text-faint)" }}>
                                    {t("settings.adminRegNote")}
                                </p>
                            </>
                        }
                    />
                ) : null}

                {(esteUser || esteGuest) && !esteAdmin ? (
                    <Card
                        titlu={t("settings.cardYourRights")}
                        copii={
                            <ListaDrepturi elemente={esteGuest ? drepturiGuest : drepturiUser} />
                        }
                    />
                ) : null}

                {!esteAdmin && !esteUser && !esteGuest ? (
                    <Card
                        titlu={t("settings.cardRights")}
                        copii={
                            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                                {t("settings.roleReadError")}
                            </p>
                        }
                    />
                ) : null}

                <Card
                    titlu={t("settings.cardPublicPage")}
                    copii={
                        <>
                            <p className="text-sm" style={{ color: "var(--text-body)" }}>
                                {t("settings.publicPageBody")}
                            </p>
                            <Link
                                href="/intro"
                                className="mt-4 inline-flex text-sm font-bold transition-colors"
                                style={{ color: "var(--link-accent)" }}
                            >
                                {t("settings.openLanding")}
                            </Link>
                        </>
                    }
                />
            </div>
        </div>
    );
}
