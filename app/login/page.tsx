"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { APP_HOME_PATH } from "@/lib/routes";
import { getApiBase, getStoredGuestSessionId, isGuestSession, setStoredGuestSessionId } from "@/lib/api";
import { LanguageToggle } from "@/components/LanguageToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandLogo } from "@/components/BrandLogo";
import { useI18n } from "@/lib/i18n";

type UserRole = "admin" | "user" | "guest";

/** Stiluri vizuale per rol (admin, user, guest) pentru selector si buton submit. */
const roleStyles: Record<
    UserRole,
    {
        icon: string;
        selectedBorder: string;
        selectedBg: string;
        selectedGlow: string;
        iconSelected: string;
        textSelected: string;
        btnGradient: string;
        btnGlow: string;
    }
> = {
    admin: {
        icon: "⚙",
        selectedBorder: "border-amber",
        selectedBg: "bg-amber-light/50",
        selectedGlow: "shadow-[0_0_22px_rgba(196,147,63,0.4)]",
        iconSelected: "bg-amber-light text-amber",
        textSelected: "text-amber",
        btnGradient: "bg-gradient-to-r from-amber to-[#D4A853]",
        btnGlow: "hover:shadow-[0_4px_28px_rgba(196,147,63,0.55)]",
    },
    user: {
        icon: "◉",
        selectedBorder: "border-mid-green",
        selectedBg: "bg-surface-green/80",
        selectedGlow: "shadow-[0_0_22px_rgba(64,138,113,0.4)]",
        iconSelected: "bg-light-green/50 text-dark-green",
        textSelected: "text-mid-green",
        btnGradient: "bg-gradient-to-r from-mid-green to-dark-green",
        btnGlow: "hover:shadow-[0_4px_28px_rgba(64,138,113,0.55)]",
    },
    guest: {
        icon: "◎",
        selectedBorder: "border-ocean",
        selectedBg: "bg-ocean-light/40",
        selectedGlow: "shadow-[0_0_22px_rgba(58,143,181,0.4)]",
        iconSelected: "bg-ocean-light/60 text-ocean",
        textSelected: "text-ocean",
        btnGradient: "bg-gradient-to-r from-ocean to-[#4AADCB]",
        btnGlow: "hover:shadow-[0_4px_28px_rgba(58,143,181,0.55)]",
    },
};

/** Formateaza mesajul de eroare FastAPI (string sau array de validare). */
function formatLoginError(detail: unknown, fallback: string): string {
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail[0] && typeof detail[0] === "object" && "msg" in detail[0]) {
        return String((detail[0] as { msg: string }).msg);
    }
    return fallback;
}

/**
 * Formularul propriu-zis de login: trebuie randat in Suspense ca useSearchParams sa fie permis in Next.
 */
function LoginPageContent() {
    const { t } = useI18n();
    const searchParams = useSearchParams();

    // Stare pentru formularele de login si de inregistrare, plus rolul selectat.
    const [role, setRole] = useState<UserRole>("user");   // rolul ales (admin/user/guest)
    const [email, setEmail] = useState("");               // emailul de login
    const [password, setPassword] = useState("");         // parola de login
    const [showPassword, setShowPassword] = useState(false);  // arat parola in clar?
    const [isLoading, setIsLoading] = useState(false);    // se trimite o cerere acum? (dezactivez butoanele)
    const [error, setError] = useState<string | null>(null);  // mesaj de eroare la login
    const [modInregistrare, setModInregistrare] = useState(false);  // arat formularul de inregistrare in loc de login?
    const [regEmail, setRegEmail] = useState("");         // emailul din formularul de inregistrare
    const [regPassword, setRegPassword] = useState("");   // parola din formularul de inregistrare
    const [regMsg, setRegMsg] = useState<string | null>(null);  // mesaj (succes sau eroare) la inregistrare
    const router = useRouter();

    /** Config roluri cu etichete traduse (memoizat pe locale). */
    const roleConfig = useMemo(
        () =>
            ({
                admin: {
                    ...roleStyles.admin,
                    label: t("login.role.admin"),
                    desc: t("login.role.adminDesc"),
                },
                user: {
                    ...roleStyles.user,
                    label: t("login.role.user"),
                    desc: t("login.role.userDesc"),
                },
                guest: {
                    ...roleStyles.guest,
                    label: t("login.role.guest"),
                    desc: t("login.role.guestDesc"),
                },
            }) as Record<
                UserRole,
                (typeof roleStyles)[UserRole] & { label: string; desc: string }
            >,
        [t],
    );

    /** Lista feature-uri pentru panoul de branding din stanga. */
    const brandFeatures = useMemo(
        () => [t("login.feature1"), t("login.feature2"), t("login.feature3")],
        [t],
    );

    // De aici incep efectele: deschid formularul de inregistrare din query si redirectez daca esti deja logat.
    /** Daca URL-ul contine ?inregistrare=1 (ex. de pe butonul "Inregistrare" din header), deschid direct formularul de cont. */
    useEffect(() => {
        if (searchParams.get("inregistrare") === "1") {
            setModInregistrare(true);
        }
    }, [searchParams]);

    /**
     * Daca utilizatorul e deja autentificat (admin/user), redirect la app.
     * Sesiunea guest are token dar trebuie sa poata accesa login/inregistrare.
     */
    useEffect(() => {
        if (typeof window !== "undefined") {
            const token = localStorage.getItem("token");
            // Daca am deja token si nu sunt oaspete, ma duc direct in aplicatie (un oaspete poate ramane pe login ca sa-si faca cont).
            if (token && !isGuestSession()) {
                router.replace(APP_HOME_PATH);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionat doar la mount; router.replace e stabil
    }, []);

    // Blochez scroll-ul paginii cat timp sunt pe login, ca tot formularul sa incapa in viewport.
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = prev;
        };
    }, []);

    // De aici incep handlerele formularelor: inregistrare, login normal si intrare ca oaspete.
    /** Trimit datele catre POST /register ca sa creez un cont nou. */
    const handleInregistrare = async (e: React.FormEvent) => {
        e.preventDefault();  // opresc reincarcarea paginii (comportamentul implicit al formularului)
        if (!regEmail.trim() || !regPassword) return;
        setIsLoading(true);
        setRegMsg(null);
        setError(null);
        try {
            const response = await fetch(`${getApiBase()}/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: regEmail.trim(),
                    parola: regPassword,
                }),
            });
            const data = await response.json();
            if (!response.ok) {
                setRegMsg(formatLoginError(data.detail, t("login.errorGeneric")));
                return;
            }
            // Cont creat: revin la formularul de login si precompletez emailul, ca sa fie mai usor de intrat.
            setRegMsg(data.mesaj || t("login.accountCreated"));
            setModInregistrare(false);
            setEmail(regEmail.trim());
        } catch {
            setRegMsg(t("login.serverErrorShort"));
        } finally {
            setIsLoading(false);
        }
    };

    /** Intru ca oaspete anonim: cer un token de guest si pastrez acelasi guest_session_id ca sa nu pierd creditele. */
    const intraCaOaspeteAnonim = async () => {
        setIsLoading(true);
        setError(null);
        try {
            // Daca am mai fost oaspete pe browserul asta, refolosesc acelasi id ca sa pastrez creditele ramase.
            const existingGuestId = getStoredGuestSessionId();
            const response = await fetch(`${getApiBase()}/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: "",
                    parola: "",
                    rol: "guest",
                    guest_session_id: existingGuestId,
                }),
            });
            const data = await response.json();
            if (!response.ok) {
                setError(formatLoginError(data.detail, t("login.errorGeneric")));
                return;
            }
            // Salvez tokenul si datele de sesiune in localStorage ca sa raman logat intre navigari.
            localStorage.setItem("token", data.token);
            localStorage.setItem("rol", data.rol);
            localStorage.setItem("email", data.email ?? "");
            // Retin id-ul de oaspete returnat de server (poate fi unul nou daca n-aveam).
            if (typeof data.guest_session_id === "string") {
                setStoredGuestSessionId(data.guest_session_id);
            }
            router.push(APP_HOME_PATH);
        } catch {
            setError(t("login.serverError"));
        } finally {
            setIsLoading(false);
        }
    };

    /** Autentificare normala (admin sau user) prin POST /login cu email si parola. */
    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (role === "guest") return;  // rolul guest are buton separat, nu trece prin formularul cu parola
        if (!email.trim() || !password) return;
        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch(`${getApiBase()}/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: email.trim(), parola: password, rol: role }),
            });

            const data = await response.json();

            if (!response.ok) {
                setError(formatLoginError(data.detail, t("login.errorGeneric")));
                return;
            }

            // Login reusit: salvez sesiunea in localStorage si intru in aplicatie.
            localStorage.setItem("token", data.token);
            localStorage.setItem("rol", data.rol);
            localStorage.setItem("email", data.email ?? "");
            router.push(APP_HOME_PATH);
        } catch {
            setError(t("login.serverError"));
        } finally {
            setIsLoading(false);
        }
    };

    const cfg = roleConfig[role];

    return (
        <div className="flex h-dvh overflow-hidden" style={{ backgroundColor: "var(--page-bg)" }}>

            {/* Panou branding stanga (desktop) */}
            <div
                className="hidden lg:flex lg:w-[48%] h-full relative overflow-hidden flex-col justify-between p-8 xl:p-10"
                style={{ background: "linear-gradient(145deg, #091413 0%, #285A48 55%, #408A71 100%)" }}
            >
                {/* Blob-uri decorative de fundal */}
                <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full opacity-20 blur-3xl"
                    style={{ background: "radial-gradient(circle, #B0E4CC, transparent)" }} />
                <div className="absolute -bottom-20 -left-20 w-80 h-80 rounded-full opacity-15 blur-3xl"
                    style={{ background: "radial-gradient(circle, #408A71, transparent)" }} />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-56 h-56 rounded-full opacity-10 blur-2xl"
                    style={{ background: "radial-gradient(circle, #B0E4CC, transparent)" }} />

                {/* Logo si subtitlu brand */}
                <div className="relative z-10">
                    <div className="text-3xl font-extrabold tracking-wider mb-2" style={{ color: "#ffffff" }}>
                        <BrandLogo />
                    </div>
                    <div className="text-sm font-semibold" style={{ color: "var(--sidebar-brand-accent)" }}>
                        {t("login.brandSubtitle")}
                    </div>
                </div>

                {/* Titlu principal si lista feature-uri */}
                <div className="relative z-10">
                    <h2 className="text-3xl xl:text-4xl font-extrabold leading-tight mb-5" style={{ color: "#ffffff" }}>
                        {t("login.headline")}
                    </h2>

                    <div className="space-y-3">
                        {brandFeatures.map((text) => (
                            <div key={text} className="flex items-start space-x-3">
                                <span className="mt-0.5 text-sm" style={{ color: "#B0E4CC" }}>✦</span>
                                <span className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.75)" }}>
                                    {text}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Accent decorativ jos */}
                <div className="relative z-10 flex items-center space-x-2">
                    <div className="w-8 h-1 rounded-full" style={{ background: "#408A71" }} />
                    <div className="w-16 h-1 rounded-full" style={{ background: "#B0E4CC" }} />
                    <div className="w-8 h-1 rounded-full opacity-40" style={{ background: "#408A71" }} />
                </div>
            </div>

            {/* Panou formular dreapta — incape in viewport fara scroll */}
            <div className="flex-1 h-full min-h-0 flex flex-col overflow-hidden p-4 sm:p-5 lg:p-6">
                <div className="mx-auto flex h-full w-full max-w-md min-h-0 flex-col" style={{ animation: "slide-up 0.45s ease-out" }}>

                    <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
                        <Link
                            href="/"
                            aria-label={t("login.back")}
                            title={t("login.back")}
                            className="group inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-all duration-200"
                            style={{
                                borderColor: "var(--theme-toggle-border)",
                                background: "var(--theme-toggle-bg)",
                                color: "var(--theme-toggle-fg)",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-bg)")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--theme-toggle-bg)")}
                        >
                            <svg
                                className="h-6 w-6 transition-transform duration-200 group-hover:-translate-x-0.5"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden
                            >
                                <path d="M19 12H5M12 19l-7-7 7-7" />
                            </svg>
                        </Link>
                        <div className="flex items-center gap-2">
                            <LanguageToggle />
                            <ThemeToggle />
                        </div>
                    </div>

                    {/* Logo pe mobil */}
                    <div className="mb-3 shrink-0 text-center lg:hidden">
                        <div className="text-xl font-extrabold tracking-wider sm:text-2xl" style={{ color: "var(--heading-on-surface)" }}>
                            <BrandLogo textColor="var(--heading-on-surface)" />
                        </div>
                    </div>

                    {/* Card principal login / inregistrare */}
                    <div
                        className="flex min-h-0 flex-1 flex-col rounded-3xl p-5 sm:p-6"
                        style={{
                            background: "var(--card-bg)",
                            boxShadow: "var(--shadow-card-lg)",
                            border: "1px solid var(--border-card)",
                        }}
                    >
                        {/* Titlu card */}
                        <div className="mb-4 shrink-0">
                            <h1 className="text-xl font-extrabold mb-0.5 sm:text-2xl" style={{ color: "var(--text-primary)" }}>
                                {modInregistrare ? t("login.registerTitle") : t("login.welcomeBack")}
                            </h1>
                            {!modInregistrare ? (
                                <p className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                                    {t("login.chooseRole")}
                                </p>
                            ) : null}
                        </div>

                        {modInregistrare ? (
                            /* Formular inregistrare cont nou */
                            <form onSubmit={handleInregistrare} className="space-y-3 mb-4 min-h-0 flex-1">
                                <div>
                                    <label
                                        className="block text-[11px] font-extrabold uppercase tracking-widest mb-2"
                                        style={{ color: "var(--text-muted)" }}
                                    >
                                        {t("login.email")}
                                    </label>
                                    <input
                                        type="email"
                                        required
                                        value={regEmail}
                                        onChange={(e) => setRegEmail(e.target.value)}
                                        className="w-full rounded-xl px-4 py-2.5 text-sm border-2"
                                        style={{
                                            borderColor: "var(--input-border)",
                                            background: "var(--input-bg)",
                                            color: "var(--text-primary)",
                                        }}
                                    />
                                </div>
                                <div>
                                    <label
                                        className="block text-[11px] font-extrabold uppercase tracking-widest mb-2"
                                        style={{ color: "var(--text-muted)" }}
                                    >
                                        {t("login.password")}
                                    </label>
                                    <input
                                        type="password"
                                        required
                                        value={regPassword}
                                        onChange={(e) => setRegPassword(e.target.value)}
                                        className="w-full rounded-xl px-4 py-2.5 text-sm border-2"
                                        style={{
                                            borderColor: "var(--input-border)",
                                            background: "var(--input-bg)",
                                            color: "var(--text-primary)",
                                        }}
                                    />
                                </div>
                                {regMsg && (
                                    <p className="text-sm font-medium" style={{ color: "var(--link-accent)" }}>
                                        {regMsg}
                                    </p>
                                )}
                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    className="w-full py-3 font-extrabold text-sm rounded-xl text-white bg-mid-green opacity-90 disabled:opacity-50"
                                >
                                    {isLoading ? t("login.creating") : t("login.createAccount")}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setModInregistrare(false)}
                                    className="w-full text-sm font-bold"
                                    style={{ color: "var(--text-muted)" }}
                                >
                                    {t("login.haveAccount")}
                                </button>
                            </form>
                        ) : null}

                        {!modInregistrare ? null : (
                            <div className="h-px mb-4" style={{ background: "var(--divider)" }} />
                        )}

                        {/* Selector rol + formular autentificare */}
                        {!modInregistrare ? (
                        <>
                        <div className="grid grid-cols-3 gap-2 mb-4 shrink-0">
                            {(Object.keys(roleConfig) as UserRole[]).map((r) => {
                                const c = roleConfig[r];
                                const isSelected = role === r;
                                return (
                                    <button
                                        key={r}
                                        type="button"
                                        onClick={() => setRole(r)}
                                        className={`flex flex-col items-center p-2 sm:p-2.5 rounded-2xl border-2 cursor-pointer
                                            ${isSelected
                                                ? `${c.selectedBorder} ${c.selectedBg} ${c.selectedGlow} scale-[1.03]`
                                                : "role-pick-idle hover:scale-[1.01]"
                                            }`}
                                        style={{ transition: "all 0.2s ease" }}
                                    >
                                        <div
                                            className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center mb-1 text-base sm:text-lg
                                                ${isSelected ? c.iconSelected : "role-pick-icon-idle"}`}
                                            style={{ transition: "all 0.2s ease" }}
                                        >
                                            {c.icon}
                                        </div>
                                        <span
                                            className={`text-[11px] sm:text-xs font-extrabold leading-tight ${isSelected ? c.textSelected : ""}`}
                                            style={{
                                                transition: "color 0.2s ease",
                                                ...(!isSelected ? { color: "var(--text-muted)" } : {}),
                                            }}
                                        >
                                            {c.label}
                                        </span>
                                        <span
                                            className="hidden sm:block text-[10px] text-center leading-tight mt-0.5 line-clamp-2"
                                            style={{ color: "var(--text-faint)" }}
                                        >
                                            {c.desc}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Separator vizual */}
                        <div
                            className="h-px mb-4 shrink-0"
                            style={{ background: "linear-gradient(to right, transparent, #B0E4CC, transparent)" }}
                        />

                        {/* Formular email/parola sau buton oaspete */}
                        <form onSubmit={handleLogin} className="min-h-0 flex-1 space-y-3 sm:space-y-4">

                            {role === "guest" ? (
                                <div className="space-y-3">
                                    <p className="text-xs sm:text-sm font-medium leading-snug" style={{ color: "var(--text-muted)" }}>
                                        {t("login.guestBlurb")}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={intraCaOaspeteAnonim}
                                        disabled={isLoading}
                                        className={`w-full py-3 font-extrabold text-sm tracking-wide rounded-xl text-white ${cfg.btnGradient} ${cfg.btnGlow}`}
                                        style={{
                                            opacity: isLoading ? 0.6 : 1,
                                            cursor: isLoading ? "not-allowed" : "pointer",
                                            transition: "transform 0.15s, box-shadow 0.2s, opacity 0.2s",
                                        }}
                                    >
                                        {isLoading ? t("login.opening") : t("login.continueNoAccount")}
                                    </button>
                                </div>
                            ) : null}

                            {/* Camp email */}
                            {role !== "guest" && (
                            <div>
                                <label
                                    className="block text-[11px] font-extrabold uppercase tracking-widest mb-2"
                                    style={{ color: "var(--text-muted)" }}
                                >
                                    {t("login.emailAddress")}
                                </label>
                                <input
                                    type="email"
                                    placeholder={t("login.emailPlaceholder")}
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    className="w-full rounded-xl px-4 py-2.5 text-sm font-medium placeholder:text-[var(--text-faint)]"
                                    style={{
                                        border: "2px solid var(--input-border)",
                                        background: "var(--input-bg)",
                                        color: "var(--text-primary)",
                                        transition: "border-color 0.2s, box-shadow 0.2s, background 0.2s",
                                        outline: "none",
                                    }}
                                    onFocus={(e) => {
                                        e.target.style.borderColor = "#408A71";
                                        e.target.style.background = "var(--input-bg-focus)";
                                        e.target.style.boxShadow = "var(--focus-ring)";
                                    }}
                                    onBlur={(e) => {
                                        e.target.style.borderColor = "var(--input-border)";
                                        e.target.style.background = "var(--input-bg)";
                                        e.target.style.boxShadow = "none";
                                    }}
                                />
                            </div>
                            )}

                            {/* Camp parola cu toggle vizibilitate */}
                            {role !== "guest" && (
                            <div>
                                <label
                                    className="block text-[11px] font-extrabold uppercase tracking-widest mb-2"
                                    style={{ color: "var(--text-muted)" }}
                                >
                                    {t("login.passwordLabel")}
                                </label>
                                <div className="relative">
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        placeholder="••••••••"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                        className="w-full rounded-xl px-4 py-2.5 pr-12 text-sm font-medium placeholder:text-[var(--text-faint)]"
                                        style={{
                                            border: "2px solid var(--input-border)",
                                            background: "var(--input-bg)",
                                            color: "var(--text-primary)",
                                            transition: "border-color 0.2s, box-shadow 0.2s, background 0.2s",
                                            outline: "none",
                                        }}
                                        onFocus={(e) => {
                                            e.target.style.borderColor = "#408A71";
                                            e.target.style.background = "var(--input-bg-focus)";
                                            e.target.style.boxShadow = "var(--focus-ring)";
                                        }}
                                        onBlur={(e) => {
                                            e.target.style.borderColor = "var(--input-border)";
                                            e.target.style.background = "var(--input-bg)";
                                            e.target.style.boxShadow = "none";
                                        }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-lg"
                                        style={{
                                            color: "var(--text-faint)",
                                            transition: "color 0.15s",
                                            background: "none",
                                            border: "none",
                                            cursor: "pointer",
                                        }}
                                        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--link-accent)")}
                                        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-faint)")}
                                    >
                                        {showPassword ? "○" : "●"}
                                    </button>
                                </div>
                            </div>
                            )}

                            {/* Mesaj eroare autentificare */}
                            {error && (
                                <div
                                    className="flex items-start space-x-2 px-4 py-3 rounded-xl text-sm font-medium"
                                    style={{
                                        background: "rgba(194,91,111,0.08)",
                                        border: "1px solid rgba(194,91,111,0.2)",
                                        color: "#b04060",
                                    }}
                                >
                                    <span className="mt-0.5 shrink-0">✕</span>
                                    <span>{error}</span>
                                </div>
                            )}

                            {/* Buton submit login */}
                            {role !== "guest" && (
                            <button
                                type="submit"
                                disabled={isLoading}
                                className={`w-full py-3 font-extrabold text-sm tracking-wide rounded-xl text-white mt-0.5
                                    ${cfg.btnGradient} ${cfg.btnGlow}`}
                                style={{
                                    transition: "transform 0.15s, box-shadow 0.2s, opacity 0.2s",
                                    opacity: isLoading ? 0.6 : 1,
                                    cursor: isLoading ? "not-allowed" : "pointer",
                                }}
                                onMouseEnter={(e) => {
                                    if (!isLoading) e.currentTarget.style.transform = "scale(1.02)";
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = "scale(1)";
                                }}
                                onMouseDown={(e) => {
                                    if (!isLoading) e.currentTarget.style.transform = "scale(0.99)";
                                }}
                                onMouseUp={(e) => {
                                    if (!isLoading) e.currentTarget.style.transform = "scale(1.02)";
                                }}
                            >
                                {isLoading ? (
                                    <span className="flex items-center justify-center space-x-2">
                                        <span
                                            className="inline-block w-4 h-4 rounded-full"
                                            style={{
                                                border: "2px solid rgba(255,255,255,0.3)",
                                                borderTopColor: "#ffffff",
                                                animation: "spin 0.8s linear infinite",
                                            }}
                                        />
                                        <span>{t("login.connecting")}</span>
                                    </span>
                                ) : (
                                    `${t("login.enterAs")} ${cfg.label} ${t("login.enterAsSuffix")}`
                                )}
                            </button>
                            )}
                        </form>
                        </>
                        ) : null}

                        {/* Footer link inregistrare (doar mod login) */}
                        {!modInregistrare ? (
                        <p className="text-center text-xs mt-3 shrink-0" style={{ color: "var(--text-muted)" }}>
                            {t("login.footerNoAccount")}{" "}
                            <Link
                                href="/login?inregistrare=1"
                                className="font-bold"
                                style={{ color: "var(--link-accent)" }}
                            >
                                {t("login.footerRegister")}
                            </Link>
                        </p>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}

/** Pagina exportata: infasoara continutul in Suspense (useSearchParams). */
export default function LoginPage() {
    return (
        <Suspense
            fallback={
                <div
                    className="flex h-dvh items-center justify-center overflow-hidden font-medium"
                    style={{ background: "var(--page-bg)", color: "var(--text-muted)" }}
                >
                    Se încarcă…
                </div>
            }
        >
            <LoginPageContent />
        </Suspense>
    );
}
