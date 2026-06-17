-- ============================================================
-- Migration 002: Doar admin si user pot avea cont in utilizatori
-- Oaspetele anonim nu are rand in baza de date (doar JWT).
-- Ruleaza in Supabase → SQL Editor daca tabelul a fost creat cu migrarea 001 veche.
-- ============================================================

ALTER TABLE utilizatori DROP CONSTRAINT IF EXISTS utilizatori_rol_check;
ALTER TABLE utilizatori ADD CONSTRAINT utilizatori_rol_check CHECK (rol IN ('admin', 'user'));
