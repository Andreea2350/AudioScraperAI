from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
#biblioteca pentru a crea un model de date - CerereExtragere
import requests
from bs4 import BeautifulSoup
import os #permite sa lucrez cu fisiere si directoare, variabile de mediu
from gtts import gTTS #import Google Text to Speech
from dotenv import load_dotenv #incarc variabile din .env
import google.generativeai as genai #imi permite sa folosesc modele AI de la google
from supabase import create_client, Client
import time


#ia cheia din .env si o pune in Environement Variables
load_dotenv()

#extrag cheia din env vars si ma autentific ca sa pot folosi Gemini
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

#modelul de AI folosit
model = genai.GenerativeModel('gemini-2.5-flash')

#configurare Supabase
URL_BAZA_DATE = os.getenv("SUPABASE_URL")
CHEIE_BAZA_DATE = os.getenv("SUPABASE_KEY")

#instantiere client
supabase: Client = create_client(URL_BAZA_DATE, CHEIE_BAZA_DATE)

#initializez aplicatia
app = FastAPI(title="Motor AI Audiobooks", version="1.0")

#frontend comunica cu backend FastAPI
app.add_middleware(
    CORSMiddleware,
    #mai multe porturi pentru a acoperi orice varianta a lui Next.js
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://localhost:3002"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

#definesc datele
class CerereExtragere(BaseModel):
    url: str
    force_regenerate: bool = False #by default o sa fie false, doar daca se cere

class TextLiberRequest(BaseModel):
    titlu: str
    text: str

#endpoint de verificare-confirma ca server e pornit
@app.get("/")
async def salut_licenta():
    return {"mesaj": "Salut! Serverul functioneaza.", "status": "Activ"}

#creez endpoint nou pentru carti
#folosesc POST pentru a trimite date laserver
@app.post("/extrage")
async def extrage_text(cerere: CerereExtragere):
    try:
        #caut in tabelul carti un rand cu acelasi URL
        raspuns_db = supabase.table("carti").select("*").eq("url", cerere.url).execute()
        cartea_exista = len(raspuns_db.data) > 0

        #daca am gasit cartea si user nu a dat generare fortata
        if cartea_exista and not cerere.force_regenerate:
            print("Cartea a fost gasita in memorie! Se returneaza instant.")
            carte_gasita = raspuns_db.data[0] #iua primul/singurul rezultat

            return {
                "status": "Succes (Din Memorie). Daca textul a fost actualizat pe site, bifati 'force_regenerate'.",
                "lungime_text_curatat_ai": len(carte_gasita["text_curatat"]),
                "link_ascultare": carte_gasita["audio_link"],
                "text_final_audio": carte_gasita["text_curatat"]
            }

        #am ajuns aici=am link nou sau force_regenerate=True
        if cerere.force_regenerate and cartea_exista:
            print(f"Utilizatorul a fortat regenerarea! Rescriem datele pentru: {cerere.url}")
        else:
            print(f"Link nou detectat. Se incepe procesarea: {cerere.url}")

        # fac cererea HTTP simuland un browser real
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}

        #fac cererea HTTP simuland un browser real
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        response = requests.get(cerere.url, headers=headers)
        #verific daca linkul functioneaza
        response.raise_for_status()

        #incarc HTML descarcat in BeautifulSoup
        soup = BeautifulSoup(response.text, 'html.parser')

        #extrag titlul paginii web automat
        titlu_pagina = soup.title.string.strip() if soup.title and soup.title.string else "Articol Web"

        #elimin codul inutil care incurca AIul)
        for element_inutil in soup(["script", "style", "header", "footer", "nav", "aside"]):
            element_inutil.extract()

        #extrag doar textul si adaug un spatiu dupa ce elimi  un text
        #elimin spatiile mari cu strip
        text_brut = soup.get_text(separator=' ', strip=True)


        #dau instructiuni AI-ului
        prompt = f"""
        Esti un editor de carti audio. Mai jos ai un text extras de pe un site web. Textul contine o naratiune, 
        dar mai are și meniuri de navigare, butoane, reclame, numere de pagina, texte ca 'Romanian Books').
        Sarcina ta este sa extragi doar naratiunea cartii. Elimina orice element de meniu sau text irelevant.
        Returneaza textul curat al povestii. Fara introduceri de tipul "Iata textul".
        
        Text brut extras de pe site:
        {text_brut[:15000]} 
        """
        #maxim 15 000 de caractere ca sa nu blochez ai-ul

        #trimit prompt si raspunsul il salvez in raspuns_ai
        raspuns_ai = model.generate_content(prompt)
        text_curat_ai = raspuns_ai.text.strip()
        #pastrez doar textul cu .text si elimin eventualele spatii goale del a inceput sau de la sf textului de AI

        #folosesc doar primele 2000 de caractere ca sa se miste foarte repede
        prompt_titlu = f"""
        Citeste inceputul acestui text si extrage DOAR titlul principal al cartii sau articolului.
        Nu include numele autorului, numele site-ului sau alte texte (precum "Cărți pe care le puteți citi...").
        Returneaza STRICT titlul, fara ghilimele si fara alte explicatii.
        
        Text:
        {text_brut[:2000]}
        """
        raspuns_ai_titlu = model.generate_content(prompt_titlu)
        titlu_ai_curat = raspuns_ai_titlu.text.strip()

        #elimin eventualele ghilimele duble cu care ar putea veni de la AI
        titlu_ai_curat = titlu_ai_curat.replace('"', '').replace('„', '').replace('”', '')

        #gTTS primeste textul curatat, precizez ca e in romana si viteza normala
        audio = gTTS(text=text_curat_ai, lang='ro', slow=False)
        #salvez fisier
        test = "test1.mp3"
        audio.save(test)

        #generez nume unic pt fisier
        nume_fisier_cloud = f"carte_{int(time.time())}.mp3"

        #deschid test1.mp3 si il urc in 'audio-books' in Supabase
        with open(test, "rb") as fisier_audio:
            supabase.storage.from_("audio-books").upload(nume_fisier_cloud, fisier_audio)

        #obtin link public de la Supabase
        link_public = supabase.storage.from_("audio-books").get_public_url(nume_fisier_cloud)

        #salvez sau actualizez randul in tabelul carti
        date_carte = {
            "titlu": titlu_ai_curat,
            "url": cerere.url,
            "text_curatat": text_curat_ai,
            "audio_link": link_public
        }

        if cartea_exista:
            #daca exista deja, update pe baza id-ului ei
            id_vechi = raspuns_db.data[0]["id"]
            supabase.table("carti").update(date_carte).eq("id", id_vechi).execute()
        else:
            #daca nu exista, insert rand nou
            supabase.table("carti").insert(date_carte).execute()

        return {
            "status": "Succes, cartea a fost generata si salvata in Cloud!",
            "titlu": titlu_ai_curat,
            "lungime_text_curatat_ai": len(text_curat_ai),
            "link_audio": link_public,
            "text_final_audio": text_curat_ai
        }

    except Exception as eroare:
        return {"status": "Eroare", "detalii": str(eroare)}

#generare din text manual
@app.post("/genereaza_text")
async def genereaza_din_text(req: TextLiberRequest):
    try:
        nume_fisier = f"carte_text_{int(time.time())}.mp3"

        #generez fisierul mp3 direct din text
        tts = gTTS(text=req.text, lang='ro')
        tts.save(nume_fisier)

        #incarc in Supabase Storage
        with open(nume_fisier, "rb") as f:
            supabase.storage.from_("audio-books").upload(file=f, path=nume_fisier, file_options={"content-type": "audio/mpeg"})

        link_public = supabase.storage.from_("audio-books").get_public_url(nume_fisier)

        #salvez in tabelul 'carti'
        supabase.table("carti").insert({
            "titlu": req.titlu, #titlu pus de user
            "url": "Text Adăugat Manual", #in loc de link pun textul introdus
            "text_curatat": req.text,
            "audio_link": link_public
        }).execute()

        #sterg fisierul local pt a nu ocupa spatiu
        if os.path.exists(nume_fisier):
            os.remove(nume_fisier)

        return {
            "status": "Succes (Generare Directă)",
            "titlu": req.titlu, #titlu introdus de user
            "link_audio": link_public,
            "text_final_audio": req.text
        }
    except Exception as e:
        print(f"Eroare la generarea textului liber: {e}")
        return {"status": "error", "message": str(e)}

@app.get("/istoric")
async def get_istoric():
    try:
        response = supabase.table("carti").select("*").order("creat_la", desc=True).execute()

        return {"status": "success", "data": response.data}
    except Exception as e:
        print(f"Eroare la preluarea istoricului din Supabase: {e}")
        return {"status": "error", "message": str(e)}