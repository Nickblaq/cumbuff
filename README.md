# cumbuff

A full-stack media toolkit on **one Railway service and one public endpoint**:

- a **Node.js gateway** (`server/index.js`) that owns the public port, exposes **sharp** image APIs, and serves the UI,
- a **private Python FastAPI sidecar** (`python/main.py`) that exposes **yt-dlp** media APIs,
- a **Next.js UI** (`web/`) that talks to both through the same origin.

[Railpack](https://railpack.com) installs both runtimes (plus `ffmpeg`), builds the Next app, and starts everything with a single `npm start` orchestrated by [`concurrently`](https://www.npmjs.com/package/concurrently).

## Architecture

```
Railway public URL  ->  Node gateway (0.0.0.0:$PORT)
                          ├── /                -> static Next.js UI (web/out)
                          ├── /api/node/*      -> sharp image tools (in-process)
                          ├── /api/py/*        -> reverse proxy -> Python FastAPI (127.0.0.1:$PY_INTERNAL_PORT)
                          └── /health          -> combined readiness of both runtimes
```

- One public listener; Python is bound to `127.0.0.1` and is never exposed.
- Next is statically exported (`output: "export"`), so no extra server process is needed.
- Same origin, so there is no CORS between the UI and either backend.
- The gateway retries the Python sidecar until `/health` passes.

## APIs

### yt-dlp — Python (`/api/py/*`)

| Route | Body | Description |
| --- | --- | --- |
| `POST /api/py/metadata` | `{ url }` | Title, uploader, duration, views, description and every available format. |
| `POST /api/py/formats` | `{ url }` | Just the downloadable formats. |
| `POST /api/py/search` | `{ query, limit }` | Flat search results (YouTube by default). |
| `POST /api/py/audio` | `{ url, format, quality }` | Downloads best audio and transcodes it with ffmpeg; returns the file. |

Supported audio codecs: `mp3`, `m4a`, `aac`, `opus`, `vorbis`, `flac`, `wav`.

### sharp — Node (`/api/node/*`)

| Route | Description |
| --- | --- |
| `POST /api/node/image/resize` | `?width=&height=&fit=&format=&quality=&effect=` — resize, convert, and apply `grayscale`/`blur`/`sharpen`/`negate`. |
| `POST /api/node/image/thumbnail` | `?size=` — square webp thumbnail, smart crop. |
| `POST /api/node/image/metadata` | Format, dimensions, aspect ratio, channels, alpha. |
| `POST /api/node/image/svg` | `?width=&format=` — rasterize SVG to png/webp/jpeg. |
| `GET /api/node/image/placeholder` | `?width=&height=&text=` — generate a gradient placeholder. |

Image routes take the raw image bytes as the request body (`Content-Type: image/*`).

`GET /api` returns the full machine-readable endpoint index.

## Files

| Path | Purpose |
| --- | --- |
| `railpack.json` | Installs Node + Python + `ffmpeg`, pip-installs the sidecar, sets the single start command. |
| `package.json` | `concurrently` orchestration, the `next build` step, and the gateway dependencies. |
| `server/index.js` | Public gateway: sharp APIs, static UI, Python proxy, `/health`. |
| `python/main.py` | Private FastAPI app: yt-dlp metadata, search, formats, audio extraction. |
| `web/` | Next.js app (static export) served by the gateway. |

## Local development

```bash
npm install
python3 -m venv .venv && .venv/bin/pip install -r python/requirements.txt   # once
npm run build          # builds web/out
npm start              # runs the Python sidecar and the gateway together
```

Open <http://localhost:3000>. `ffmpeg` must be on your PATH for audio extraction.

Environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Public port the Node gateway binds. |
| `PY_INTERNAL_PORT` | `8000` | Internal port the Python sidecar binds. |

## Deploying to Railway

Railway builds with Railpack: it installs Node 22 + Python 3.13, installs `ffmpeg` (runtime apt packages), installs the Python dependencies, runs `npm run build` for the Next UI, then runs `npm start` — which starts the Python sidecar and the Node gateway together. No Dockerfile is used.
