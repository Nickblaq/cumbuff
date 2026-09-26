"""Private FastAPI sidecar for cumbuff.

Exposes yt-dlp powered media features. Bound to 127.0.0.1 only; all public
traffic reaches it through the Node gateway at /api/py/*. ffmpeg (installed via
Railpack deploy.aptPackages) is used for audio extraction and format merging.

Routes here are prefixed with /api/py by the gateway, so internally they are
plain paths (/metadata, /search, /download, /jobs/...).

Downloads are asynchronous: POST /download returns a job id, GET
/jobs/{id}/events streams progress as Server-Sent Events, and GET
/jobs/{id}/file serves the finished media.
"""

from __future__ import annotations

import ipaddress
import json
import os
import platform
import shutil
import socket
import sys
import tempfile
import threading
import time
import uuid
import urllib.parse

import yt_dlp
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

app = FastAPI(title="cumbuff python api", version="2.0.0")

# Shared yt-dlp options. Never download unless a route explicitly asks for it.
BASE_OPTS: dict = {
    "quiet": True,
    "no_warnings": True,
    "noplaylist": True,
    "nocheckcertificate": True,
    "socket_timeout": 20,
    "retries": 3,
}

# Accepted output codecs, the file extension ffmpeg produces, and the MIME type.
AUDIO_CODECS = {
    "mp3": ("mp3", "audio/mpeg"),
    "m4a": ("m4a", "audio/mp4"),
    "aac": ("m4a", "audio/mp4"),
    "opus": ("opus", "audio/ogg"),
    "vorbis": ("ogg", "audio/ogg"),
    "flac": ("flac", "audio/flac"),
    "wav": ("wav", "audio/wav"),
}

# Named video quality presets -> yt-dlp format selector.
VIDEO_FORMATS = {
    "best": "bestvideo*+bestaudio/best",
    "1080": "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
    "720": "bestvideo[height<=720]+bestaudio/best[height<=720]",
    "480": "bestvideo[height<=480]+bestaudio/best[height<=480]",
    "360": "bestvideo[height<=360]+bestaudio/best[height<=360]",
    "smallest": "worstvideo*+worstaudio/worst",
}

# Extension -> MIME type for the files a job can produce.
EXT_MEDIA = {
    "mp4": "video/mp4",
    "mkv": "video/x-matroska",
    "webm": "video/webm",
    "mp3": "audio/mpeg",
    "m4a": "audio/mp4",
    "aac": "audio/mp4",
    "opus": "audio/ogg",
    "ogg": "audio/ogg",
    "flac": "audio/flac",
    "wav": "audio/wav",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "srt": "application/x-subrip",
    "vtt": "text/vtt",
    "ass": "text/plain",
    "lrc": "text/plain",
    "txt": "text/plain",
}

# Persistent, server-managed yt-dlp cache (safe: clients cannot choose a path).
CACHE_DIR = os.path.join(tempfile.gettempdir(), "cumbuff-cache")
JOB_TTL = 60 * 60  # seconds a finished job stays available
MAX_JOB_SECONDS = 30 * 60  # hard ceiling for an SSE stream


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #


class Advanced(BaseModel):
    """Optional power-user yt-dlp knobs."""

    cookies: str | None = Field(None, max_length=200_000)
    cache: bool = True
    extractor_args: dict[str, list[str]] | None = None


class UrlRequest(BaseModel):
    url: str = Field(..., min_length=4, max_length=2048)
    advanced: Advanced | None = None


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=200)
    limit: int = Field(8, ge=1, le=20)
    advanced: Advanced | None = None


class AudioRequest(BaseModel):
    url: str = Field(..., min_length=4, max_length=2048)
    format: str = "mp3"
    quality: str = "192"
    advanced: Advanced | None = None


class DownloadRequest(BaseModel):
    url: str = Field(..., min_length=4, max_length=2048)
    kind: str = "video"  # "video" | "audio"
    format: str = "mp3"  # audio codec when kind == "audio"
    quality: str = "192"  # audio bitrate
    video_format: str = "best"  # key of VIDEO_FORMATS
    subtitles: bool = False
    subtitles_lang: str = "en"
    thumbnail: bool = False
    advanced: Advanced | None = None


# --------------------------------------------------------------------------- #
# Job store
# --------------------------------------------------------------------------- #


class Job:
    def __init__(self, job_id: str, kind: str, label: str) -> None:
        self.id = job_id
        self.kind = kind
        self.label = label
        self.status = "queued"  # queued | running | done | error
        self.stage = "queued"
        self.progress: dict = {}
        self.error: str | None = None
        self.files: list[dict] = []
        self.dir: str | None = None
        self.created = time.time()
        self.updated = self.created
        self.lock = threading.Lock()

    def update(self, **fields) -> None:
        with self.lock:
            for key, value in fields.items():
                setattr(self, key, value)
            self.updated = time.time()

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "id": self.id,
                "kind": self.kind,
                "label": self.label,
                "status": self.status,
                "stage": self.stage,
                "progress": dict(self.progress),
                "error": self.error,
                "files": [
                    {
                        "name": f["name"],
                        "media_type": f["media_type"],
                        "size": f["size"],
                        "primary": f["primary"],
                    }
                    for f in self.files
                ],
                "created": self.created,
                "updated": self.updated,
            }


JOBS: dict[str, Job] = {}
JOBS_LOCK = threading.Lock()


def _purge_jobs() -> None:
    now = time.time()
    with JOBS_LOCK:
        stale = [jid for jid, job in JOBS.items() if now - job.updated > JOB_TTL]
        for jid in stale:
            job = JOBS.pop(jid)
            if job.dir:
                shutil.rmtree(job.dir, ignore_errors=True)


def _get_job(job_id: str) -> Job:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="unknown or expired job")
    return job


def _cleanup_orphans() -> None:
    """Remove leftover work directories from a previous process start."""
    root = tempfile.gettempdir()
    for name in os.listdir(root):
        if name.startswith(("cumbuff-job-", "cumbuff-audio-", "cumbuff-cookies-")):
            shutil.rmtree(os.path.join(root, name), ignore_errors=True)
    os.makedirs(CACHE_DIR, exist_ok=True)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _assert_public_url(url: str) -> str:
    """Reject anything that is not an http(s) URL resolving to a public address.

    Prevents the sidecar from being used to reach loopback, link-local,
    private, or otherwise reserved addresses (SSRF).
    """
    url = url.strip()
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="url must start with http:// or https://")
    host = parsed.hostname
    if not host:
        raise HTTPException(status_code=400, detail="url must include a host")
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise HTTPException(status_code=400, detail="url host could not be resolved") from exc
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            raise HTTPException(status_code=400, detail="url host resolved to an invalid address")
        if not ip.is_global:
            raise HTTPException(status_code=400, detail="url resolves to a non-public address")
    return url


def _clean_error(exc: Exception) -> str:
    return str(exc).removeprefix("ERROR: ").strip() or "yt-dlp failed to process the request"


def _first_entry(info: dict) -> dict:
    if info.get("_type") == "playlist":
        entries = [e for e in (info.get("entries") or []) if e]
        if entries:
            return entries[0]
    return info


def _format_row(f: dict) -> dict:
    resolution = f.get("resolution")
    if not resolution and f.get("width") and f.get("height"):
        resolution = f"{f['width']}x{f['height']}"
    return {
        "format_id": f.get("format_id"),
        "ext": f.get("ext"),
        "resolution": resolution or ("audio only" if f.get("vcodec") == "none" else None),
        "fps": f.get("fps"),
        "filesize": f.get("filesize") or f.get("filesize_approx"),
        "vcodec": f.get("vcodec"),
        "acodec": f.get("acodec"),
        "tbr": f.get("tbr"),
        "abr": f.get("abr"),
        "protocol": f.get("protocol"),
        "note": f.get("format_note"),
    }


def _summarize(info: dict) -> dict:
    return {
        "id": info.get("id"),
        "title": info.get("title"),
        "extractor": info.get("extractor_key") or info.get("extractor"),
        "uploader": info.get("uploader") or info.get("channel"),
        "duration": info.get("duration"),
        "duration_string": info.get("duration_string"),
        "view_count": info.get("view_count"),
        "like_count": info.get("like_count"),
        "upload_date": info.get("upload_date"),
        "thumbnail": info.get("thumbnail"),
        "webpage_url": info.get("webpage_url"),
        "description": (info.get("description") or "")[:1200],
        "is_live": info.get("is_live"),
        "subtitles": sorted((info.get("subtitles") or {}).keys())[:12],
        "formats": [
            _format_row(f)
            for f in (info.get("formats") or [])
            if isinstance(f, dict) and f.get("format_id")
        ],
    }


def _write_cookiefile(cookies: str, directory: str) -> str:
    path = os.path.join(directory, "cookies.txt")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(cookies if cookies.endswith("\n") else cookies + "\n")
    return path


def _advanced_opts(advanced: Advanced | None, directory: str) -> dict:
    """Translate the optional advanced block into yt-dlp options.

    `directory` is an existing, caller-owned work dir used for the temporary
    cookie jar, so nothing here needs its own cleanup.
    """
    if advanced is None:
        return {}
    opts: dict = {}
    if advanced.cache:
        opts["cachedir"] = CACHE_DIR
    if advanced.extractor_args:
        opts["extractor_args"] = {
            str(k): [str(item) for item in v] for k, v in advanced.extractor_args.items()
        }
    if advanced.cookies:
        opts["cookiefile"] = _write_cookiefile(advanced.cookies, directory)
    return opts


def _extract(target: str, extra: dict, advanced: Advanced | None = None) -> dict:
    """Run yt-dlp without downloading, cleaning up any temporary cookie jar."""
    tmpdir: str | None = None
    try:
        opts = {**BASE_OPTS}
        if advanced:
            if advanced.cache:
                opts["cachedir"] = CACHE_DIR
            if advanced.extractor_args:
                opts["extractor_args"] = {
                    str(k): [str(item) for item in v]
                    for k, v in advanced.extractor_args.items()
                }
            if advanced.cookies:
                tmpdir = tempfile.mkdtemp(prefix="cumbuff-cookies-")
                opts["cookiefile"] = _write_cookiefile(advanced.cookies, tmpdir)
        opts.update(extra)
        with yt_dlp.YoutubeDL(opts) as ydl:
            return ydl.extract_info(target, download=False)
    except yt_dlp.utils.YoutubeDLError as exc:
        raise HTTPException(status_code=502, detail=_clean_error(exc)) from exc
    finally:
        if tmpdir:
            shutil.rmtree(tmpdir, ignore_errors=True)


def _media_type(path: str) -> str:
    ext = os.path.splitext(path)[1].lstrip(".").lower()
    return EXT_MEDIA.get(ext, "application/octet-stream")


def _collect_files(job: Job, kind: str) -> list[dict]:
    assert job.dir is not None
    found: list[dict] = []
    for name in sorted(os.listdir(job.dir)):
        path = os.path.join(job.dir, name)
        if not os.path.isfile(path):
            continue
        media = _media_type(path)
        found.append(
            {
                "name": name,
                "path": path,
                "media_type": media,
                "size": os.path.getsize(path),
                "primary": False,
            }
        )
    if not found:
        return found

    if kind == "audio":
        preferred = [f for f in found if f["media_type"].startswith("audio/")]
    else:
        preferred = [f for f in found if f["media_type"].startswith("video/")]
    if not preferred:
        preferred = [f for f in found if not f["media_type"].startswith(("text/", "image/"))]
    if not preferred:
        preferred = found
    primary = max(preferred, key=lambda f: f["size"])
    primary["primary"] = True
    return found


def _progress_hook(job: Job):
    def hook(data: dict) -> None:
        state = data.get("status")
        if state == "downloading":
            total = data.get("total_bytes") or data.get("total_bytes_estimate")
            done = data.get("downloaded_bytes") or 0
            percent = round(done / total * 100, 2) if total else None
            job.update(
                status="running",
                stage="downloading",
                progress={
                    "percent": percent,
                    "downloaded_bytes": done,
                    "total_bytes": total,
                    "speed": data.get("speed"),
                    "eta": data.get("eta"),
                    "filename": os.path.basename(data.get("filename") or ""),
                },
            )
        elif state == "finished":
            snap = job.snapshot()
            job.update(
                stage="processing",
                progress={**snap["progress"], "percent": 100, "speed": None, "eta": 0},
            )
        elif state == "error":
            job.update(stage="error")

    return hook


def _run_download(job: Job, req: DownloadRequest, url: str) -> None:
    """Run yt-dlp in a worker thread and record the produced files."""
    try:
        tmpdir = tempfile.mkdtemp(prefix="cumbuff-job-")
        job.update(dir=tmpdir, status="running", stage="preparing")
        opts: dict = {
            "outtmpl": os.path.join(tmpdir, "%(title).120s.%(ext)s"),
            "progress_hooks": [_progress_hook(job)],
        }
        cookie_opts = _advanced_opts(req.advanced, directory=tmpdir)
        opts.update(cookie_opts)

        if req.kind == "audio":
            codec = req.format.lower().strip()
            if codec not in AUDIO_CODECS:
                raise ValueError(f"format must be one of: {', '.join(sorted(AUDIO_CODECS))}")
            opts["format"] = "bestaudio/best"
            opts["postprocessors"] = [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": codec,
                    "preferredquality": req.quality,
                }
            ]
        else:
            selector = VIDEO_FORMATS.get(req.video_format, VIDEO_FORMATS["best"])
            opts["format"] = selector
            opts["merge_output_format"] = "mp4"

        if req.subtitles:
            opts["writesubtitles"] = True
            opts["writeautomaticsub"] = True
            opts["subtitleslangs"] = [req.subtitles_lang]
            opts["subtitlesformat"] = "srt/vtt/best"
        if req.thumbnail:
            opts["writethumbnail"] = True

        with yt_dlp.YoutubeDL({**BASE_OPTS, **opts}) as ydl:
            ydl.extract_info(url, download=True)

        files = _collect_files(job, req.kind)
        if not files:
            raise ValueError("no media file was produced")
        job.update(status="done", stage="done", files=files, progress={**job.snapshot()["progress"], "percent": 100})
    except HTTPException as exc:
        job.update(status="error", stage="error", error=str(exc.detail))
    except (yt_dlp.utils.YoutubeDLError, ValueError, OSError) as exc:
        job.update(status="error", stage="error", error=_clean_error(exc))


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #


@app.get("/health")
def health() -> dict:
    """Readiness probe used by the Node gateway."""
    return {"status": "ok", "service": "python"}


@app.get("/info")
def info() -> dict:
    return {
        "runtime": "python",
        "version": sys.version.split()[0],
        "platform": platform.platform(),
        "yt_dlp": yt_dlp.version.__version__,
        "ffmpeg": shutil.which("ffmpeg") or None,
        "cache_dir": CACHE_DIR,
    }


@app.post("/metadata")
def metadata(req: UrlRequest) -> dict:
    """Full video metadata plus the list of available formats."""
    url = _assert_public_url(req.url)
    info_data = _first_entry(_extract(url, {"skip_download": True}, req.advanced))
    return _summarize(info_data)


@app.post("/formats")
def formats(req: UrlRequest) -> dict:
    """Just the downloadable formats, for a compact picker."""
    url = _assert_public_url(req.url)
    info_data = _first_entry(_extract(url, {"skip_download": True}, req.advanced))
    return {
        "id": info_data.get("id"),
        "title": info_data.get("title"),
        "formats": _summarize(info_data)["formats"],
    }


@app.post("/search")
def search(req: SearchRequest) -> dict:
    """Search a provider (YouTube by default) and return flat results."""
    opts = {"skip_download": True, "extract_flat": "in_playlist"}
    info_data = _extract(f"ytsearch{req.limit}:{req.query}", opts, req.advanced)
    results = []
    for entry in info_data.get("entries") or []:
        if not entry:
            continue
        thumb = entry.get("thumbnail")
        thumbs = entry.get("thumbnails") or []
        if not thumb and thumbs:
            thumb = thumbs[-1].get("url")
        results.append(
            {
                "id": entry.get("id"),
                "title": entry.get("title"),
                "url": entry.get("url") or entry.get("webpage_url"),
                "duration": entry.get("duration"),
                "uploader": entry.get("uploader") or entry.get("channel"),
                "thumbnail": thumb,
            }
        )
    return {"query": req.query, "results": results}


@app.post("/download", status_code=202)
def download(req: DownloadRequest) -> dict:
    """Queue an audio/video download and return a job id to watch."""
    url = _assert_public_url(req.url)
    if req.kind not in ("audio", "video"):
        raise HTTPException(status_code=400, detail="kind must be 'audio' or 'video'")
    if req.kind == "audio" and req.format.lower().strip() not in AUDIO_CODECS:
        raise HTTPException(
            status_code=400,
            detail=f"format must be one of: {', '.join(sorted(AUDIO_CODECS))}",
        )
    _purge_jobs()
    job = Job(uuid.uuid4().hex[:12], req.kind, "audio" if req.kind == "audio" else req.video_format)
    with JOBS_LOCK:
        JOBS[job.id] = job
    threading.Thread(target=_run_download, args=(job, req, url), daemon=True).start()
    return {
        "job_id": job.id,
        "status": "queued",
        "events": f"/jobs/{job.id}/events",
        "file": f"/jobs/{job.id}/file",
    }


@app.get("/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    return _get_job(job_id).snapshot()


@app.get("/jobs/{job_id}/events")
def job_events(job_id: str) -> StreamingResponse:
    """Stream job progress as Server-Sent Events until it finishes."""
    job = _get_job(job_id)

    def stream():
        last = None
        deadline = time.time() + MAX_JOB_SECONDS
        while True:
            snap = job.snapshot()
            payload = json.dumps(snap, separators=(",", ":"))
            if payload != last:
                yield f"data: {payload}\n\n"
                last = payload
            if snap["status"] in ("done", "error"):
                yield "event: end\ndata: {}\n\n"
                return
            if time.time() > deadline:
                yield 'event: timeout\ndata: {"error":"job stream timed out"}\n\n'
                return
            time.sleep(0.35)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/jobs/{job_id}/file")
def job_file(job_id: str, name: str | None = None) -> FileResponse:
    """Serve the primary media file, or a named asset (subtitle/thumbnail)."""
    job = _get_job(job_id)
    if job.status != "done":
        raise HTTPException(status_code=409, detail=f"job is {job.status}")
    if not job.files:
        raise HTTPException(status_code=404, detail="job produced no files")
    if name:
        chosen = next((f for f in job.files if f["name"] == name), None)
        if chosen is None:
            raise HTTPException(status_code=404, detail="file not found in job")
    else:
        chosen = next((f for f in job.files if f["primary"]), job.files[0])
    return FileResponse(
        chosen["path"],
        media_type=chosen["media_type"],
        filename=chosen["name"],
    )


@app.post("/audio")
def audio(req: AudioRequest) -> FileResponse:
    """Synchronous best-audio download, kept for simple/scripted callers."""
    url = _assert_public_url(req.url)
    codec = req.format.lower().strip()
    if codec not in AUDIO_CODECS:
        raise HTTPException(
            status_code=400,
            detail=f"format must be one of: {', '.join(sorted(AUDIO_CODECS))}",
        )
    ext, media_type = AUDIO_CODECS[codec]

    tmpdir = tempfile.mkdtemp(prefix="cumbuff-audio-")
    opts = {
        "format": "bestaudio/best",
        "outtmpl": os.path.join(tmpdir, "%(title).120s.%(ext)s"),
        "postprocessors": [
            {"key": "FFmpegExtractAudio", "preferredcodec": codec, "preferredquality": req.quality}
        ],
        **_advanced_opts(req.advanced, directory=tmpdir),
    }
    try:
        with yt_dlp.YoutubeDL({**BASE_OPTS, **opts}) as ydl:
            ydl.extract_info(url, download=True)
        candidates = [os.path.join(tmpdir, f) for f in os.listdir(tmpdir)]
        matching = [f for f in candidates if f.endswith(f".{ext}")] or candidates
        if not matching:
            raise HTTPException(status_code=502, detail="audio file was not produced")
        produced = max(matching, key=os.path.getsize)
    except yt_dlp.utils.YoutubeDLError as exc:
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise HTTPException(status_code=502, detail=_clean_error(exc)) from exc
    except HTTPException:
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise

    return FileResponse(
        produced,
        media_type=media_type,
        filename=os.path.basename(produced),
        background=BackgroundTask(lambda: shutil.rmtree(tmpdir, ignore_errors=True)),
    )


_cleanup_orphans()
_purge_jobs()
