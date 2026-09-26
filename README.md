# cumbuff

A single Railway service that runs **two runtimes behind one public endpoint**:

- a **Node.js gateway** (`server/index.js`) that owns the public port and serves the Node API,
- a **private Python FastAPI sidecar** (`python/main.py`) that the gateway reverse-proxies to.

Both are built and started by [Railpack](https://railpack.com) via `railpack.json`, and launched together with a single `npm start` command orchestrated by [`concurrently`](https://www.npmjs.com/package/concurrently).

## Architecture

```
Railway public URL
  └── Node gateway  (0.0.0.0:$PORT)   <- only public listener
        ├── /api/node/*   handled in-process
        ├── /api/py/*     reverse-proxied ──> Python FastAPI (127.0.0.1:$PY_INTERNAL_PORT)
        └── /health       combined health of both runtimes
```

- The gateway binds `0.0.0.0:$PORT`, so it is the only port Railway exposes.
- Python binds `127.0.0.1` on an internal port and is never publicly reachable.
- Same origin, so there is no CORS between the two backends.
- The gateway retries the sidecar until its `/health` passes, so early traffic is not dropped.

## Files

| Path | Purpose |
| --- | --- |
| `railpack.json` | Installs Node + Python, pip-installs the sidecar, sets the single start command. |
| `package.json` | `concurrently` orchestration (`npm start`) plus the gateway dependencies. |
| `server/index.js` | Public Node gateway: Node API, proxy to Python, `/health`. |
| `python/main.py` | Private FastAPI app (`/health`, `/hello`, `/info`). |
| `python/requirements.txt` | Pinned Python dependencies. |

## Endpoints

| Route | Served by |
| --- | --- |
| `GET /` | Node — service index |
| `GET /health` | Node — combined readiness for both runtimes |
| `GET /api/node/hello`, `GET /api/node/info` | Node (in-process) |
| `GET /api/py/hello`, `GET /api/py/info`, `GET /api/py/health` | Python (proxied) |

## Local development

```bash
npm install
npm start
```

Then open <http://localhost:3000>.

Environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Public port the Node gateway binds. |
| `PY_INTERNAL_PORT` | `8000` | Internal port the Python sidecar binds. |

## Deploying to Railway

Railway builds with Railpack. `railpack.json` installs both Node and Python, installs the Python dependencies, and runs `npm start`, which starts the Python sidecar and the Node gateway together. Set `RAILWAY_DOCKERFILE_PATH`-free config — no Dockerfile is used or needed.
