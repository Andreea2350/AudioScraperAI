"""
Punct de intrare pentru Run din IDE: working directory trebuie sa fie folderul backend.
"""

import uvicorn

if __name__ == "__main__":
    # Pe Windows portul 8000 e deseori rezervat sau blocat (WinError 10013); 8765 e ales ca default stabil.
    uvicorn.run("main:app", host="127.0.0.1", port=8765, reload=True)
