"""Private FastAPI sidecar for cumbuff.

Bound to 127.0.0.1 only; all public traffic reaches it through the Node gateway
at /api/py/*. Uvicorn is started by the `npm start` orchestration.
"""

import platform
import sys

from fastapi import FastAPI

app = FastAPI(title="cumbuff python api", version="1.0.0")


@app.get("/health")
def health() -> dict:
    """Readiness probe used by the Node gateway."""
    return {"status": "ok", "service": "python"}


@app.get("/hello")
def hello() -> dict:
    return {"from": "python", "message": "Hello from the Python API"}


@app.get("/info")
def info() -> dict:
    return {
        "runtime": "python",
        "version": sys.version.split()[0],
        "platform": platform.platform(),
    }
