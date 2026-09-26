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
                          ├── /health          -> liveness (always 200)
                          └── /health/ready    -> readiness (200 only when the sidecar is up)
```

- One public listener; Python is bound to `127.0.0.1` and is never exposed.
- Next is statically exported (`output: "export"`), so no extra server process is needed.
- Same origin, so there is no CORS between the UI and either backend.
- The gateway never blocks requests on the sidecar: when it is still starting it answers `503` with `Retry-After` and re-probes in the background.
- Long downloads are proxied with generous timeouts, and SSE (`text/event-stream`) is never buffered or compressed.

## APIs

### yt-dlp — Python (`/api/py/*`)

| Route | Body | Description |
| --- | --- | --- |
| `POST /api/py/metadata` | `{ url, advanced? }` | Title, uploader, duration, views, description, subtitles and every available format. |
| `POST /api/py/formats` | `{ url, advanced? }` | Just the downloadable formats. |
| `POST /api/py/search` | `{ query, limit, advanced? }` | Flat search results (YouTube by default). |
| `POST /api/py/download` | `{ url, kind, format, quality, video_format, subtitles, subtitles_lang, thumbnail, advanced? }` | Queues an audio/video download and returns a job id. |
| `GET /api/py/jobs/:id` | — | Current job status and progress snapshot. |
| `GET /api/py/jobs/:id/events` | — | Server-Sent Events progress stream (percent, speed, ETA, stage). |
| `GET /api/py/jobs/:id/file` | `?name=` | The finished media, or a named asset (subtitle / thumbnail). |
| `POST /api/py/audio` | `{ url, format, quality, advanced? }` | Synchronous best-audio download for simple callers. |

- `kind` is `video` (merged to mp4 via ffmpeg) or `audio` (transcoded to the chosen codec).
- Supported audio codecs: `mp3`, `m4a`, `aac`, `opus`, `vorbis`, `flac`, `wav`.
- Video presets: `best`, `1080`, `720`, `480`, `360`, `smallest`.
- `advanced` carries optional power-user yt-dlp knobs:
  - `cookies` — a Netscape cookie file sent only with that request and deleted afterwards,
  - `cache` — reuse a persistent, server-managed `cachedir`,
  - `extractor_args` — e.g. `{ "youtube": ["player_client=web"] }`.

Every URL is checked against an SSRF guard: only `http(s)` URLs that resolve exclusively to public addresses are accepted (loopback, link-local, private and reserved ranges are rejected).

### sharp — Node (`/api/node/*`)

| Route | Description |
| --- | --- |
| `POST /api/node/image/resize` | `?width=&height=&fit=&position=&format=&quality=&effect=&animated=&withoutEnlargement=` — resize, convert, preserve/convert animation, and apply `grayscale`/`blur`/`sharpen`/`negate`. |
| `POST /api/node/image/thumbnail` | `?size=` — square webp thumbnail, smart crop. |
| `POST /api/node/image/metadata` | Format, dimensions, aspect ratio, channels, alpha, frame count. |
| `POST /api/node/image/svg` | `?width=&format=` — rasterize SVG to png/webp/jpeg. |
| `GET /api/node/image/placeholder` | `?width=&height=&text=` — generate a gradient placeholder. |
| `GET /og.png` | Generated social share image (1200×630). |

Image routes take the raw image bytes as the request body (`Content-Type: image/*`). Output formats include `webp`, `avif`, `gif`, `png`, `jpeg` and `tiff`; animated `gif`/`webp` inputs keep their frames when `animated=true`.

`GET /api` returns the full machine-readable endpoint index.

## Frontend

`web/` is a Next.js static export with:

- a themed landing page with deep-linkable tabs (`#view=video` / `#view=image`),
- **real download progress** driven by the job SSE stream instead of an indefinite spinner,
- video and audio downloads with subtitle/thumbnail extras and an advanced yt-dlp panel,
- an image studio with animated/modern formats, anchor and no-enlarge controls,
- self-hosted fonts via `next/font` (no third-party font requests at runtime),
- brand assets: `app/icon.svg` favicon, `public/manifest.webmanifest`, and an OG/Twitter image,
- accessible controls: visible focus rings, labelled selects with chevrons, keyboard-reachable dropzone and ARIA-correct tabs.

## Quality

| Command | Purpose |
| --- | --- |
| `npm run lint` | Biome lint (`biome.json`). |
| `npm run typecheck` | `tsc -b --noEmit`. |
| `npm test` | `node --test` gateway tests (routes, headers, sharp pipeline). |
| `npm run check` | Lint + tests. |
| `npm run build` | Build the static Next UI. |

CI (`.github/workflows/ci.yml`) runs all of the above plus a Python syntax check.

## Files

| Path | Purpose |
| --- | --- |
| `railpack.json` | Installs Node + Python + `ffmpeg`, pip-installs the sidecar, sets the single start command. |
| `package.json` | `concurrently` orchestration, the `next build` step, and the gateway dependencies. |
| `server/index.js` | Public gateway: sharp APIs, static UI, Python proxy, security/compression, health. |
| `python/main.py` | Private FastAPI app: yt-dlp metadata, search, job-based downloads and progress. |
| `web/` | Next.js app (static export) served by the gateway. |
| `test/` | `node --test` suites for the gateway. |

## Local development

```bash
npm install
python3 -m venv .venv && .venv/bin/pip install -r python/requirements.txt   # once
npm run build          # builds web/out
npm start              # runs the Python sidecar and the gateway together
```

Open <http://localhost:3000>. `ffmpeg` must be on your PATH for audio extraction, merging and animation conversion.

Environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Public port the Node gateway binds. |
| `PY_INTERNAL_PORT` | `8000` | Internal port the Python sidecar binds. |

## Deploying to Railway

Railway builds with Railpack: it installs Node 22 + Python 3.13, installs `ffmpeg` (runtime apt packages), installs the Python dependencies, runs `npm run build` for the Next UI, then runs `npm start` — which starts the Python sidecar and the Node gateway together. No Dockerfile is used.
