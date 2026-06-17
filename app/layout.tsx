import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import AppShell from "./AppShell";
import { LANG_STORAGE_KEY } from "@/lib/localeConstants";
import { THEME_STORAGE_KEY } from "@/lib/theme";

/** Font Inter pentru tot corpul aplicatiei. */
const inter = Inter({ subsets: ["latin"] });

/** Metadata SEO pentru tab-ul browserului. */
export const metadata: Metadata = {
    title: "AudioScraperAI",
    description: "Cărți audio din text și web",
};

/**
 * Script inline rulat inainte de hidratare: aplica tema dark/light si seteaza
 * atributul lang pe <html> din localStorage.
 */
const themeInit = `
(function(){
  try {
    var k = ${JSON.stringify(THEME_STORAGE_KEY)};
    var t = localStorage.getItem(k);
    if (t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches))
      document.documentElement.classList.add('dark');
    else
      document.documentElement.classList.remove('dark');
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
            <body className={inter.className}>
                {/* Script initializare tema si limba (anti-flash) */}
                <script
                    id="theme-init"
                    dangerouslySetInnerHTML={{ __html: themeInit }}
                />
                <AppShell>{children}</AppShell>
            </body>
        </html>
    );
}
