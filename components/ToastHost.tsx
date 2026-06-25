"use client";

/**
 * Componenta care afiseaza toasturile (mesajele scurte din colt). O montez o singura data in layout,
 * iar ea asculta evenimentul lansat de showToast(...) si afiseaza fiecare mesaj cateva secunde.
 */
import { useEffect, useState } from "react";
import { TOAST_EVENT, type ToastDetail } from "@/lib/toast";

// Un toast afisat = datele lui plus un id numeric unic (ca sa-l pot scoate exact pe cel potrivit cand expira).
type ToastItem = ToastDetail & { id: number };

// Culoarea de fundal in functie de tipul mesajului (succes/eroare/info).
const BG_BY_TYPE: Record<ToastDetail["type"], string> = {
    success: "linear-gradient(135deg, #285A48, #1a3d2f)",
    error: "linear-gradient(135deg, #b3261e, #7f1d1d)",
    info: "linear-gradient(135deg, #334155, #1e293b)",
};

// Iconita afisata la fiecare tip de mesaj.
const ICON_BY_TYPE: Record<ToastDetail["type"], string> = {
    success: "✓",
    error: "⚠",
    info: "ℹ",
};

export function ToastHost() {
    const [toasts, setToasts] = useState<ToastItem[]>([]);  // toasturile afisate acum

    useEffect(() => {
        let counter = 0;  // numarator simplu ca sa generez id-uri unice
        const onToast = (e: Event) => {
            const detail = (e as CustomEvent<ToastDetail>).detail;
            if (!detail?.message) return;
            // Adaug toastul nou in lista...
            const id = ++counter;
            setToasts((prev) => [...prev, { ...detail, id }]);
            // ...si programez scoaterea lui dupa durata ceruta (implicit 3.5 secunde).
            window.setTimeout(
                () => setToasts((prev) => prev.filter((toastItem) => toastItem.id !== id)),
                detail.duration ?? 3500,
            );
        };
        window.addEventListener(TOAST_EVENT, onToast);
        return () => window.removeEventListener(TOAST_EVENT, onToast);
    }, []);

    // Daca nu am niciun mesaj, nu randez nimic.
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
