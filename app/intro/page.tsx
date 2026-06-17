"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LanguageToggle } from "@/components/LanguageToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useI18n } from "@/lib/i18n";

/**
 * Pagina publica de prezentare: descriere produs si link catre login/register.
 * Fara catalog de carti partajate (biblioteca ramane strict personala).
 */
export default function IntroPage() {
    const { t } = useI18n();
    const [token, setToken] = useState<string | null>(null);

    useEffect(() => {
        setToken(typeof window !== "undefined" ? localStorage.getItem("token") : null);
    }, []);

    return (
        <div className="min-h-screen flex flex-col" style={{ backgroundColor: "var(--page-bg)" }}>
            {/* Header fix: navigare, tema, limba, CTA auth */}
            <header
                className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 px-5 py-4 lg:px-10"
                style={{
                    background: "linear-gradient(135deg, #1a3d2f 0%, #285A48 55%, #408A71 100%)",
                    boxShadow: "var(--shadow-intro-header)",
                }}
            >
                <span className="text-xl font-extrabold tracking-wide text-white">
                    AudioScraper<span style={{ color: "#B0E4CC" }}>AI</span>
                </span>
                <div className="flex items-center gap-2 sm:gap-3">
                    <LanguageToggle onBrandBar />
                    <ThemeToggle onBrandBar />
                    {token ? (
                        <Link
                            href="/"
                            className="px-4 py-2 rounded-xl text-sm font-extrabold text-white border border-white/30 hover:bg-white/10 transition-colors"
                        >
                            {t("intro.app")}
                        </Link>
                    ) : null}
                    <Link
                        href="/login"
                        className="px-4 py-2 rounded-xl text-sm font-bold text-white/90 hover:text-white transition-colors"
                    >
                        {t("intro.auth")}
                    </Link>
                    <Link
                        href="/login?inregistrare=1"
                        className="px-5 py-2 rounded-xl text-sm font-extrabold text-white transition-transform hover:scale-[1.02]"
                        style={{
                            background: "linear-gradient(135deg, #B0E4CC, #7dcda8)",
                            color: "#091413",
                            boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
                        }}
                    >
                        {t("intro.register")}
                    </Link>
                </div>
            </header>

            {/* Sectiune hero: titlu, descriere, CTA start */}
            <section
                className="px-5 lg:px-10 py-12 lg:py-16 flex flex-col lg:flex-row gap-12 lg:gap-16"
                style={{
                    background: "linear-gradient(180deg, var(--player-well-a) 0%, var(--page-bg) 100%)",
                }}
            >
                <div className="flex-1 max-w-xl">
                    <h1 className="text-3xl sm:text-4xl font-extrabold mb-4" style={{ color: "var(--text-primary)" }}>
                        {t("intro.heroTitle")}
                    </h1>
                    <p className="text-sm sm:text-base font-medium leading-relaxed mb-8" style={{ color: "var(--text-muted)" }}>
                        {t("intro.heroBody")}
                    </p>
                    {!token && (
                        <div className="flex flex-wrap gap-3">
                            <Link
                                href="/login"
                                className="inline-flex px-6 py-3 rounded-2xl font-extrabold text-sm text-white"
                                style={{
                                    background: "linear-gradient(135deg, #408A71, #285A48)",
                                    boxShadow: "var(--shadow-btn-primary)",
                                }}
                            >
                                {t("intro.startNow")}
                            </Link>
                        </div>
                    )}
                </div>
                <div className="flex-1 flex items-center justify-center">
                    <div
                        className="w-full max-w-sm rounded-3xl p-8 text-center"
                        style={{
                            background: "linear-gradient(145deg, #091413 0%, #285A48 100%)",
                            boxShadow: "var(--shadow-card-lg)",
                        }}
                    >
                        <p className="text-white/80 text-sm font-medium mb-2">{t("intro.includes")}</p>
                        <ul className="text-left text-sm text-white/90 space-y-2 font-medium">
                            <li>{t("intro.incUrl")}</li>
                            <li>{t("intro.incPlaylist")}</li>
                            <li>{t("intro.incVoices")}</li>
                        </ul>
                    </div>
                </div>
            </section>

            {/* Footer pagina landing */}
            <footer
                className="mt-auto py-8 text-center text-xs font-medium border-t"
                style={{ color: "var(--text-faint)", borderColor: "var(--divider)" }}
            >
                {t("intro.footer")}
            </footer>
        </div>
    );
}
