"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { API_BASE, authHeadersJson } from "@/lib/api";
import { LanguageToggle } from "@/components/LanguageToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useI18n } from "@/lib/i18n";

type CartePublica = {
    id: number;
    titlu: string;
    url: string;
    audio_link: string;
    creat_la: string;
};

/**
 * Pagina publica de prezentare: lista cartilor cu is_public, link catre login/register.
 * Daca esti logat ca admin, apare buton de stergere; verificarea reala e tot pe backend.
 */
export default function IntroPage() {
    const { t } = useI18n();
    const [carti, setCarti] = useState<CartePublica[]>([]);
    const [incarcare, setIncarcare] = useState(true);
    const [eroare, setEroare] = useState<string | null>(null);
    const [rol, setRol] = useState<string | null>(null);
    const [token, setToken] = useState<string | null>(null);

    const reincarcaCatalog = useCallback(async () => {
        setIncarcare(true);
        setEroare(null);
        try {
            const res = await fetch(`${API_BASE}/carti/publice`);
            const json = await res.json();
            if (json.status === "success" && Array.isArray(json.data)) {
                setCarti(json.data);
            } else {
                setEroare(t("intro.loadError"));
            }
        } catch {
            setEroare(t("intro.serverDown"));
        } finally {
            setIncarcare(false);
        }
    }, [t]);

    useEffect(() => {
        setRol(typeof window !== "undefined" ? localStorage.getItem("rol") : null);
        setToken(typeof window !== "undefined" ? localStorage.getItem("token") : null);
        void reincarcaCatalog();
    }, [reincarcaCatalog]);

    /** Sterge definitiv o carte publica (doar backend verifica rol admin). */
    const adminStergeDinCatalog = async (id: number) => {
        if (!confirm(t("intro.confirmDelete"))) return;
        try {
            const res = await fetch(`${API_BASE}/admin/carti-publice/${id}`, {
                method: "DELETE",
                headers: authHeadersJson(),
            });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) {
                alert(typeof j.detail === "string" ? j.detail : t("intro.deleteFail"));
                return;
            }
            setCarti((c) => c.filter((x) => x.id !== id));
        } catch {
            alert(t("intro.networkError"));
        }
    };

    const scrollLaBiblioteca = () => {
        document.getElementById("biblioteca-publica")?.scrollIntoView({ behavior: "smooth" });
    };

    /** Subset mic pentru sectiunea "Asculta": aceleasi date ca grid-ul mare, doar primele patru. */
    const patruAscultari = carti.slice(0, 4);

    return (
        <div className="min-h-screen flex flex-col" style={{ backgroundColor: "var(--page-bg)" }}>
            {/* Header fix cu tema verde */}
            <header
                className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 px-5 py-4 lg:px-10"
                style={{
                    background: "linear-gradient(135deg, #1a3d2f 0%, #285A48 55%, #408A71 100%)",
                    boxShadow: "var(--shadow-intro-header)",
                }}
            >
                <div className="flex items-center gap-6">
                    <span className="text-xl font-extrabold tracking-wide text-white">
                        AudioScraper<span style={{ color: "#B0E4CC" }}>AI</span>
                    </span>
                    <button
                        type="button"
                        onClick={scrollLaBiblioteca}
                        className="text-sm font-bold text-white/90 hover:text-white transition-colors"
                    >
                        {t("intro.navLibrary")}
                    </button>
                    <button
                        type="button"
                        onClick={() =>
                            document.getElementById("asculta-mostre")?.scrollIntoView({ behavior: "smooth" })
                        }
                        className="text-sm font-bold text-white/90 hover:text-white transition-colors"
                    >
                        {t("intro.navListen")}
                    </button>
                </div>
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
                            <li>{t("intro.incPublish")}</li>
                        </ul>
                    </div>
                </div>
            </section>

            {/*
              Sectiune cu pana la 4 playere: aceeasi sursa ca biblioteca (GET /carti/publice), folosita si ca tinta pentru scroll din header.
            */}
            <section
                id="asculta-mostre"
                className="px-5 lg:px-10 pb-12 scroll-mt-20"
                aria-label={t("intro.listenTitle")}
            >
                <div className="max-w-6xl mx-auto">
                    <h2 className="text-xl sm:text-2xl font-extrabold mb-2" style={{ color: "var(--heading-on-surface)" }}>
                        {t("intro.listenTitle")}
                    </h2>
                    <p className="text-sm font-medium mb-6" style={{ color: "var(--text-muted)" }}>
                        {t("intro.listenDesc")}
                    </p>
                    {incarcare ? (
                        <p className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>{t("intro.loading")}</p>
                    ) : patruAscultari.length === 0 ? (
                        <p
                            className="text-sm font-medium rounded-2xl border border-dashed p-8 text-center"
                            style={{ color: "var(--text-muted)", borderColor: "var(--divider)" }}
                        >
                            {t("intro.noSamples")}
                        </p>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                            {patruAscultari.map((c) => (
                                <div
                                    key={c.id}
                                    className="rounded-2xl p-5 border"
                                    style={{
                                        background: "var(--card-bg)",
                                        borderColor: "var(--border-card)",
                                        boxShadow: "var(--shadow-card-sm)",
                                    }}
                                >
                                    <p className="font-extrabold mb-3 leading-snug line-clamp-2" style={{ color: "var(--text-primary)" }}>
                                        {c.titlu}
                                    </p>
                                    <audio
                                        controls
                                        preload="metadata"
                                        className="w-full h-10"
                                        src={c.audio_link}
                                    >
                                        {t("intro.audioUnsupported")}
                                    </audio>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </section>

            <section id="biblioteca-publica" className="px-5 lg:px-10 pb-20 scroll-mt-20">
                <div className="flex items-end justify-between gap-4 mb-8 flex-wrap">
                    <div>
                        <h2 className="text-2xl font-extrabold" style={{ color: "var(--heading-on-surface)" }}>
                            {t("intro.publicLibrary")}
                        </h2>
                        <p className="text-sm font-medium mt-1" style={{ color: "var(--text-muted)" }}>
                            {t("intro.publicLibrarySub")}
                        </p>
                    </div>
                    {rol === "admin" && (
                        <span className="text-xs font-extrabold uppercase tracking-wider px-2 py-1 rounded-lg bg-amber-light/50 text-amber">
                            {t("intro.adminBadge")}
                        </span>
                    )}
                </div>

                {eroare && (
                    <p className="text-sm font-medium mb-4" style={{ color: "#b04060" }}>
                        {eroare}
                    </p>
                )}
                {incarcare ? (
                    <p className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>{t("intro.loading")}</p>
                ) : carti.length === 0 ? (
                    <div
                        className="rounded-2xl p-12 text-center border border-dashed"
                        style={{ borderColor: "rgba(64,138,113,0.25)" }}
                    >
                        <p className="font-bold" style={{ color: "var(--text-body)" }}>{t("intro.emptyLibrary")}</p>
                        <p className="text-sm mt-2" style={{ color: "var(--text-muted)" }}>{t("intro.emptyHint")}</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                        {carti.map((c) => (
                            <div
                                key={c.id}
                                className="rounded-2xl overflow-hidden flex flex-col relative"
                                style={{
                                    background: "var(--card-bg)",
                                    border: "1px solid var(--border-card)",
                                    boxShadow: "var(--shadow-card-sm)",
                                }}
                            >
                                <div className="p-5 flex flex-col flex-1">
                                    <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 text-lg bg-surface-green">
                                        🎧
                                    </div>
                                    <h3 className="font-extrabold mb-2 leading-snug" style={{ color: "var(--text-primary)" }}>{c.titlu}</h3>
                                    <p className="text-xs truncate mb-4 flex-1" style={{ color: "var(--text-muted)" }} title={c.url}>
                                        {c.url}
                                    </p>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <a
                                            href={c.audio_link}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex flex-1 min-w-[120px] justify-center px-4 py-2.5 rounded-xl text-sm font-extrabold text-white"
                                            style={{ background: "linear-gradient(135deg, #408A71, #285A48)" }}
                                        >
                                            {t("intro.play")}
                                        </a>
                                        {rol === "admin" && token ? (
                                            <button
                                                type="button"
                                                onClick={() => void adminStergeDinCatalog(c.id)}
                                                className="px-3 py-2 rounded-xl text-xs font-extrabold border-2 hover:opacity-90"
                                                style={{ borderColor: "#C25B6F", color: "#C25B6F" }}
                                            >
                                                {t("intro.delete")}
                                            </button>
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <footer
                className="mt-auto py-8 text-center text-xs font-medium border-t"
                style={{ color: "var(--text-faint)", borderColor: "var(--divider)" }}
            >
                {t("intro.footer")}
            </footer>
        </div>
    );
}
