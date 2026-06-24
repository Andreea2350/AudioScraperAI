"use client";

/* Afiseaza toasturile globale (showToast) in coltul de jos, in stilul site-ului. */
import { useEffect, useState } from "react";
import { TOAST_EVENT, type ToastDetail } from "@/lib/toast";

type ToastItem = ToastDetail & { id: number };

const BG_BY_TYPE: Record<ToastDetail["type"], string> = {
    success: "linear-gradient(135deg, #285A48, #1a3d2f)",
    error: "linear-gradient(135deg, #b3261e, #7f1d1d)",
    info: "linear-gradient(135deg, #334155, #1e293b)",
};

const ICON_BY_TYPE: Record<ToastDetail["type"], string> = {
    success: "✓",
    error: "⚠",
    info: "ℹ",
};

export function ToastHost() {
    const [toasts, setToasts] = useState<ToastItem[]>([]);

    useEffect(() => {
        let counter = 0;
        const onToast = (e: Event) => {
            const detail = (e as CustomEvent<ToastDetail>).detail;
            if (!detail?.message) return;
            const id = ++counter;
            setToasts((prev) => [...prev, { ...detail, id }]);
            window.setTimeout(
                () => setToasts((prev) => prev.filter((toastItem) => toastItem.id !== id)),
                detail.duration ?? 3500,
            );
        };
        window.addEventListener(TOAST_EVENT, onToast);
        return () => window.removeEventListener(TOAST_EVENT, onToast);
    }, []);

    if (toasts.length === 0) return null;

    return (
        <div className="fixed bottom-10 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2 pointer-events-none">
            {toasts.map((toastItem) => (
                <div
                    key={toastItem.id}
                    className="pointer-events-auto flex items-center space-x-3 rounded-full px-6 py-3 text-white"
                    style={{
                        background: BG_BY_TYPE[toastItem.type],
                        boxShadow: "var(--shadow-toast)",
                        animation: "fade-in 0.25s ease-out",
                    }}
                >
                    <span className="text-sm leading-none" aria-hidden>
                        {ICON_BY_TYPE[toastItem.type]}
                    </span>
                    <span className="text-sm font-semibold tracking-wide">{toastItem.message}</span>
                </div>
            ))}
        </div>
    );
}
