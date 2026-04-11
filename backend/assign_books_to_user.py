#!/usr/bin/env python3
"""
Migrare usoara: pune created_by_email pe randuri vechi din tabelul carti, ca sa apara in biblioteca userului.

Exemple (din backend, cu .env):
  python assign_books_to_user.py
  python assign_books_to_user.py --email alt@exemplu.ro
  python assign_books_to_user.py --all

Fara --all: doar cartile fara proprietar (NULL). Cu --all: suprascrie orice proprietar existent.
"""

from __future__ import annotations

import argparse
import os
import sys

from dotenv import load_dotenv
from postgrest.exceptions import APIError
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seteaza created_by_email pe carti existente.")
    parser.add_argument(
        "--email",
        default="user@audioscraper.ro",
        help="Email utilizator (trebuie sa existe in tabelul utilizatori pentru login ca user).",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Actualizeaza TOATE cartile, nu doar cele cu proprietar NULL.",
    )
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("EROARE: SUPABASE_URL sau SUPABASE_KEY lipsesc din .env")
        sys.exit(1)

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    target = args.email.strip().lower()

    try:
        supabase.table("carti").select("id").limit(1).execute()
    except APIError as e:
        print("EROARE Supabase:", e)
        sys.exit(1)

    if args.all:
        # Lista completa de id-uri; urmeaza update in masa pentru fiecare rand.
        res = supabase.table("carti").select("id").execute()
        rows = res.data or []
        n = 0
        for row in rows:
            supabase.table("carti").update({"created_by_email": target}).eq("id", row["id"]).execute()
            n += 1
        print(f"Actualizat {n} carti -> created_by_email = {target!r} (mod --all).")
        return

    def count_where_null() -> int:
        r = supabase.table("carti").select("id").is_("created_by_email", "null").execute()
        return len(r.data or [])

    def count_where_user() -> int:
        r = supabase.table("carti").select("id").eq("created_by_email", target).execute()
        return len(r.data or [])

    try:
        n_null_inainte = count_where_null()
    except APIError as e:
        err = str(e)
        if "created_by_email" in err or "42703" in err:
            print(
                "Coloana created_by_email nu exista inca in tabelul carti.\n"
                "Ruleaza mai intai in Supabase (SQL Editor) scriptul:\n"
                "  documentation/SUPABASE-MIGRATION-CARTI.sql\n"
                "Apoi ruleaza din nou: python assign_books_to_user.py"
            )
            sys.exit(1)
        raise

    # Actualizeaza toate randurile fara proprietar
    supabase.table("carti").update({"created_by_email": target}).is_("created_by_email", "null").execute()
    n_null_dupa = count_where_null()
    n_user = count_where_user()
    atribuite = n_null_inainte - n_null_dupa
    print(
        f"Proprietar setat la {target!r} pentru {atribuite} carte(i) (aveau created_by_email NULL).\n"
        f"  - Carti fara proprietar ramase: {n_null_dupa}\n"
        f"  - Total carti ale acestui utilizator: {n_user}\n"
        "Daca vrei sa muti SI cartile care au deja alt proprietar, ruleaza: python assign_books_to_user.py --all"
    )


if __name__ == "__main__":
    main()
