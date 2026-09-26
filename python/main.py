"""Private FastAPI sidecar for cumbuff.

Exposes yt-dlp powered media features. Bound to 127.0.0.1 only; all public
traffic reaches it through the Node gateway at /api/py/*. ffmpeg (installed via
Railpack deploy.aptPackages) is used for audio extraction.

Routes here are prefixed with /api/py by the gateway, so internally they are
plain paths (/metadata, /search, ...).
"""

from __future__ import annotations

import os
import platform
import shutil
import sys
import tempfile

import yt_dlp
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

app = FastAPI(title="cumbuff python api", version="1.0.0")

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


class UrlRequest(BaseModel):
    url: str = Field(..., min_length=4, max_length=2048)


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=200)
    limit: int = Field(8, ge=1, le=20)


class AudioRequest(BaseModel):
    url: str = Field(..., min_length=4, max_length=2048)
    format: str = "mp3"
    quality: str = "192"


def _clean_url(url: str) -> str:
    url = url.strip()
    if not url.lower().startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="url must start with http:// or https://")
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
        "formats": [
            _format_row(f)
            for f in (info.get("formats") or [])
            if isinstance(f, dict) and f.get("format_id")
        ],
    }


def _extract(target: str, extra: dict) -> dict:
    try:
        with yt_dlp.YoutubeDL({**BASE_OPTS, **extra}) as ydl:
            return ydl.extract_info(target, download=False)
    except yt_dlp.utils.YoutubeDLError as exc:
        raise HTTPException(status_code=502, detail=_clean_error(exc)) from exc


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
    }


@app.post("/metadata")
def metadata(req: UrlRequest) -> dict:
    """Full video metadata plus the list of available formats."""
    info = _first_entry(_extract(_clean_url(req.url), {"skip_download": True}))
    return _summarize(info)


@app.post("/formats")
def formats(req: UrlRequest) -> dict:
    """Just the downloadable formats, for a compact picker."""
    info = _first_entry(_extract(_clean_url(req.url), {"skip_download": True}))
    return {"id": info.get("id"), "title": info.get("title"), "formats": _summarize(info)["formats"]}


@app.post("/search")
def search(req: SearchRequest) -> dict:
    """Search a provider (YouTube by default) and return flat results."""
    opts = {"skip_download": True, "extract_flat": "in_playlist"}
    info = _extract(f"ytsearch{req.limit}:{req.query}", opts)
    results = []
    for entry in info.get("entries") or []:
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


@app.post("/audio")
def audio(req: AudioRequest) -> FileResponse:
    """Download the best audio track and transcode it to the requested codec."""
    url = _clean_url(req.url)
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
