import type { Metadata } from "next";
import { Inter, Lexend } from "next/font/google";
import "./globals.css";
import AppShell from "./AppShell";
import { ToastHost } from "@/components/ToastHost";
import { ConfirmHost } from "@/components/ConfirmHost";
import { LANG_STORAGE_KEY } from "@/lib/localeConstants";
import { THEME_STORAGE_KEY } from "@/lib/theme";

/** Font Inter pentru tot corpul aplicatiei. */
const inter = Inter({ subsets: ["latin"] });

/** Lexend — folosit doar pe blocurile cu clasa .reading-accessible. */
const lexend = Lexend({
    subsets: ["latin", "latin-ext"],
    variable: "--font-lexend",
    display: "swap",
});

/** Metadata SEO pentru tab-ul browserului. */
export const metadata: Metadata = {
    title: "Text2Book",
    description: "Cărți audio din text și web",
};

export const viewport = {
    width: "device-width",
    initialScale: 1,
};

/**
 * Script care ruleaza inainte ca React sa "hidrateze" pagina. Rolul lui e sa aplice tema (dark/light)
 * si limba pe elementul <html> CHIAR de la primul randare, ca sa nu apara o palpaire alba inainte sa porneasca React.
 * E scris ca string si injectat in <head>, deci nu poate folosi importurile mele - de aia citeste direct din localStorage.
 */
const themeInit = `
(function(){
  try {
    // Citesc tema salvata; daca utilizatorul n-a ales nimic, ma iau dupa setarea sistemului de operare.
    var k = ${JSON.stringify(THEME_STORAGE_KEY)};
    var t = localStorage.getItem(k);
    var dark = false;
    if (t === 'dark') dark = true;
    else if (t === 'light') dark = false;
    else dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    // Pun sau scot clasa "dark" pe <html>; restul stilurilor se bazeaza pe ea.
    if (dark) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    // Setez si limba pe <html lang="..."> dupa ce e salvat in localStorage (implicit romana).
    var lk = ${JSON.stringify(LANG_STORAGE_KEY)};
    var lang = localStorage.getItem(lk);
    document.documentElement.lang = lang === 'en' ? 'en' : 'ro';
  } catch (e) {}
})();`;

/** Layout radacina HTML: font, script tema, wrapper AppShell pentru toate rutele. */
export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="ro" suppressHydrationWarning>
            <body className={`${inter.className} ${lexend.variable}`}>
                {/* Script initializare tema si limba (anti-flash) */}
                <script
                    id="theme-init"
                    dangerouslySetInnerHTML={{ __html: themeInit }}
                />
                <AppShell>{children}</AppShell>
                <ToastHost />
                <ConfirmHost />
            </body>
        </html>
    );
}
