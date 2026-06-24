"use client";

import { useEffect } from "react";
import { isGenerationBusy } from "@/lib/generationJob";

/** Avertisment la închiderea tab-ului cât timp rulează o generare. */
export function GenerationLeaveGuard() {
    useEffect(() => {
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            if (!isGenerationBusy()) return;
            e.preventDefault();
            e.returnValue = "";
        };
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, []);
    return null;
}
