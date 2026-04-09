"use client";

import { useState, useEffect } from "react";

export default function Home() {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [url, setUrl] = useState("");
    const [forceRegenerate, setForceRegenerate] = useState(false);

    const [showTextEditor, setShowTextEditor] = useState(false);
    const [titluText, setTitluText] = useState("");
    const [textManual, setTextManual] = useState("");

    const [isLoading, setIsLoading] = useState(false);
    const [istoricCarti, setIstoricCarti] = useState<any[]>([]);
    const [carteaCurenta, setCarteaCurenta] = useState<any>(null);

    //ascultatori ptr comunicarea cu meniul lateral---
    useEffect(() => {
        const deschideFereastraUrl = () => setIsModalOpen(true);

        const deschideEcranText = () => {
            setCarteaCurenta(null);
            setShowTextEditor(true);
        };

        const arataBiblioteca = () => {
            setCarteaCurenta(null);
            setShowTextEditor(false);
        };

        window.addEventListener('deschide-modal-url', deschideFereastraUrl);
        window.addEventListener('deschide-modal-text', deschideEcranText);
        window.addEventListener('arata-biblioteca', arataBiblioteca);

        return () => {
            window.removeEventListener('deschide-modal-url', deschideFereastraUrl);
            window.removeEventListener('deschide-modal-text', deschideEcranText);
            window.removeEventListener('arata-biblioteca', arataBiblioteca);
        };
    }, []);

    useEffect(() => {
        const fetchIstoric = async () => {
            try {
                const response = await fetch("http://localhost:8000/istoric");
                const json = await response.json();

                if (json.status === "success" && json.data) {
                    const cartiFormatate = json.data.map((item: any) => ({
                        id: item.id,
                        titlu: item.titlu || "Articol Fără Titlu",
                        url_sursa: item.url,
                        status: "Complet",
                        link_audio: item.audio_link,
                        text_extras: item.text_curatat,
                        data_generare: new Date(item.creat_la).toLocaleDateString("ro-RO")
                    }));
                    setIstoricCarti(cartiFormatate);
                }
            } catch (error) {
                console.error("Eroare la încărcarea istoricului:", error);
            }
        };

        fetchIstoric();
    }, []);

    const handleGenereaza = async () => {
        if (!url) {
            alert("Te rog introdu un link valid!");
            return;
        }
        setIsLoading(true);
        try {
            const response = await fetch("http://localhost:8000/extrage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url, force_regenerate: forceRegenerate }),
            });
            const data = await response.json();
            const carteNoua = {
                id: Date.now(),
                titlu: data.titlu || "Articol Web",
                url_sursa: url,
                status: data.status,
                link_audio: data.link_ascultare || data.link_audio,
                text_extras: data.text_final_audio,
                data_generare: new Date().toLocaleDateString("ro-RO")
            };
            setIstoricCarti((cartiVechi) => [carteNoua, ...cartiVechi]);
            setCarteaCurenta(carteNoua);

            setShowTextEditor(false);
            window.dispatchEvent(new Event('reseteaza-meniu')); // Meniul se face verde pe Biblioteca
        } catch (error) {
            alert("A apărut o eroare la conectarea cu serverul.");
        } finally {
            setIsLoading(false);
            setIsModalOpen(false);
            setUrl("");
        }
    };

    const handleGenereazaDinText = async () => {
        if (!titluText || !textManual) {
            alert("Te rog introdu un titlu și un text!");
            return;
        }
        setIsLoading(true);
        try {
            const response = await fetch("http://localhost:8000/genereaza_text", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ titlu: titluText, text: textManual }),
            });
            const data = await response.json();
            const carteNoua = {
                id: Date.now(),
                titlu: titluText,
                url_sursa: "Text Adăugat Manual",
                status: data.status,
                link_audio: data.link_audio,
                text_extras: data.text_final_audio,
                data_generare: new Date().toLocaleDateString("ro-RO")
            };
            setIstoricCarti((cartiVechi) => [carteNoua, ...cartiVechi]);

            setCarteaCurenta(carteNoua);
            setShowTextEditor(false);
            window.dispatchEvent(new Event('reseteaza-meniu')); // Meniul se face verde pe Biblioteca
        } catch (error) {
            alert("Eroare la generarea textului.");
        } finally {
            setIsLoading(false);
            setTitluText("");
            setTextManual("");
        }
    };

    return (
        <div className="flex flex-col h-full relative p-4 lg:p-8">

            {carteaCurenta ? (

                //ecran player audio
                <div className="w-full max-w-4xl mx-auto bg-white p-10 rounded-3xl shadow-sm border border-gray-100 animate-fade-in mt-4">
                    <button
                        onClick={() => {
                            setCarteaCurenta(null);
                            window.dispatchEvent(new Event('reseteaza-meniu'));
                        }}
                        className="text-gray-400 font-bold hover:text-dark-green transition-colors flex items-center mb-6 text-sm uppercase tracking-wider"
                    >
                        <span className="mr-2 text-lg">←</span> Înapoi la Bibliotecă
                    </button>
                    <div className="mb-8 border-b border-gray-100 pb-6">
                        <h2 className="text-3xl font-extrabold text-dark-green mb-2">{carteaCurenta.titlu}</h2>

                        {carteaCurenta.url_sursa === "Text Adăugat Manual" ? (
                            <span className="text-sm text-gray-500">Sursă: Text Adăugat Manual</span>
                        ) : (
                            <a
                                href={carteaCurenta.url_sursa}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm font-medium text-mid-green hover:text-dark-green hover:underline cursor-pointer inline-flex items-center"
                            >
                                Deschide sursa originală <span className="ml-1 text-xs">↗</span>
                            </a>
                        )}
                    </div>
                    <div className="bg-[#F2F5F4] p-8 rounded-2xl mb-8 shadow-inner flex items-center justify-center">
                        <audio controls className="w-full max-w-2xl" autoPlay>
                            <source src={carteaCurenta.link_audio} type="audio/mpeg" />
                            Browser-ul tău nu suportă elementul audio.
                        </audio>
                    </div>
                    <div className="mb-4">
                        <h3 className="font-bold text-sm text-gray-400 uppercase tracking-widest mb-4">Text Extras</h3>
                        <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100 h-96 overflow-y-auto">
                            <p className="text-gray-700 leading-relaxed text-sm whitespace-pre-wrap">
                                {carteaCurenta.text_extras}
                            </p>
                        </div>
                    </div>
                </div>

            ) : showTextEditor ? (

                // ecran editor de text
                <div className="w-full max-w-4xl mx-auto flex flex-col h-[85vh] mt-4 animate-fade-in">
                    <div className="bg-white p-10 rounded-3xl shadow-sm border border-gray-100 flex flex-col flex-1">

                        <div className="flex justify-center mb-8">
                            <input
                                type="text"
                                placeholder="Titlul materialului"
                                className="w-3/4 max-w-md border-b-2 border-gray-200 p-2 text-xl focus:outline-none focus:border-mid-green text-gray-800 font-bold bg-transparent transition-colors text-center"
                                value={titluText}
                                onChange={(e) => setTitluText(e.target.value)}
                            />
                        </div>

                        <textarea
                            placeholder="Tastează, lipește sau editează textul aici..."
                            className="w-full flex-1 border-0 p-4 focus:outline-none resize-none text-gray-700 leading-relaxed text-lg bg-transparent"
                            value={textManual}
                            onChange={(e) => setTextManual(e.target.value)}
                        />

                        <div className="mt-6 pt-6 border-t border-gray-100 flex justify-center">
                            <button
                                onClick={handleGenereazaDinText}
                                className="px-10 py-4 bg-mid-green text-white font-bold text-lg rounded-full hover:bg-dark-green disabled:opacity-50 flex items-center shadow-md transition-transform hover:scale-105"
                                disabled={isLoading}
                            >
                                {isLoading ? "Se Generează..." : "▶ Generează Audio"}
                            </button>
                        </div>
                    </div>
                </div>

            ) : (

                // ecran biblioteca
                <div className="flex-1 flex flex-col items-center justify-center">
                    {istoricCarti.length === 0 ? (
                        <div className="animate-fade-in opacity-80 mt-[-10vh] text-center">
                            <div className="text-6xl mb-6 grayscale opacity-40">📚</div>
                            <h1 className="text-4xl font-extrabold mb-4 text-darkest">Rafturile tale sunt goale.</h1>
                            <p className="text-lg text-dark-green max-w-md mx-auto">
                                Folosește meniul din stânga pentru a adăuga prima ta carte.
                            </p>
                        </div>
                    ) : (
                        <div className="w-full h-full pt-4 animate-fade-in flex flex-col justify-start items-start">
                            <h1 className="text-3xl font-extrabold text-dark-green mb-8">Biblioteca Mea</h1>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
                                {istoricCarti.map((carte) => (
                                    <div
                                        key={carte.id}
                                        className="bg-white p-6 rounded-2xl shadow-sm hover:shadow-xl transition-all border border-gray-100 cursor-pointer group flex flex-col h-full"
                                        onClick={() => setCarteaCurenta(carte)}
                                    >
                                        <div className="w-12 h-12 bg-light-green/40 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform text-dark-green">
                                            🎧
                                        </div>
                                        <h3 className="font-bold text-gray-800 mb-1 line-clamp-2" title={carte.titlu}>
                                            {carte.titlu}
                                        </h3>
                                        <p className="text-xs text-gray-400 mb-4 truncate flex-grow" title={carte.url_sursa}>
                                            {carte.url_sursa}
                                        </p>
                                        <div className="flex justify-between items-center text-xs font-bold text-mid-green mt-auto pt-4 border-t border-gray-50">
                                            <span>{carte.data_generare}</span>
                                            <span className="flex items-center">Ascultă <span className="ml-1">▶</span></span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/*modal procesare url*/}
            {isModalOpen && (
                <div className="fixed inset-0 bg-darkest/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in p-4">
                    <div className="bg-white p-8 rounded-3xl shadow-2xl w-full max-w-lg text-left border border-gray-100">
                        <h2 className="text-2xl font-extrabold text-dark-green mb-2">Procesare URL</h2>
                        <p className="text-gray-500 text-sm mb-6">Introdu link-ul articolului. AI-ul va curăța automat reclamele și meniurile.</p>

                        <label className="block text-sm font-bold text-gray-700 mb-2">Link-ul paginii web:</label>
                        <input
                            type="text"
                            placeholder="https://..."
                            className="w-full border-2 border-gray-200 rounded-xl p-4 mb-5 focus:outline-none focus:border-mid-green focus:ring-4 focus:ring-light-green/20"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                        />

                        <label className="flex items-center space-x-3 mb-8 cursor-pointer bg-[#F2F5F4] p-4 rounded-xl hover:bg-gray-100">
                            <input
                                type="checkbox"
                                className="w-5 h-5 accent-mid-green rounded cursor-pointer"
                                checked={forceRegenerate}
                                onChange={(e) => setForceRegenerate(e.target.checked)}
                            />
                            <span className="text-dark-green text-sm font-medium">Forțează regenerarea AI</span>
                        </label>

                        <div className="flex justify-end space-x-3">
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="px-6 py-3 text-gray-500 font-bold hover:bg-gray-100 rounded-xl"
                                disabled={isLoading}
                            >
                                Anulează
                            </button>
                            <button
                                onClick={handleGenereaza}
                                className="px-8 py-3 bg-mid-green text-white font-bold rounded-xl hover:bg-dark-green disabled:opacity-50 flex items-center shadow-lg"
                                disabled={isLoading}
                            >
                                {isLoading ? "AI-ul citește..." : "Generează Audio"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}