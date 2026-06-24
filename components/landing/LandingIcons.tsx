/** Iconițe SVG în stilul aplicației (stroke, colțuri rotunjite). */

type IconProps = { className?: string };

const base = "h-6 w-6 shrink-0";

export function IconDownload({ className = base }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
            <path d="M12 4v10M8 10l4 4 4-4M5 18h14" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export function IconSparkle({ className = base }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
            <path d="M12 3l1.2 4.2L17.5 8.5 13.2 9.7 12 14l-1.2-4.3L6.5 8.5l4.3-1.3L12 3z" strokeLinejoin="round" />
            <path d="M19 14l.6 2.1 2.1.6-2.1.6-.6 2.1-.6-2.1-2.1-.6 2.1-.6.6-2.1 2.1-.6-2.1-.6z" strokeLinejoin="round" />
        </svg>
    );
}

export function IconHeadphones({ className = base }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
            <path d="M4 14v3a2 2 0 002 2h1v-8H6a2 2 0 00-2 2zm14-3v8h1a2 2 0 002-2v-3a5 5 0 00-5-5h-1" strokeLinecap="round" />
            <path d="M8 12a4 4 0 018 0" strokeLinecap="round" />
        </svg>
    );
}

export function IconLink({ className = base }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
            <path d="M10 14a3.5 3.5 0 004.95 0l2.12-2.12a3.5 3.5 0 00-4.95-4.95L11.5 8.5" strokeLinecap="round" />
            <path d="M14 10a3.5 3.5 0 00-4.95 0L6.93 12.12a3.5 3.5 0 004.95 4.95L12.5 15.5" strokeLinecap="round" />
        </svg>
    );
}

export function IconDocument({ className = base }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
            <path d="M8 4h6l4 4v12H8V4z" strokeLinejoin="round" />
            <path d="M14 4v4h4M10 13h6M10 17h4" strokeLinecap="round" />
        </svg>
    );
}

export function IconText({ className = base }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
            <path d="M5 7h14M5 12h10M5 17h14" strokeLinecap="round" />
        </svg>
    );
}

export function IconImage({ className = base }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
            <rect x="4" y="5" width="16" height="14" rx="2" />
            <circle cx="9" cy="10" r="1.5" />
            <path d="M6 17l4-4 3 3 2-2 5 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export function IconPlaylist({ className = base }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
            <path d="M9 6h12M9 12h12M9 18h8" strokeLinecap="round" />
            <circle cx="5" cy="6" r="1.25" fill="currentColor" stroke="none" />
            <circle cx="5" cy="12" r="1.25" fill="currentColor" stroke="none" />
            <circle cx="5" cy="18" r="1.25" fill="currentColor" stroke="none" />
        </svg>
    );
}

export function IconClean({ className = base }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
            <path d="M12 3l7 4v6c0 4-3 7-7 8-4-1-7-4-7-8V7l7-4z" strokeLinejoin="round" />
            <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export function IconBook({ className = base }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
            <path d="M5 5.5A2.5 2.5 0 017.5 3H19v16H7.5A2.5 2.5 0 005 16.5V5.5z" />
            <path d="M5 8h12" strokeLinecap="round" />
        </svg>
    );
}

export function IconSummary({ className = base }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
            <path d="M7 4h10v16H7V4z" strokeLinejoin="round" />
            <path d="M9.5 8h7M9.5 12h5M9.5 16h7" strokeLinecap="round" />
        </svg>
    );
}

export function IconRead({ className = base }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
            <path d="M6 6h12v12H6V6z" strokeLinejoin="round" />
            <path d="M9 10h6M9 14h4" strokeLinecap="round" />
        </svg>
    );
}

export function IconCheck({ className }: IconProps) {
    return (
        <svg
            className={className ? `h-4 w-4 shrink-0 ${className}` : "h-4 w-4 shrink-0"}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden
        >
            <path d="M5 12l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}
