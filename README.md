# AudioScraperAI

AudioScraperAI este o aplicație full-stack care transformă conținut text (URL-uri, documente, text liber) în cărți audio MP3, cu bibliotecă personală per utilizator și catalog public opțional.

## Ce face proiectul

- extrage text din pagini web;
- extrage text din fișiere (`PDF`, `DOCX`, `EPUB`, `TXT`, imagini);
- curăță și normalizează textul cu Gemini;
- sintetizează voce în limba română (edge-tts / gTTS);
- salvează audio în Supabase Storage;
- salvează metadate în Supabase Postgres;
- oferă bibliotecă per utilizator + pagină publică de prezentare.

## Tehnologii folosite

- **Frontend:** Next.js (App Router), React, TypeScript, Tailwind CSS
- **Backend:** FastAPI, Python
- **Database / Storage:** Supabase (Postgres + Storage)
- **AI:** Google Gemini (curățare text, titlu)
- **TTS:** edge-tts (implicit) / gTTS (fallback)
- **Auth app-level:** JWT emis de backend și trimis ca `Authorization: Bearer ...`

## Cum este construit (pe scurt)

1. Frontend-ul trimite cereri la API-ul FastAPI.
2. Backend-ul:
   - validează token-ul,
   - identifică utilizatorul curent,
   - aplică scoping pe `carti` (în principal prin `user_id`).
3. Pentru generare audio:
   - extragere text brut,
   - curățare AI,
   - sinteză audio,
   - upload MP3 în Storage,
   - insert/update metadate în Postgres.

## Structura repo (relevantă)

- `frontend/` – aplicația Next.js
- `backend/` – API FastAPI + pipeline AI/TTS
- `supabase/migrations/` – migrări SQL
- `documentation/` – documentație detaliată (arhitectură, API, roluri, pipeline)

## Setup rapid

### 1) Backend

```bash
cd backend
python -m pip install -r requirements.txt
python __main__.py
```

Backend rulează implicit pe `http://127.0.0.1:8765`.

### 2) Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend rulează implicit pe `http://localhost:3001`.

### 3) Variabile de mediu backend (`backend/.env`)

- `SUPABASE_URL`
- `SUPABASE_KEY`
- `GEMINI_API_KEY`
- `SECRET_KEY`
- `ADMIN_KEY`

## Migrare bibliotecă per utilizator

Rulează migrarea:

- `supabase/migrations/20260413093000_carti_user_scope.sql`

Aceasta adaugă:

- `carti.user_id` (FK spre `utilizatori.id`)
- indexuri pentru filtrare per utilizator
- RLS + policy de service role

Pentru date vechi (legacy), proprietatea poate rămâne și pe `created_by_email` până la migrarea completă.

## Documentație detaliată

Vezi `documentation/README.md` pentru index complet:

- arhitectură (`documentation/ARCHITECTURE.md`)
- API (`documentation/API-OVERVIEW.md`)
- roluri (`documentation/ROLES.md`)
- pipeline texte lungi (`documentation/PIPELINE-LONG-TEXT.md`)

## Stadiu proiect (ce este deja funcțional)

- Autentificare pe roluri (`admin`, `user`, `guest`) cu JWT emis de backend.
- Generare audiobook din URL (`/extrage`) și din text introdus (`/genereaza_text`).
- Extragere text din fișiere (`/extrage_fisier`): PDF, EPUB, DOCX, TXT, imagini.
- Bibliotecă per utilizator (`/istoric`) cu control de acces pe proprietar.
- Catalog public (`/carti/publice`) cu publicare/depublicare și moderare admin.
- Persistență în Supabase: metadate în Postgres + MP3 în Storage.
- Migrare activă pentru ownership explicit prin `carti.user_id` (`supabase/migrations/20260413093000_carti_user_scope.sql`).

Pentru explicația completă „ce ai implementat, ce ai folosit și cum”, vezi secțiunea
**„Ce este deja implementat (progres curent)”** din `documentation/README.md`.
