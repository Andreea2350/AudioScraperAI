"""
Punct de intrare Python pentru Vercel.
Montez backend-ul FastAPI sub prefixul /api, in acelasi proiect cu Next.js.
"""

from fastapi import FastAPI

# Import aplicatia principala din folderul backend (redenumita ca sa nu se confunde cu app-ul de mai jos)
from backend.main import app as backend_app

# Creez aplicatia wrapper ceruta de Vercel
app = FastAPI(title="AudioScraperAI Vercel API")

# Atasez backend-ul la /api: request-urile site.ro/api/* ajung in backend.main
app.mount("/api", backend_app)
