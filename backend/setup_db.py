#!/usr/bin/env python3
"""
Script de setup: insereaza cativa utilizatori de demo si afiseaza SQL-ul de migrare.
Ruleaza manual dupa ce ai creat proiectul Supabase si ai pus cheile in .env.

Exemplu: python setup_db.py
"""

import os
import sys
from dotenv import load_dotenv

load_dotenv()

import bcrypt as bcrypt_lib
from supabase import create_client

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("EROARE: SUPABASE_URL sau SUPABASE_KEY lipsesc din .env")
    sys.exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Lista hardcodata doar pentru mediu de test; in productie schimbi parolele sau stergi scriptul.
UTILIZATORI = [
    {"email": "admin@audioscraper.ro", "parola": "Admin@1234",  "rol": "admin"},
    {"email": "user@audioscraper.ro",  "parola": "User@1234",   "rol": "user"},
    {"email": "guest@audioscraper.ro", "parola": "Guest@1234",  "rol": "guest"},
]

SQL_MIGRATION = """
-- Copiaza in Supabase SQL Editor daca vrei sa creezi tabelul din interfata web.
CREATE TABLE IF NOT EXISTS utilizatori (
    id          SERIAL PRIMARY KEY,
    email       TEXT UNIQUE NOT NULL,
    parola_hash TEXT NOT NULL,
    rol         TEXT NOT NULL CHECK (rol IN ('admin', 'user', 'guest')),
    creat_la    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE utilizatori ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access"
    ON utilizatori FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "No public access"
    ON utilizatori FOR SELECT
    USING (false);

-- Dupa ce exista tabelul carti, poti adauga coloanele pentru proprietar si flag public:
-- ALTER TABLE carti ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE;
-- ALTER TABLE carti ADD COLUMN IF NOT EXISTS created_by_email TEXT;
"""


def verifica_tabel():
    """Face un select minimal; daca nu crapa, presupunem ca tabelul utilizatori exista."""
    try:
        supabase.table("utilizatori").select("id").limit(1).execute()
        return True
    except Exception:
        return False


def creeaza_utilizatori():
    creat = 0
    sarit = 0

    for u in UTILIZATORI:
        try:
            existent = (
                supabase.table("utilizatori")
                .select("id")
                .eq("email", u["email"])
                .execute()
            )
            if existent.data:
                print(f"  [SKIP]  {u['email']:<35} (deja exista)")
                sarit += 1
                continue

            parola_hash = bcrypt_lib.hashpw(u["parola"].encode("utf-8"), bcrypt_lib.gensalt()).decode("utf-8")
            supabase.table("utilizatori").insert({
                "email":       u["email"],
                "parola_hash": parola_hash,
                "rol":         u["rol"],
            }).execute()

            print(f"  [OK]    {u['email']:<35} rol={u['rol']:<8}  parola={u['parola']}")
            creat += 1

        except Exception as e:
            print(f"  [ERR]   {u['email']}: {e}")

    return creat, sarit


def main():
    print("=" * 56)
    print("  AudioScraperAI – Database Setup")
    print("=" * 56)

    print("\nVerific conexiunea la Supabase...")

    if not verifica_tabel():
        print("\n[EROARE] Tabelul 'utilizatori' nu exista inca.")
        print("\nPasi de urmat:")
        print("  1. Deschide Supabase Dashboard")
        print("  2. Mergi la: SQL Editor -> New Query")
        print("  3. Copiaza si ruleaza SQL-ul din fisierul:")
        print("     backend/migrations/001_utilizatori.sql")
        print("\nSau copiaza direct SQL-ul de mai jos:")
        print("-" * 56)
        print(SQL_MIGRATION)
        print("-" * 56)
        print("\nDupa ce rulezi SQL-ul, executa din nou: python setup_db.py")
        sys.exit(1)

    print("  Tabelul 'utilizatori' gasit.\n")
    print("Creare utilizatori initiali:\n")

    creat, sarit = creeaza_utilizatori()

    print(f"\nRezultat: {creat} creat(i), {sarit} sarit(i).")
    print("\nSetup finalizat.")
    print("\nCredentiale de test:")
    print("  Admin : admin@audioscraper.ro  / Admin@1234")
    print("  User  : user@audioscraper.ro   / User@1234")
    print("  Guest : guest@audioscraper.ro  / Guest@1234")
    print("\n[!] Schimba parolele dupa primul login!")


if __name__ == "__main__":
    main()
