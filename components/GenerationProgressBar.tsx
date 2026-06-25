"use client";

import { usePathname, useRouter } from "next/navigation";
import { APP_HOME_PATH } from "@/lib/routes";
import { useI18n } from "@/lib/i18n";
import {
    cancelActiveGenerationJob,
    requestGenerationProgressView,
    useGenerationJob,
} from "@/lib/generationJob";
import { confirmDialog } from "@/lib/confirm";

type Props = {
    /** Varianta compactă pentru header (aliniată la stânga). */
    inline?: boolean;
};

/** Bara de progres pentru job-ul global de generare. */
export function GenerationProgressBar({ inline = false }: Props) {
    const { t } = useI18n();
    const router = useRouter();
    const pathname = usePathname();
    const job = useGenerationJob();  // ma abonez la jobul global de generare

    // Daca nu ruleaza nimic (sau nu e varianta inline din header), nu afisez bara deloc.
    if (!job.busy || !inline) return null;

    // Pot deschide ecranul de progres doar daca jobul e de tip stream si stiu de unde a pornit.
    const canOpenProgress = job.kind === "stream" && job.streamOrigin != null;

    // Calculez procentul si textul de status in functie de tipul jobului si de faza in care e.
    const isBatch = job.kind === "playlist-separate" || job.kind === "playlist-combined";
    let progressPct = 0;
    let statusText = job.label;

    if (isBatch && job.batchTotal > 0) {
        // La un lot din lista de redare, procentul e cate carti am terminat din total.
        progressPct = Math.round((job.batchCurrent / job.batchTotal) * 100);
        statusText = t("gen.progressBatch")
            .replace("{current}", String(job.batchCurrent))
            .replace("{total}", String(job.batchTotal));
    } else if (job.segmentsTotal && job.segmentsTotal > 0) {
        // La o singura carte, procentul e cate segmente audio sunt gata din total.
        progressPct = Math.round((job.segments.length / job.segmentsTotal) * 100);
        statusText = `${progressPct}%`;
    } else if (job.phase === "extracting") {
        // Inainte sa stiu numarul de segmente, arat procente fixe orientative pentru fiecare faza.
        progressPct = 15;
        statusText = t("gen.phaseExtracting");
    } else if (job.phase === "cleaning") {
        progressPct = 25;
        statusText = t("gen.phaseCleaning");
    } else if (job.phase === "chapters") {
        progressPct = 35;
        statusText = t("gen.phaseChapters");
    } else if (job.phase === "tts") {
        progressPct = job.segmentsTotal
            ? Math.max(40, Math.round((job.segments.length / job.segmentsTotal) * 100))
            : 50;
        statusText = `${progressPct}%`;
    } else {
        progressPct = 10;
        statusText = t("gen.generating");
    }

    // La click pe bara: ma duc pe pagina principala (daca nu sunt deja) si cer redeschiderea ecranului de progres.
    const onOpenProgress = () => {
        if (!canOpenProgress) return;
        if (pathname !== APP_HOME_PATH) router.push(APP_HOME_PATH);
        requestGenerationProgressView();
    };

    // La click pe X: cer confirmare si apoi opresc generarea.
    const onCancel = async () => {
        const ok = await confirmDialog({
            message: t("gen.cancelConfirm"),
            title: t("gen.cancelGeneration"),
        });
        if (!ok) return;
        await cancelActiveGenerationJob();
    };

    return (
        <div
            className="flex min-w-[12rem] max-w-[18rem] sm:max-w-xs md:max-w-sm items-center gap-2.5 rounded-xl border px-3 py-2"
            style={{
                borderColor: "var(--border-card)",
                background: "var(--card-bg-muted)",
            }}
            role="status"
            aria-live="polite"
            title={canOpenProgress ? t("gen.openProgressView") : job.label}
        >
            <button
                type="button"
                onClick={onOpenProgress}
                disabled={!canOpenProgress}
                className={`min-w-0 flex-1 text-left ${canOpenProgress ? "cursor-pointer" : "cursor-default"}`}
            >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span
                        className="truncate text-[11px] font-bold leading-tight sm:text-xs"
                        style={{ color: "var(--text-primary)" }}
                    >
                        {statusText}
                    </span>
                    <span className="shrink-0 text-[10px] font-extrabold" style={{ color: "var(--text-muted)" }}>
                        {progressPct}%
                    </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--hover-bg)" }}>
                    <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                            width: `${Math.min(100, Math.max(6, progressPct))}%`,
                            background: "linear-gradient(90deg, #408A71, #285A48)",
                        }}
                    />
                </div>
            </button>
            <button
                type="button"
                onClick={() => void onCancel()}
                aria-label={t("gen.cancelGeneration")}
                title={t("gen.cancelGeneration")}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold"
                style={{ color: "var(--text-muted)" }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--hover-bg)";
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                }}
            >
                ✕
            </button>
        </div>
    );
}
