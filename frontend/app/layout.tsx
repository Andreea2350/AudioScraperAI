"use client";

import { Inter } from "next/font/google";
import "./globals.css";
import { useState, useEffect } from "react";

const inter = Inter({ subsets: ["latin"] });

export default function RootLayout({
                                       children,
                                   }: Readonly<{
    children: React.ReactNode;
}>) {
    const [isUploadOpen, setIsUploadOpen] = useState(false);

    //retin ce meniu este activ-implicit e biblioteca
    const [activeMenu, setActiveMenu] = useState("biblioteca");

    //ascult daca pagina principala spune sa ma intorc la bibliotec
    useEffect(() => {
        const reseteazaMeniul = () => setActiveMenu("biblioteca");
        window.addEventListener('reseteaza-meniu', reseteazaMeniul);
        return () => window.removeEventListener('reseteaza-meniu', reseteazaMeniul);
    }, []);

    //functii care se activează la click pe butoane
    const deschideModalulDeLink = () => {
        window.dispatchEvent(new Event('deschide-modal-url'));
        setIsUploadOpen(false);
    };

    const apasaAdaugaText = () => {
        setActiveMenu("text");
        window.dispatchEvent(new Event('deschide-modal-text'));
    };

    const apasaBiblioteca = () => {
        setActiveMenu("biblioteca");
        window.dispatchEvent(new Event('arata-biblioteca'));
    };

    //functie care da culoarea verde doar butonului activ din meniu
    const stilButonNavigare = (numeMeniu: string) => {
        if (activeMenu === numeMeniu) {
            return "w-full flex items-center p-3 bg-mid-green/30 rounded-lg font-bold text-left shadow-sm text-white border-l-4 border-light-green transition-all";
        }
        return "w-full flex items-center p-3 rounded-lg hover:bg-white/10 transition-colors text-left text-white opacity-90";
    };

    return (
        <html lang="ro">
        <body className={`${inter.className} flex h-screen overflow-hidden bg-[#F2F5F4]`}>

        <aside className="w-64 bg-dark-green text-light-green flex flex-col shadow-lg z-20 relative">
            <div className="p-6 text-2xl font-bold tracking-wider text-white">
                AudioScraper<span className="text-mid-green">AI</span>
            </div>

            <nav className="flex-1 px-4 space-y-2 mt-4 text-sm font-medium">

                {/*buton Adauga Text*/}
                <button
                    onClick={apasaAdaugaText}
                    className={stilButonNavigare("text")}
                >
                    <span className="mr-3 font-bold text-lg">✎</span> Adaugă Text
                </button>

                {/*buton Incarca Document*/}
                <div className="relative">
                    <button
                        onClick={() => setIsUploadOpen(!isUploadOpen)}
                        className={`w-full flex items-center p-3 rounded-lg transition-colors text-left text-white ${isUploadOpen ? 'bg-white/20' : 'hover:bg-white/10 opacity-90'}`}
                    >
                        <span className="mr-3 font-bold text-lg">↑</span> Încarcă Document
                    </button>

                    {/*popover*/}
                    {isUploadOpen && (
                        <div className="absolute left-[105%] top-0 ml-2 w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-50 animate-fade-in text-darkest">
                            <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                                <span className="font-bold text-gray-800 text-base">Adaugă Sursă</span>
                                <button onClick={() => setIsUploadOpen(false)} className="text-gray-400 hover:text-gray-700 font-bold text-xl leading-none">&times;</button>
                            </div>

                            <div className="p-2 space-y-1">
                                <button className="flex items-start w-full p-3 hover:bg-gray-50 rounded-xl transition-colors text-left group">
                                    <div className="text-gray-400 group-hover:text-mid-green mt-1 mr-4">
                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"></path></svg>
                                    </div>
                                    <div>
                                        <div className="font-bold text-gray-800 text-sm mb-0.5">Document</div>
                                        <div className="text-xs text-gray-500 leading-relaxed">Adaugă PDF, documente Word sau fișiere din calculator.</div>
                                    </div>
                                </button>

                                <button className="flex items-start w-full p-3 hover:bg-gray-50 rounded-xl transition-colors text-left group">
                                    <div className="text-gray-400 group-hover:text-mid-green mt-1 mr-4">
                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                    </div>
                                    <div>
                                        <div className="font-bold text-gray-800 text-sm mb-0.5">Imagine</div>
                                        <div className="text-xs text-gray-500 leading-relaxed">Încarcă imagini scanate, poze sau capturi de ecran.</div>
                                    </div>
                                </button>

                                <button
                                    onClick={deschideModalulDeLink}
                                    className="flex items-start w-full p-3 hover:bg-gray-50 rounded-xl transition-colors text-left group"
                                >
                                    <div className="text-gray-400 group-hover:text-mid-green mt-1 mr-4">
                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>
                                    </div>
                                    <div>
                                        <div className="font-bold text-gray-800 text-sm mb-0.5">Link Pagină Web</div>
                                        <div className="text-xs text-gray-500 leading-relaxed">Extrage și ascultă textul dintr-un articol de pe internet.</div>
                                    </div>
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/*buton Biblioteca*/}
                <button
                    onClick={apasaBiblioteca}
                    className={stilButonNavigare("biblioteca")}
                >
                    <span className="mr-3 font-bold text-lg">🕮</span> Bibliotecă
                </button>

                <div className="border-t border-light-green/20 my-4"></div>

                <button className="w-full flex items-center p-3 rounded-lg hover:bg-white/10 transition-colors text-left opacity-80 text-white">
                    <span className="mr-3 font-bold text-lg"></span> Mai multe funcții ▾
                </button>
            </nav>
        </aside>

        <div className="flex-1 flex flex-col z-10">
            <header className="h-16 bg-white flex items-center justify-end px-8 shadow-sm border-b border-gray-200">
                <div className="flex items-center space-x-6">
                    <button className="text-dark-green font-medium hover:text-mid-green transition-colors">Tema</button>
                    <div className="w-10 h-10 bg-mid-green rounded-full flex items-center justify-center text-white font-bold shadow-md">AL</div>
                </div>
            </header>

            <main className="flex-1 p-8 overflow-y-auto">
                {children}
            </main>
        </div>
        </body>
        </html>
    );
}