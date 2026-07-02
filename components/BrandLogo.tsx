type BrandLogoProps = {
    /** Culoarea cifrei „2” (accent galben). */
    accentColor?: string;
    /** Culoarea pentru „Text” și „Book”. */
    textColor?: string;
    className?: string;
};

/** Logo-ul aplicației: Text + 2 (accent) + Book. */
export function BrandLogo({
    accentColor = "var(--sidebar-brand-accent)",
    textColor = "#ffffff",
    className = "",
}: BrandLogoProps) {
    return (
        <span className={className}>
            <span style={{ color: textColor }}>Text</span>
            <span style={{ color: accentColor }}>2</span>
            <span style={{ color: textColor }}>Book</span>
        </span>
    );
}
