# AudioScraperAI

AudioScraperAI este o aplicație full-stack care transformă conținut text (URL-uri, documente, text liber) în cărți audio MP3, cu bibliotecă personală per utilizator și catalog public opțional.

## Ce face proiectul

- extrage text din pagini web și din fișiere (`PDF`, `DOCX`, `EPUB`, `TXT`, imagini);
- curăță și normalizează textul cu Gemini (opțional pentru text lipit manual);
- sintetizează voce în limba română (edge-tts / gTTS), cu tăiere inteligentă pe propoziții;
- generează audio **pe părți** (playlist live) pentru text, URL și fișiere;
- pentru texte foarte lungi (≥ 50.000 caractere), detectează **capitole** în playlist;
- salvează segmentele + MP3 final în Supabase Storage;
- oferă bibliotecă per utilizator, redare din playlist în aplicație, descărcare MP3 complet;
- suport **oaspete** cu previzualizare gratuită (primele ~5.000 caractere).

## Tehnologii

- **Frontend:** Next.js (App Router), React, TypeScript, Tailwind CSS
- **Backend:** FastAPI, Python
- **Database / Storage:** Supabase (Postgres + Storage)
- **AI:** Google Gemini
- **TTS:** edge-tts (implicit) / gTTS (fallback)
- **Auth:** JWT emis de backend (`Authorization: Bearer ...`)

## Structura repo

- `app/`, `lib/`, `components/` – aplicația Next.js (deploy Vercel din rădăcina repo-ului)
- `frontend/` – copie sincronizată pentru development / Docker
- `backend/` – API FastAPI + pipeline AI/TTS
- `api/` – intrare Python pentru Vercel (`/api/*`)

## Setup local

### Backend

```bash
cd backend
python -m pip install -r requirements.txt
python __main__.py
```

Rulează pe `http://127.0.0.1:8765`.

### Frontend

```bash
npm install
npm run dev
```

Rulează pe `http://localhost:3001` (din rădăcina repo-ului sau din `frontend/`).

### Variabile de mediu (`backend/.env`)

- `SUPABASE_URL`
- `SUPABASE_KEY` (service role)
- `GEMINI_API_KEY`
- `SECRET_KEY`
- `ADMIN_KEY`

Pe **Vercel**, aceleași variabile se setează în *Project → Settings → Environment Variables*.

## Supabase (SQL Editor)

După ce creezi proiectul Supabase, rulează în **SQL Editor** scripturile de mai jos (în ordine). Activează **RLS** când ți se cere.

### Tabele guest + segmente playlist

```sql
CREATE TABLE IF NOT EXISTS guest_sessions (
    id UUID PRIMARY KEY,
    credits_remaining INT NOT NULL DEFAULT 5000,
    credits_used INT NOT NULL DEFAULT 0,
    jobs_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days')
);

CREATE TABLE IF NOT EXISTS carti_segmente (
    id BIGSERIAL PRIMARY KEY,
    carte_id BIGINT NOT NULL REFERENCES carti(id) ON DELETE CASCADE,
    segment_index INT NOT NULL,
    text_fragment TEXT NOT NULL,
    audio_link TEXT NOT NULL,
    char_count INT NOT NULL DEFAULT 0,
    creat_la TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (carte_id, segment_index)
);

CREATE INDEX IF NOT EXISTS idx_carti_segmente_carte ON carti_segmente (carte_id, segment_index);

ALTER TABLE carti ADD COLUMN IF NOT EXISTS guest_session_id UUID;

CREATE INDEX IF NOT EXISTS idx_carti_guest_session ON carti (guest_session_id) WHERE guest_session_id IS NOT NULL;

ALTER TABLE guest_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE carti_segmente ENABLE ROW LEVEL SECURITY;
```

### Capitole + previzualizare guest

```sql
ALTER TABLE carti_segmente ADD COLUMN IF NOT EXISTS chapter_index INT;
ALTER TABLE carti_segmente ADD COLUMN IF NOT EXISTS chapter_title TEXT;

ALTER TABLE carti ADD COLUMN IF NOT EXISTS is_guest_preview BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE carti ADD COLUMN IF NOT EXISTS source_char_total INT;
ALTER TABLE carti ADD COLUMN IF NOT EXISTS playlist_mode TEXT NOT NULL DEFAULT 'parts';
```

## Deploy (Vercel + domeniu public)

Repo-ul este legat de **GitHub** (`Andreea2350/AudioScraperAI`). La **push pe `main`**, Vercel construiește automat proiectul; când deployment-ul este *Ready*, domeniul public afișează versiunea nouă.

1. Commit + `git push origin main`
2. Verifică build-ul în [Vercel Dashboard](https://vercel.com/dashboard) → Deployments
3. Asigură-te că variabilele de mediu sunt setate pe Vercel
4. Rulează scripturile SQL în Supabase (dacă nu le-ai rulat deja)

**Notă:** generarea audio poate dura 1–2 minute; pe planuri Vercel cu timeout scurt, textele lungi pot eșua — pentru cărți foarte mari, un server propriu (Docker) este mai potrivit.

## Funcționalități principale

- Roluri: `admin`, `user`, `guest`
- Generare din URL (`/extrage/stream`), text (`/genereaza_text/stream`), fișier (`/genereaza_fisier/stream`)
- Playlist live la generare + același playlist la deschiderea cărții din bibliotecă
- Descărcare / partajare: MP3 final lipit; ascultare în app: segmente pentru încărcare rapidă
- Catalog public pe pagina de start
