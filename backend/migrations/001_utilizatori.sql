-- ============================================================
-- Migration 001: Tabel utilizatori pentru autentificare
-- Ruleaza acest SQL in Supabase → SQL Editor → New Query
-- ============================================================

-- 1. Creeaza tabelul
CREATE TABLE IF NOT EXISTS utilizatori (
    id          SERIAL PRIMARY KEY,
    email       TEXT UNIQUE NOT NULL,
    parola_hash TEXT NOT NULL,
    rol         TEXT NOT NULL CHECK (rol IN ('admin', 'user', 'guest')),
    creat_la    TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Activeaza Row Level Security
ALTER TABLE utilizatori ENABLE ROW LEVEL SECURITY;

-- 3. Service role are acces complet (backend-ul nostru)
CREATE POLICY "Service role full access"
    ON utilizatori FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- 4. Nimeni altcineva nu poate citi direct tabelul din browser
CREATE POLICY "No public access"
    ON utilizatori FOR SELECT
    USING (false);
