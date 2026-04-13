import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import AppShell from "./AppShell";
import { LANG_STORAGE_KEY } from "@/lib/localeConstants";
import { THEME_STORAGE_KEY } from "@/lib/theme";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
    title: "AudioScraperAI",
    description: "Cărți audio din text și web",
};

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

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="ro" suppressHydrationWarning>
            <body className={inter.className}>
                <script
                    id="theme-init"
                    dangerouslySetInnerHTML={{ __html: themeInit }}
                />
                <AppShell>{children}</AppShell>
            </body>
        </html>
    );
}
