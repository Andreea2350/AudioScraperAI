# AudioScraperAI — Documentație

Platformă web pentru **cărți audio** generate din surse diverse: URL web, PDF, DOCX, TXT, imagini (OCR prin Gemini) sau text introdus manual. Stack: **Next.js** (frontend), **FastAPI** (backend), **Supabase** (PostgreSQL + Storage pentru MP3), **Google Gemini** (curățare text), **edge-tts/gTTS** (voce în română).

---

## Cuprins documentație

| Fișier | Descriere |
|--------|-----------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Componente, flux date, diagramă logică |
| [PIPELINE-LONG-TEXT.md](./PIPELINE-LONG-TEXT.md) | **Texte lungi**: fragmentare Gemini, TTS paralel, ffmpeg, variabile env |
| [ROLES.md](./ROLES.md) | Roluri **admin** / **user** / **guest** și drepturi |
| [API-OVERVIEW.md](./API-OVERVIEW.md) | Endpoints REST, autentificare JWT |
| [SUPABASE-MIGRATION-CARTI.sql](./SUPABASE-MIGRATION-CARTI.sql) | Coloane `is_public`, `created_by_email`, `user_id` + RLS pe `carti` |
| [ASSIGN-BOOKS-TO-USER.sql](./ASSIGN-BOOKS-TO-USER.sql) | Atribuire cărți vechi unui utilizator |
| [SUPABASE-CLI-PUSH.md](./SUPABASE-CLI-PUSH.md) | Push migrări cu Supabase CLI (`db push`) |

---

## Funcții principale ale aplicației

1. **Extragere din URL** (`POST /extrage`): descarcă pagina, extrage text, îl curăță cu Gemini (pe fragmente dacă e lung), generează MP3 și salvează în Supabase.
2. **Extragere din fișier** (`POST /extrage_fisier`): PDF/DOCX/TXT/imagine → text brut (fără curățare Gemini automată în acest pas).
3. **Generare din text** (`POST /genereaza_text`): text manual → MP3 (cu fragmentare automată dacă e lung).
4. **Istoric** (`GET /istoric`): cărțile vizibile în funcție de rol, apoi strict pe proprietar (`user_id`, fallback `created_by_email` pentru date legacy).
5. **Catalog public** (`GET /carti/publice`): cărți cu `is_public = true` pentru landing și magazin.
6. **Landing** (`/intro` în frontend): header, **patru player-e audio** cu cele mai recente cărți publice, grilă completă sub „Bibliotecă publică”.

---

## Ce este deja implementat (progres curent)

### 1) Funcționalități finalizate

- Autentificare cu **JWT** pentru rolurile `admin`, `user`, `guest` (`/login`, `/register`, `/verifica-token`).
- Generare audiobook din **URL** (`/extrage`) cu flux complet: extragere text, curățare AI, TTS, upload MP3, salvare metadate.
- Generare audiobook din **text introdus manual** (`/genereaza_text`).
- Extragere text din **fișiere** (`/extrage_fisier`): `PDF`, `EPUB`, `DOCX`, `TXT`, imagini.
- Bibliotecă personală (`/istoric`) cu separare pe proprietar și fallback legacy.
- Catalog public (`/carti/publice`) + schimbare vizibilitate (`PATCH /carti/{id}/public`) + moderare admin (`DELETE /admin/carti-publice/{id}`).
- Operații pe carte: redenumire (`PUT /redenumeste/{id}`) și ștergere (`DELETE /sterge/{id}`), cu verificare strictă de drepturi.

### 2) Ce tehnologii ai folosit

- **Frontend:** Next.js (App Router), React, TypeScript, Tailwind.
- **Backend:** FastAPI + Pydantic pentru validări.
- **Bază de date / fișiere:** Supabase Postgres (`carti`, `utilizatori`) + Supabase Storage (`audio-books`).
- **AI:** Google Gemini pentru curățarea textului și titlu automat.
- **Text-to-Speech:** `edge-tts` (principal), `gTTS` fallback în pipeline.
- **Securitate:** JWT semnat în backend + politici RLS pe tabelul `carti`.

### 3) Cum a fost implementat (metodă de lucru)

1. Ai separat aplicația pe module: frontend pentru UI, backend pentru logică, Supabase pentru persistență.
2. Ai implementat endpoint-uri FastAPI incremental, cu modele Pydantic și coduri HTTP clare (`401`, `403`, `422`, `503` etc.).
3. Ai adăugat pipeline pentru texte lungi: împărțire în fragmente, prelucrare AI/TTS pe bucăți, apoi concatenare într-un singur MP3.
4. Ai introdus proprietar explicit prin `user_id` (migrare SQL) și ai păstrat compatibilitate pentru date vechi prin `created_by_email`.
5. Ai conectat frontend-ul prin helper-ele din `frontend/lib/api.ts` (token activ din localStorage, headere auth JSON/multipart, parsare erori FastAPI).
6. Ai validat fluxurile cheie în aplicație: login, generare audio, istoric per user, publicare și ștergere.

### 4) Migrarea importantă deja făcută

- Fișier: `supabase/migrations/20260413093000_carti_user_scope.sql`
- Efect:
  - adăugare coloană `carti.user_id` (FK la `utilizatori.id`);
  - indexuri pentru interogări rapide per utilizator;
  - activare RLS și policy pentru service role.
- În backend, verificările de proprietar folosesc prioritar `user_id`, cu fallback `created_by_email` pentru înregistrări legacy.

---

## Pornire rapidă (dezvoltare)

### Cerințe

- **Node.js** (pentru Next.js)
- **Python 3.10+**
- Cont **Supabase** (URL + cheie service role în `.env`)
- **GEMINI_API_KEY** (Google AI Studio)
- **ffmpeg** / **ffprobe** în PATH — concatenare și verificare MP3 (vezi [PIPELINE-LONG-TEXT.md](./PIPELINE-LONG-TEXT.md))
- **edge-tts** (în `requirements.txt`) — TTS implicit (Microsoft Edge); alternativ `TTS_ENGINE=gtts` pentru Google gTTS

### Pași

1. **Baza de date:** rulează migrarea SQL pentru `carti` (vezi `SUPABASE-MIGRATION-CARTI.sql` sau `supabase/migrations/`) ca să existe `user_id` și politicile RLS.
2. **Backend:**
   ```text
   cd backend
   python -m pip install -r requirements.txt
   python __main__.py
   ```
   (echivalent: `uvicorn main:app --host 127.0.0.1 --port 8765` din același folder `backend`).
3. **Frontend:** din rădăcina monorepo / folderul unde e `package.json`:
   ```text
   npm install
   npm run dev
   ```
   Cererile API merg la **`/api`** (Next face proxy către FastAPI pe `127.0.0.1:8765`). Pornește backend-ul în paralel.
4. **Deploy aceeași rețea (Docker):** din rădăcina repo-ului, cu `backend/.env` completat:
   ```text
   docker compose up --build
   ```
   (echivalent: `npm run compose:up`.) UI la port **3001**.
5. **Variabile `backend/.env`:**
   - `GEMINI_API_KEY`
   - `SUPABASE_URL`, `SUPABASE_KEY` (service role pentru operații server)
   - `SECRET_KEY` (JWT)
   - `ADMIN_KEY` (înregistrare utilizatori prin `/register`)

Opțional frontend: `NEXT_PUBLIC_API_URL` dacă vrei să ocolești proxy-ul Next și să apelezi direct backend-ul (URL absolut).

---

## După migrare pe Supabase

Din `backend/`, pentru a atribui cărțile fără proprietar unui cont:

```text
python assign_books_to_user.py
```

Opțional `--email alt@domeniu.ro` sau `--all` (suprascrie toți proprietarii) — vezi help-ul scriptului.

Pentru datele vechi, poți popula și `user_id` pe baza email-ului:

```sql
UPDATE carti c
SET user_id = u.id
FROM utilizatori u
WHERE c.user_id IS NULL
  AND c.created_by_email IS NOT NULL
  AND lower(c.created_by_email) = lower(u.email);
```

---

## Securitate — note scurte

- Nu expuneți `SUPABASE_KEY` (service role) în frontend; doar backend.
- Rotați cheile compromise; token-uri personale Supabase CLI nu se comit în git.
- Token-ul de sesiune se trimite în `Authorization: Bearer ...` pe toate apelurile protejate.
- Backend-ul validează token-ul și aplică scoping per-utilizator la select/insert/delete.

Pentru detalii API și coduri de răspuns, vezi [API-OVERVIEW.md](./API-OVERVIEW.md).

### Audio gol / 0:00 — verificări rapide

- **Browser:** `fetch` nu are timeout implicit scurt; problema e rar „timpul de răspuns al browserului”. În schimb, un **proxy** (nginx, cloud) poate tăia cereri după 60s — în dev local, de obicei nu.
- **Edge TTS:** timeout-ul de citire WebSocket era **60s** în bibliotecă; acum e mărit (vezi `EDGE_TTS_RECEIVE_TIMEOUT` în [PIPELINE-LONG-TEXT.md](./PIPELINE-LONG-TEXT.md)).
- **Frontend:** dacă serverul returnează **503**, trebuie afișat mesajul din `detail` (pagina principală verifică acum `response.ok`).
- **PDF scanat:** fără strat text, extragerea e goală → mesaj 422, nu audio gol din TTS.
