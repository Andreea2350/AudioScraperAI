"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { API_BASE } from "@/lib/api";
import { LanguageToggle } from "@/components/LanguageToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useI18n } from "@/lib/i18n";

type UserRole = "admin" | "user" | "guest";

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
    const [role, setRole] = useState<UserRole>("user");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [modInregistrare, setModInregistrare] = useState(false);
    const [regEmail, setRegEmail] = useState("");
    const [regPassword, setRegPassword] = useState("");
    const [regRol, setRegRol] = useState<"user" | "guest">("user");
    const [regCheie, setRegCheie] = useState("");
    const [regMsg, setRegMsg] = useState<string | null>(null);
    const router = useRouter();

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

    const brandFeatures = useMemo(
        () => [t("login.feature1"), t("login.feature2"), t("login.feature3")],
        [t],
    );

    useEffect(() => {
        if (searchParams.get("inregistrare") === "1") {
            setModInregistrare(true);
        }
    }, [searchParams]);

    /**
     * Daca utilizatorul are deja token salvat, nu il lasam pe /login: redirect la app ca sa nu refaca autentificarea.
     * Nu punem router in dependinte ca sa nu redeclansam efectul la fiecare rerandare.
     */
    useEffect(() => {
        if (typeof window !== "undefined" && localStorage.getItem("token")) {
            router.replace("/");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionat doar la mount; router.replace e stabil
    }, []);

    /** POST /register: creeaza cont doar daca cheia admin din body se potriveste cu ce e pe server. */
    const handleInregistrare = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!regEmail.trim() || !regPassword || !regCheie.trim()) return;
        setIsLoading(true);
        setRegMsg(null);
        setError(null);
        try {
            const response = await fetch(`${API_BASE}/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: regEmail.trim(),
                    parola: regPassword,
                    rol: regRol,
                    cheie_admin: regCheie.trim(),
                }),
            });
            const data = await response.json();
            if (!response.ok) {
                setRegMsg(formatLoginError(data.detail, t("login.errorGeneric")));
                return;
            }
            setRegMsg(data.mesaj || t("login.accountCreated"));
            setModInregistrare(false);
            setEmail(regEmail.trim());
        } catch {
            setRegMsg(t("login.serverErrorShort"));
        } finally {
            setIsLoading(false);
        }
    };

    const intraCaOaspeteAnonim = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch(`${API_BASE}/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: "", parola: "", rol: "guest" }),
            });
            const data = await response.json();
            if (!response.ok) {
                setError(formatLoginError(data.detail, t("login.errorGeneric")));
                return;
            }
            localStorage.setItem("token", data.token);
            localStorage.setItem("rol", data.rol);
            localStorage.setItem("email", data.email ?? "");
            router.push("/");
        } catch {
            setError(t("login.serverError"));
        } finally {
            setIsLoading(false);
        }
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (role === "guest") return;
        if (!email.trim() || !password) return;
        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch(`${API_BASE}/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: email.trim(), parola: password, rol: role }),
            });

            const data = await response.json();

            if (!response.ok) {
                setError(formatLoginError(data.detail, t("login.errorGeneric")));
                return;
            }

            localStorage.setItem("token", data.token);
            localStorage.setItem("rol", data.rol);
            localStorage.setItem("email", data.email ?? "");
            router.push("/");
        } catch {
            setError(t("login.serverError"));
        } finally {
            setIsLoading(false);
        }
    };

    const cfg = roleConfig[role];

    return (
        <div className="min-h-screen flex" style={{ backgroundColor: "var(--page-bg)" }}>

            {/* ── Left branding panel ── */}
            <div
                className="hidden lg:flex lg:w-[48%] relative overflow-hidden flex-col justify-between p-12"
                style={{ background: "linear-gradient(145deg, #091413 0%, #285A48 55%, #408A71 100%)" }}
            >
                {/* Decorative blobs */}
                <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full opacity-20 blur-3xl"
                    style={{ background: "radial-gradient(circle, #B0E4CC, transparent)" }} />
                <div className="absolute -bottom-20 -left-20 w-80 h-80 rounded-full opacity-15 blur-3xl"
                    style={{ background: "radial-gradient(circle, #408A71, transparent)" }} />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-56 h-56 rounded-full opacity-10 blur-2xl"
                    style={{ background: "radial-gradient(circle, #B0E4CC, transparent)" }} />

                {/* Logo */}
                <div className="relative z-10">
                    <div className="text-3xl font-extrabold tracking-wider mb-2" style={{ color: "#ffffff" }}>
                        AudioScraper<span style={{ color: "#B0E4CC" }}>AI</span>
                    </div>
                    <div className="text-sm font-medium" style={{ color: "rgba(176,228,204,0.6)" }}>
                        {t("login.brandSubtitle")}
                    </div>
                </div>

                {/* Headline */}
                <div className="relative z-10">
                    <h2 className="text-4xl font-extrabold leading-tight mb-8" style={{ color: "#ffffff" }}>
                        {t("login.headline")}
                    </h2>

                    <div className="space-y-5">
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

                {/* Bottom accent */}
                <div className="relative z-10 flex items-center space-x-2">
                    <div className="w-8 h-1 rounded-full" style={{ background: "#408A71" }} />
                    <div className="w-16 h-1 rounded-full" style={{ background: "#B0E4CC" }} />
                    <div className="w-8 h-1 rounded-full opacity-40" style={{ background: "#408A71" }} />
                </div>
            </div>

            {/* ── Right form panel ── */}
            <div className="flex-1 flex items-center justify-center p-6 lg:p-10">
                <div className="w-full max-w-md" style={{ animation: "slide-up 0.45s ease-out" }}>

                    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                        <Link
                            href="/intro"
                            className="inline-flex items-center text-xs font-extrabold uppercase tracking-widest transition-colors"
                            style={{ color: "var(--text-muted)" }}
                        >
                            {t("login.back")}
                        </Link>
                        <div className="flex items-center gap-2">
                            <LanguageToggle />
                            <ThemeToggle />
                        </div>
                    </div>

                    {/* Mobile logo */}
                        <div className="lg:hidden text-center mb-8">
                        <div className="text-2xl font-extrabold tracking-wider" style={{ color: "var(--heading-on-surface)" }}>
                            AudioScraper<span style={{ color: "var(--link-accent)" }}>AI</span>
                        </div>
                    </div>

                    {/* Card */}
                    <div
                        className="rounded-3xl p-8"
                        style={{
                            background: "var(--card-bg)",
                            boxShadow: "var(--shadow-card-lg)",
                            border: "1px solid var(--border-card)",
                        }}
                    >
                        {/* Heading */}
                        <div className="mb-7">
                            <h1 className="text-2xl font-extrabold mb-1" style={{ color: "var(--text-primary)" }}>
                                {modInregistrare ? t("login.registerTitle") : t("login.welcomeBack")}
                            </h1>
                            <p className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                                {modInregistrare ? t("login.registerSubtitle") : t("login.chooseRole")}
                            </p>
                        </div>

                        {modInregistrare ? (
                            <form onSubmit={handleInregistrare} className="space-y-4 mb-6">
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
                                        className="w-full rounded-xl px-4 py-3 text-sm border-2"
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
                                        className="w-full rounded-xl px-4 py-3 text-sm border-2"
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
                                        {t("login.roleAccount")}
                                    </label>
                                    <select
                                        value={regRol}
                                        onChange={(e) => setRegRol(e.target.value as "user" | "guest")}
                                        className="w-full rounded-xl px-4 py-3 text-sm border-2"
                                        style={{
                                            borderColor: "var(--input-border)",
                                            background: "var(--input-bg)",
                                            color: "var(--text-primary)",
                                        }}
                                    >
                                        <option value="user">{t("login.regOptionUser")}</option>
                                        <option value="guest">{t("login.regOptionGuest")}</option>
                                    </select>
                                </div>
                                <div>
                                    <label
                                        className="block text-[11px] font-extrabold uppercase tracking-widest mb-2"
                                        style={{ color: "var(--text-muted)" }}
                                    >
                                        {t("login.adminKey")}
                                    </label>
                                    <input
                                        type="password"
                                        required
                                        value={regCheie}
                                        onChange={(e) => setRegCheie(e.target.value)}
                                        className="w-full rounded-xl px-4 py-3 text-sm border-2"
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
                                    className="w-full py-3.5 font-extrabold text-sm rounded-xl text-white bg-mid-green opacity-90 disabled:opacity-50"
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
                            <div className="h-px mb-6" style={{ background: "var(--divider)" }} />
                        )}

                        {/* Role selector + form autentificare */}
                        {!modInregistrare ? (
                        <>
                        <div className="grid grid-cols-3 gap-3 mb-7">
                            {(Object.keys(roleConfig) as UserRole[]).map((r) => {
                                const c = roleConfig[r];
                                const isSelected = role === r;
                                return (
                                    <button
                                        key={r}
                                        type="button"
                                        onClick={() => setRole(r)}
                                        className={`flex flex-col items-center p-3 rounded-2xl border-2 cursor-pointer
                                            ${isSelected
                                                ? `${c.selectedBorder} ${c.selectedBg} ${c.selectedGlow} scale-[1.04]`
                                                : "role-pick-idle hover:scale-[1.02]"
                                            }`}
                                        style={{ transition: "all 0.2s ease" }}
                                    >
                                        <div
                                            className={`w-9 h-9 rounded-xl flex items-center justify-center mb-2 text-lg
                                                ${isSelected ? c.iconSelected : "role-pick-icon-idle"}`}
                                            style={{ transition: "all 0.2s ease" }}
                                        >
                                            {c.icon}
                                        </div>
                                        <span
                                            className={`text-xs font-extrabold ${isSelected ? c.textSelected : ""}`}
                                            style={{
                                                transition: "color 0.2s ease",
                                                ...(!isSelected ? { color: "var(--text-muted)" } : {}),
                                            }}
                                        >
                                            {c.label}
                                        </span>
                                        <span
                                            className="text-[10px] text-center leading-tight mt-0.5"
                                            style={{ color: "var(--text-faint)" }}
                                        >
                                            {c.desc}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Divider */}
                        <div
                            className="h-px mb-7"
                            style={{ background: "linear-gradient(to right, transparent, #B0E4CC, transparent)" }}
                        />

                        {/* Form */}
                        <form onSubmit={handleLogin} className="space-y-5">

                            {role === "guest" ? (
                                <div className="space-y-4">
                                    <p className="text-sm font-medium leading-relaxed" style={{ color: "var(--text-muted)" }}>
                                        {t("login.guestBlurb")}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={intraCaOaspeteAnonim}
                                        disabled={isLoading}
                                        className={`w-full py-3.5 font-extrabold text-sm tracking-wide rounded-xl text-white ${cfg.btnGradient} ${cfg.btnGlow}`}
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

                            {/* Email */}
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
                                    className="w-full rounded-xl px-4 py-3 text-sm font-medium placeholder:text-[var(--text-faint)]"
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

                            {/* Password */}
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
                                        className="w-full rounded-xl px-4 py-3 pr-12 text-sm font-medium placeholder:text-[var(--text-faint)]"
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

                            {/* Error message */}
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

                            {/* Submit */}
                            {role !== "guest" && (
                            <button
                                type="submit"
                                disabled={isLoading}
                                className={`w-full py-3.5 font-extrabold text-sm tracking-wide rounded-xl text-white mt-1
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

                        {/* Footer — doar mod autentificare */}
                        {!modInregistrare ? (
                        <p className="text-center text-xs mt-6" style={{ color: "var(--text-muted)" }}>
                            {t("login.footerNoAccount")}{" "}
                            <Link
                                href="/login?inregistrare=1"
                                className="font-bold"
                                style={{ color: "var(--link-accent)" }}
                            >
                                {t("login.footerRegister")}
                            </Link>
                            <span className="mx-1">·</span>
                            <span
                                className="font-bold cursor-pointer"
                                style={{ color: "var(--link-accent)", transition: "color 0.15s" }}
                                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--heading-on-surface)")}
                                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--link-accent)")}
                            >
                                {t("login.footerContact")}
                            </span>
                        </p>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}

/** Pagina exportata: infasoara continutul in Suspense din cauza regulilor Next pentru useSearchParams. */
export default function LoginPage() {
    return (
        <Suspense
            fallback={
                <div
                    className="min-h-screen flex items-center justify-center font-medium"
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
