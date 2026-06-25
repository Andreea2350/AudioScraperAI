"use client";

import { useEffect } from "react";
import { isGenerationBusy } from "@/lib/generationJob";

/**
 * Componenta asta nu afiseaza nimic; doar asculta evenimentul de inchidere a tab-ului.
 * Daca tocmai ruleaza o generare, browserul intreaba utilizatorul daca sigur vrea sa plece,
 * ca sa nu piarda din greseala o carte care se proceseaza.
 */
export function GenerationLeaveGuard() {
    useEffect(() => {
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            // Daca nu ruleaza nimic, las pagina sa se inchida fara avertisment.
            if (!isGenerationBusy()) return;
            // Aceste doua linii sunt modul standard prin care cer browserului sa afiseze dialogul de confirmare la iesire.
            e.preventDefault();
            e.returnValue = "";
        };
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, []);
    return null;  // nu randez nimic vizibil
}
