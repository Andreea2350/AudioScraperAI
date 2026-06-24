"use client";

/* Modal global de confirmare (confirmDialog) in stilul site-ului. */
import { useEffect, useState } from "react";
import { registerConfirmHandler, type ConfirmOptions } from "@/lib/confirm";
import { useI18n } from "@/lib/i18n";

type Pending = ConfirmOptions & { resolve: (value: boolean) => void };

export function ConfirmHost() {
    const { t } = useI18n();
    const [pending, setPending] = useState<Pending | null>(null);

    useEffect(() => {
        registerConfirmHandler(
            (opts) => new Promise<boolean>((resolve) => setPending({ ...opts, resolve })),
        );
        return () => registerConfirmHandler(null);
    }, []);

    if (!pending) return null;

    const close = (value: boolean) => {
        pending.resolve(value);
        setPending(null);
    };

    const destructive = pending.destructive ?? true;
    const confirmBg = destructive
        ? "linear-gradient(135deg, #b3261e, #7f1d1d)"
        : "linear-gradient(135deg, #285A48, #1a3d2f)";
    const confirmBgHover = destructive
        ? "linear-gradient(135deg, #d13b32, #b3261e)"
        : "linear-gradient(135deg, #408A71, #285A48)";

    return (
        <div
            className="fixed inset-0 z-[70] flex items-center justify-center p-4"
            style={{
                background: "var(--overlay-scrim)",
                backdropFilter: "blur(6px)",
                animation: "fade-in 0.2s ease-out",
            }}
            onClick={() => close(false)}
        >
            <div
                role="dialog"
                aria-modal="true"
                className="w-full max-w-sm overflow-hidden rounded-2xl"
                style={{
                    background: "var(--card-bg)",
                    boxShadow: "var(--shadow-modal)",
                    border: "1px solid var(--border-card)",
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div
                    className="relative flex items-center justify-center px-6 py-4"
                    style={{ borderBottom: "1px solid var(--divider)" }}
                >
                    <h2 className="text-base font-extrabold" style={{ color: "var(--heading-on-surface)" }}>
                        {pending.title ?? t("common.confirmTitle")}
                    </h2>
                    <button
                        type="button"
                        onClick={() => close(false)}
                        className="absolute right-4 text-xl font-bold leading-none transition-colors duration-150"
                        style={{ color: "var(--text-muted)" }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
                    >
                        &times;
                    </button>
                </div>

                <div className="p-6 text-center">
                    <p className="mb-6 text-sm font-medium" style={{ color: "var(--text-body)" }}>
                        {pending.message}
                    </p>
                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={() => close(false)}
                            className="flex-1 rounded-lg py-3 text-sm font-extrabold uppercase tracking-wider transition-all duration-200"
                            style={{
                                background: "var(--card-bg-muted)",
                                color: "var(--text-body)",
                                border: "1px solid var(--border-card)",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-bg)")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--card-bg-muted)")}
                        >
                            {pending.cancelLabel ?? t("common.no")}
                        </button>
                        <button
                            type="button"
                            onClick={() => close(true)}
                            className="flex-1 rounded-lg py-3 text-sm font-extrabold uppercase tracking-wider text-white transition-all duration-200"
                            style={{ background: confirmBg, boxShadow: "var(--shadow-btn-destructive)" }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = confirmBgHover)}
                            onMouseLeave={(e) => (e.currentTarget.style.background = confirmBg)}
                        >
                            {pending.confirmLabel ?? t("common.yes")}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
