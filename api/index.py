"""
Vercel Python entrypoint.
Expune backend-ul FastAPI sub prefixul /api in acelasi proiect cu frontend-ul Next.js.
"""

from fastapi import FastAPI

from backend.main import app as backend_app

app = FastAPI(title="AudioScraperAI Vercel API")
app.mount("/api", backend_app)
