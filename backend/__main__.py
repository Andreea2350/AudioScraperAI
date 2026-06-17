"""
Punct de intrare pentru Run din PyCharm / terminal.
Working directory trebuie sa fie folderul backend.
"""

import uvicorn

if __name__ == "__main__":
    # Pornesc serverul uvicorn pe 8765 (pe Windows 8000 e deseori blocat)
    uvicorn.run("main:app", host="127.0.0.1", port=8765, reload=True)
