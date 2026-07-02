"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { LanguageToggle } from "@/components/LanguageToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandLogo } from "@/components/BrandLogo";
import { VoiceShowcaseGrid } from "@/components/landing/VoiceShowcaseGrid";
import {
    IconBook,
    IconCheck,
    IconClean,
    IconDocument,
    IconDownload,
    IconHeadphones,
    IconImage,
    IconLink,
    IconPlaylist,
    IconRead,
    IconSparkle,
    IconSummary,
    IconText,
} from "@/components/landing/LandingIcons";
import { ttsPreviewUrl } from "@/lib/api";
import { playLandingPreview, stopLandingPreview, subscribeLandingPreviewStop } from "@/lib/landingPreviewAudio";
import { useI18n } from "@/lib/i18n";

const DEMO_VOICE_RO = "ro-RO-AlinaNeural";
const DEMO_VOICE_EN = "en-US-JennyNeural";

function LandingHeader() {
    const { t } = useI18n();
    return (
        <header
            className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 px-5 py-4 lg:px-12"
            style={{
                background: "linear-gradient(135deg, #1a3d2f 0%, #285A48 55%, #408A71 100%)",
                boxShadow: "var(--shadow-intro-header)",
            }}
        >
            <Link href="/" className="text-xl font-extrabold tracking-wide text-white">
                <BrandLogo />
            </Link>
            <div className="flex items-center gap-2 sm:gap-3">
                <LanguageToggle onBrandBar />
                <ThemeToggle onBrandBar />
                <Link
                    href="/login"
                    className="px-4 py-2 rounded-xl text-sm font-bold text-white/90 hover:text-white transition-colors"
                >
                    {t("intro.auth")}
                </Link>
                <Link
                    href="/login?inregistrare=1"
                    className="px-5 py-2 rounded-xl text-sm font-extrabold transition-transform hover:scale-[1.02]"
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
    );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
    return (
        <div className="text-center max-w-2xl mx-auto mb-10 lg:mb-12">
            <h2 className="text-2xl font-extrabold sm:text-3xl" style={{ color: "var(--text-primary)" }}>
                {title}
            </h2>
            {subtitle ? (
                <p className="mt-3 text-sm sm:text-base font-medium leading-relaxed" style={{ color: "var(--text-muted)" }}>
                    {subtitle}
                </p>
            ) : null}
        </div>
    );
}

function IconBubble({ children }: { children: ReactNode }) {
    return (
        <span
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl"
            style={{ background: "rgba(64,138,113,0.12)", color: "#408A71" }}
        >
            {children}
        </span>
    );
}

function SectionCard({ title, body, icon }: { title: string; body: string; icon: ReactNode }) {
    return (
        <div
            className="rounded-2xl border p-5 lg:p-6 h-full"
            style={{
                background: "var(--card-bg)",
                borderColor: "var(--border-card)",
                boxShadow: "var(--shadow-card-sm)",
            }}
        >
            <IconBubble>{icon}</IconBubble>
            <h3 className="mt-4 text-base font-extrabold" style={{ color: "var(--heading-on-surface)" }}>
                {title}
            </h3>
            <p className="mt-2 text-sm font-medium leading-relaxed" style={{ color: "var(--text-muted)" }}>
                {body}
            </p>
        </div>
    );
}

function PricingCard({
    title,
    price,
    features,
    premium,
    badge,
    cta,
}: {
    title: string;
    price: string;
    features: string[];
    premium?: boolean;
    badge?: string;
    cta?: ReactNode;
}) {
    const accentClass = premium ? "pricing-premium-check" : undefined;
    const accent = premium ? undefined : "#408A71";

    return (
        <div
            className={`relative flex flex-col rounded-2xl border p-6 lg:p-7 h-full ${
                premium ? "pricing-card-premium md:scale-[1.04] md:-my-1 z-10" : ""
            }`}
            style={
                premium
                    ? undefined
                    : {
                          background: "var(--card-bg)",
                          borderColor: "var(--border-card)",
                          borderWidth: 1,
                      }
            }
        >
            {badge ? (
                <span
                    className={`pricing-card-badge absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full px-3.5 py-1 text-xs font-extrabold uppercase tracking-wide whitespace-nowrap ${
                        premium ? "pricing-badge-premium" : ""
                    }`}
                    style={
                        premium
                            ? undefined
                            : { background: "#408A71", color: "#fff" }
                    }
                >
                    {badge}
                </span>
            ) : null}
            <div className="relative flex items-center gap-2 z-[1]">
                {premium ? (
                    <svg
                        className="pricing-premium-star h-5 w-5 shrink-0"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden
                    >
                        <path d="M12 2l2.4 7.4H22l-6 4.6 2.3 7L12 17.8 5.7 21.2 8 14 2 9.4h7.6L12 2z" />
                    </svg>
                ) : null}
                <h3 className="text-lg font-extrabold" style={{ color: "var(--heading-on-surface)" }}>
                    {title}
                </h3>
            </div>
            <p
                className={`relative mt-2 text-2xl font-extrabold ${premium ? "pricing-premium-price" : ""}`}
                style={premium ? undefined : { color: "#408A71" }}
            >
                {price}
            </p>
            <ul className="relative mt-5 flex-1 space-y-3">
                {features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                        <span className={`mt-0.5 shrink-0 ${accentClass ?? ""}`} style={accent ? { color: accent } : undefined}>
                            <IconCheck />
                        </span>
                        <span>{f}</span>
                    </li>
                ))}
            </ul>
            {cta ? <div className="relative mt-6">{cta}</div> : null}
        </div>
    );
}

function PlayIcon({ playing }: { playing: boolean }) {
    if (playing) {
        return (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
        );
    }
    return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M8 5v14l11-7z" />
        </svg>
    );
}

export default function LandingPage() {
    const { t, locale } = useI18n();
    const [demoPlaying, setDemoPlaying] = useState(false);  // canta acum demo-ul audio principal?

    // Daca un alt buton de preview porneste (din grila de voci), playerul comun ma anunta sa-mi opresc demo-ul.
    useEffect(() => {
        return subscribeLandingPreviewStop(() => setDemoPlaying(false));
    }, []);

    // Aleg vocea demo dupa limba interfetei (engleza sau romana).
    const demoVoice = locale === "en" ? DEMO_VOICE_EN : DEMO_VOICE_RO;

    const toggleDemo = async () => {
        // Daca demo-ul canta deja, butonul devine "stop".
        if (demoPlaying) {
            stopLandingPreview();
            setDemoPlaying(false);
            return;
        }
        // Altfel pornesc preview-ul; setez "playing" doar daca chiar a inceput sa cante.
        const ok = await playLandingPreview(ttsPreviewUrl(demoVoice, locale));
        setDemoPlaying(ok);
    };

    const steps = [
        { n: "1", title: t("intro.step1Title"), body: t("intro.step1Body"), icon: <IconDownload /> },
        { n: "2", title: t("intro.step2Title"), body: t("intro.step2Body"), icon: <IconSparkle /> },
        { n: "3", title: t("intro.step3Title"), body: t("intro.step3Body"), icon: <IconHeadphones /> },
    ];

    const formats = [
        { icon: <IconLink className="h-5 w-5" />, label: t("intro.formatUrl") },
        { icon: <IconDocument className="h-5 w-5" />, label: t("intro.formatDoc") },
        { icon: <IconText className="h-5 w-5" />, label: t("intro.formatText") },
        { icon: <IconImage className="h-5 w-5" />, label: t("intro.formatImage") },
        { icon: <IconPlaylist className="h-5 w-5" />, label: t("intro.formatPlaylist") },
    ];

    const benefits = [
        { icon: <IconClean />, title: t("intro.benefitAiTitle"), body: t("intro.benefitAiBody") },
        { icon: <IconBook />, title: t("intro.benefitLongTitle"), body: t("intro.benefitLongBody") },
        { icon: <IconSummary />, title: t("intro.benefitSummaryTitle"), body: t("intro.benefitSummaryBody") },
        { icon: <IconRead />, title: t("intro.benefitReadTitle"), body: t("intro.benefitReadBody") },
    ];

    const heroIncludes = [t("intro.incUrl"), t("intro.incPlaylist"), t("intro.incVoices")];

    return (
        <div className="min-h-screen flex flex-col" style={{ backgroundColor: "var(--page-bg)" }}>
            <LandingHeader />

            {/* Hero */}
            <section
                className="px-5 lg:px-12 py-14 lg:py-20"
                style={{
                    background: "linear-gradient(180deg, var(--player-well-a) 0%, var(--page-bg) 85%)",
                }}
            >
                <div className="mx-auto max-w-6xl flex flex-col lg:flex-row gap-12 lg:gap-16 items-center overflow-x-hidden">
                    <div className="flex-1 max-w-xl lg:max-w-none">
                        <h1
                            className="text-3xl sm:text-4xl lg:text-[2.75rem] font-extrabold mb-5 leading-[1.15]"
                            style={{ color: "var(--text-primary)" }}
                        >
                            {t("intro.heroTitle")}
                        </h1>
                        <p className="text-sm sm:text-base font-medium leading-relaxed mb-8 max-w-lg" style={{ color: "var(--text-muted)" }}>
                            {t("intro.heroBody")}
                        </p>
                        <div className="flex flex-wrap gap-3 mb-6">
                            <Link
                                href="/login"
                                className="inline-flex px-6 py-3 rounded-2xl font-extrabold text-sm text-white transition-transform hover:scale-[1.02]"
                                style={{
                                    background: "linear-gradient(135deg, #408A71, #285A48)",
                                    boxShadow: "var(--shadow-btn-primary)",
                                }}
                            >
                                {t("intro.startNow")}
                            </Link>
                            <button
                                type="button"
                                onClick={() => void toggleDemo()}
                                className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl font-extrabold text-sm border-2 transition-colors hover:border-[#408A71]/40"
                                style={{
                                    borderColor: "var(--border-card)",
                                    color: "var(--heading-on-surface)",
                                    background: "var(--card-bg)",
                                }}
                            >
                                <PlayIcon playing={demoPlaying} />
                                {t("intro.demoListen")}
                            </button>
                        </div>
                        <a
                            href="#voices"
                            className="text-sm font-bold underline-offset-2 hover:underline"
                            style={{ color: "var(--link-accent)" }}
                        >
                            {t("intro.voicesJump")}
                        </a>
                    </div>
                    <div className="flex-1 w-full max-w-md lg:max-w-lg">
                        <div
                            className="w-full rounded-3xl p-8 lg:p-9"
                            style={{
                                background: "linear-gradient(145deg, #091413 0%, #285A48 100%)",
                                boxShadow: "var(--shadow-card-lg)",
                            }}
                        >
                            <p className="text-white/80 text-sm font-semibold mb-4">{t("intro.includes")}</p>
                            <ul className="text-left space-y-3">
                                {heroIncludes.map((item) => (
                                    <li key={item} className="flex items-start gap-3 text-sm text-white/90 font-medium">
                                        <IconCheck className="mt-0.5 text-[#B0E4CC]" />
                                        <span className="min-w-0">{item}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            </section>

            <VoiceShowcaseGrid />

            {/* Cum funcționează */}
            <section className="px-5 py-16 lg:py-20 lg:px-12" style={{ background: "var(--card-bg-muted)" }}>
                <div className="mx-auto max-w-6xl">
                    <SectionHeading title={t("intro.howTitle")} subtitle={t("intro.howSubtitle")} />
                    <div className="grid gap-6 md:grid-cols-3">
                        {steps.map((s) => (
                            <div
                                key={s.n}
                                className="rounded-2xl border p-6 h-full"
                                style={{ background: "var(--card-bg)", borderColor: "var(--border-card)" }}
                            >
                                <IconBubble>{s.icon}</IconBubble>
                                <p className="mt-4 text-xs font-extrabold uppercase tracking-widest" style={{ color: "#408A71" }}>
                                    {t("intro.stepLabel").replace("{n}", s.n)}
                                </p>
                                <h3 className="mt-1 text-lg font-extrabold" style={{ color: "var(--heading-on-surface)" }}>
                                    {s.title}
                                </h3>
                                <p className="mt-2 text-sm font-medium leading-relaxed" style={{ color: "var(--text-muted)" }}>
                                    {s.body}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Formate */}
            <section className="px-5 py-16 lg:py-20 lg:px-12">
                <div className="mx-auto max-w-6xl">
                    <SectionHeading title={t("intro.formatsTitle")} subtitle={t("intro.formatsSubtitle")} />
                    <div className="flex flex-wrap justify-center gap-3">
                        {formats.map((f) => (
                            <span
                                key={f.label}
                                className="inline-flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-semibold"
                                style={{
                                    background: "var(--card-bg)",
                                    borderColor: "var(--border-card)",
                                    color: "var(--text-body)",
                                }}
                            >
                                <span style={{ color: "#408A71" }} aria-hidden>
                                    {f.icon}
                                </span>
                                {f.label}
                            </span>
                        ))}
                    </div>
                </div>
            </section>

            {/* Beneficii */}
            <section className="px-5 py-16 lg:py-20 lg:px-12" style={{ background: "var(--card-bg-muted)" }}>
                <div className="mx-auto max-w-6xl">
                    <SectionHeading title={t("intro.benefitsTitle")} subtitle={t("intro.benefitsSubtitle")} />
                    <div className="grid gap-5 sm:grid-cols-2">
                        {benefits.map((b) => (
                            <SectionCard key={b.title} icon={b.icon} title={b.title} body={b.body} />
                        ))}
                    </div>
                </div>
            </section>

            {/* Planuri */}
            <section id="plans" className="px-5 py-16 lg:py-20 lg:px-12">
                <div className="mx-auto max-w-6xl">
                    <SectionHeading title={t("intro.plansTitle")} subtitle={t("intro.plansSubtitle")} />
                    <div className="grid gap-6 md:grid-cols-3 md:items-stretch pt-5">
                        <PricingCard
                            title={t("intro.planGuestTitle")}
                            price={t("intro.planGuestPrice")}
                            features={[t("intro.planGuestFeat1"), t("intro.planGuestFeat2"), t("intro.planGuestFeat3")]}
                            cta={
                                <Link
                                    href="/login"
                                    className="block w-full text-center rounded-xl py-2.5 text-sm font-extrabold border"
                                    style={{ borderColor: "var(--border-card)", color: "var(--heading-on-surface)" }}
                                >
                                    {t("intro.startNow")}
                                </Link>
                            }
                        />
                        <PricingCard
                            title={t("intro.planUserTitle")}
                            price={t("intro.planUserPrice")}
                            features={[t("intro.planUserFeat1"), t("intro.planUserFeat2"), t("intro.planUserFeat3")]}
                            cta={
                                <Link
                                    href="/login?inregistrare=1"
                                    className="block w-full text-center rounded-xl py-2.5 text-sm font-extrabold text-white"
                                    style={{ background: "linear-gradient(135deg, #408A71, #285A48)" }}
                                >
                                    {t("intro.register")}
                                </Link>
                            }
                        />
                        <PricingCard
                            title={t("intro.planProTitle")}
                            price={t("intro.planProPrice")}
                            features={[t("intro.planProFeat1"), t("intro.planProFeat2"), t("intro.planProFeat3")]}
                            premium
                            badge={t("intro.planProBadge")}
                            cta={
                                <p className="pricing-premium-soon text-center text-sm rounded-xl py-2.5 px-3 leading-snug">
                                    {t("intro.plansComingSoon")}
                                </p>
                            }
                        />
                    </div>
                </div>
            </section>

            {/* CTA final */}
            <section
                className="px-5 py-16 lg:py-20 lg:px-12 text-center"
                style={{
                    background: "linear-gradient(135deg, #285A48 0%, #408A71 100%)",
                }}
            >
                <div className="mx-auto max-w-2xl">
                    <h2 className="text-2xl font-extrabold text-white sm:text-3xl">{t("intro.ctaTitle")}</h2>
                    <div className="mt-8 flex flex-wrap justify-center gap-3">
                        <Link
                            href="/login"
                            className="inline-flex px-6 py-3 rounded-2xl font-extrabold text-sm transition-transform hover:scale-[1.02]"
                            style={{ background: "#fff", color: "#285A48" }}
                        >
                            {t("intro.startNow")}
                        </Link>
                        <Link
                            href="/login?inregistrare=1"
                            className="inline-flex px-6 py-3 rounded-2xl font-extrabold text-sm text-white border border-white/40 hover:bg-white/10 transition-colors"
                        >
                            {t("intro.register")}
                        </Link>
                    </div>
                </div>
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
