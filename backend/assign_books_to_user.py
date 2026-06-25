#!/usr/bin/env python3
"""
Script utilitar: atribui carti vechi unui utilizator (created_by_email).
Rulez manual dupa migrari, din folderul backend cu .env configurat.

Exemple:
  python assign_books_to_user.py
  python assign_books_to_user.py --email alt@exemplu.ro
  python assign_books_to_user.py --all
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
    parser = argparse.ArgumentParser(description="Setez created_by_email pe carti existente.")
    parser.add_argument(
        "--email",
        default="user@audioscraper.ro",
        help="Email utilizator (trebuie sa existe in tabelul utilizatori).",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Actualizez TOATE cartile, nu doar cele cu proprietar NULL.",
    )
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("EROARE: SUPABASE_URL sau SUPABASE_KEY lipsesc din .env")
        sys.exit(1)

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    # Emailul tinta, normalizat la litere mici (la fel cum il stocheaza backend-ul).
    target = args.email.strip().lower()

    # Fac un select minimal ca sa verific ca pot ajunge la tabelul carti inainte sa modific ceva.
    try:
        supabase.table("carti").select("id").limit(1).execute()
    except APIError as e:
        print("EROARE Supabase:", e)
        sys.exit(1)

    if args.all:
        # Mod agresiv (--all): suprascriu proprietarul pentru TOATE cartile, indiferent ce aveau inainte.
        res = supabase.table("carti").select("id").execute()
        rows = res.data or []
        n = 0
        for row in rows:
            supabase.table("carti").update({"created_by_email": target}).eq("id", row["id"]).execute()
            n += 1
        print(f"Actualizat {n} carti -> created_by_email = {target!r} (mod --all).")
        return

    def count_where_null() -> int:
        # Numar cartile fara proprietar (created_by_email NULL).
        r = supabase.table("carti").select("id").is_("created_by_email", "null").execute()
        return len(r.data or [])

    def count_where_user() -> int:
        # Numar cartile care apartin deja utilizatorului tinta.
        r = supabase.table("carti").select("id").eq("created_by_email", target).execute()
        return len(r.data or [])

    try:
        # Retin cate carti erau fara proprietar inainte, ca sa pot raporta cate am atribuit.
        n_null_inainte = count_where_null()
    except APIError as e:
        err = str(e)
        # Daca lipseste coloana created_by_email, scriptul nu are sens pana nu rulez migrarea.
        if "created_by_email" in err or "42703" in err:
            print(
                "Coloana created_by_email nu exista inca in tabelul carti.\n"
                "Ruleaza mai intai in Supabase (SQL Editor) scriptul de migrare carti.\n"
                "Apoi ruleaza din nou: python assign_books_to_user.py"
            )
            sys.exit(1)
        raise

    # Actualizez doar randurile fara proprietar
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
