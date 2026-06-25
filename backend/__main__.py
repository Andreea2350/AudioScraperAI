"""
Punctul de pornire al serverului cand rulez backend-ul local (din PyCharm sau din terminal).
Atentie: working directory trebuie sa fie folderul backend, ca importul "main:app" sa fie gasit.
"""

import uvicorn

if __name__ == "__main__":
    # Pornesc serverul uvicorn pe portul 8765 (pe Windows portul 8000 e deseori ocupat/blocat).
    # host 127.0.0.1 = doar local; reload=True = serverul reporneste singur cand modific codul.
    uvicorn.run("main:app", host="127.0.0.1", port=8765, reload=True)
