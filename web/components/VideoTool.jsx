"use client";

import { useState } from "react";
import {
  postJson,
  fetchAudio,
  saveBlob,
  formatBytes,
  formatDuration,
  formatNumber,
  formatUploadDate,
} from "../lib/api";
import { Alert, Badge, Button, Card, Field, Input, SectionTitle, Select, Spinner, Stat } from "./ui";

const AUDIO_FORMATS = ["mp3", "m4a", "wav", "opus", "flac", "aac"];
const QUALITIES = ["128", "192", "256", "320"];

export default function VideoTool() {
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState(null);
  const [inspecting, setInspecting] = useState(false);
  const [error, setError] = useState("");
  const [audioFormat, setAudioFormat] = useState("mp3");
  const [quality, setQuality] = useState("192");
  const [downloading, setDownloading] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  async function inspect(target) {
    const value = (target ?? url).trim();
    if (!value) {
      setError("Paste a video URL first.");
      return;
    }
    setInspecting(true);
    setError("");
    try {
      setUrl(value);
      const data = await postJson("/api/py/metadata", { url: value });
      setInfo(data);
    } catch (err) {
      setInfo(null);
      setError(err.message);
    } finally {
      setInspecting(false);
    }
  }

  async function handleDownload() {
    if (!url.trim()) {
      setError("Paste a video URL first.");
      return;
    }
    setDownloading(true);
    setError("");
    try {
      const blob = await fetchAudio(url.trim(), audioFormat, quality);
      saveBlob(blob, `audio.${audioFormat}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  }

  async function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError("");
    try {
      const data = await postJson("/api/py/search", { query: query.trim(), limit: 8 });
      setResults(data.results ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5 sm:p-6">
        <SectionTitle eyebrow="yt-dlp" title="Inspect a video">
          <Badge tone="mint">python</Badge>
        </SectionTitle>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") inspect();
            }}
            placeholder="https://www.youtube.com/watch?v=..."
            aria-label="Video URL"
          />
          <Button onClick={() => inspect()} disabled={inspecting} className="sm:w-32">
            {inspecting ? <Spinner /> : null}
            {inspecting ? "Inspecting" : "Inspect"}
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-32">
            <Field label="Audio codec">
              <Select value={audioFormat} onChange={(e) => setAudioFormat(e.target.value)}>
                {AUDIO_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="w-full sm:w-32">
            <Field label="Bitrate">
              <Select value={quality} onChange={(e) => setQuality(e.target.value)}>
                {QUALITIES.map((q) => (
                  <option key={q} value={q}>
                    {q} kbps
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button variant="ghost" onClick={handleDownload} disabled={downloading}>
            {downloading ? <Spinner /> : null}
            {downloading ? "Extracting…" : "Download audio"}
          </Button>
        </div>

        {error ? (
          <div className="mt-4">
            <Alert>{error}</Alert>
          </div>
        ) : null}
      </Card>

      {info ? (
        <Card className="p-5 sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row">
            {info.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={info.thumbnail}
                alt=""
                className="h-40 w-full rounded-xl border border-line object-cover sm:w-72"
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-bold leading-snug text-mist-100">{info.title}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge tone="amber">{info.extractor ?? "video"}</Badge>
                {info.is_live ? <Badge tone="mint">live</Badge> : null}
                {info.uploader ? <span className="text-sm text-mist-400">{info.uploader}</span> : null}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Duration" value={formatDuration(info.duration, info.duration_string)} />
                <Stat label="Views" value={formatNumber(info.view_count)} />
                <Stat label="Likes" value={formatNumber(info.like_count)} />
                <Stat label="Uploaded" value={formatUploadDate(info.upload_date)} />
              </div>
              {info.description ? (
                <p className="mt-4 line-clamp-4 whitespace-pre-line text-sm leading-relaxed text-mist-400">
                  {info.description}
                </p>
              ) : null}
            </div>
          </div>

          {info.formats?.length ? (
            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-mist-100">Available formats</h4>
                <span className="text-xs text-mist-500">{info.formats.length} tracks</span>
              </div>
              <div className="scroll-thin max-h-80 overflow-auto rounded-xl border border-line">
                <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                  <thead className="sticky top-0 bg-ink-850 text-[11px] uppercase tracking-wider text-mist-500">
                    <tr>
                      <th className="px-3 py-2 font-semibold">ID</th>
                      <th className="px-3 py-2 font-semibold">Ext</th>
                      <th className="px-3 py-2 font-semibold">Resolution</th>
                      <th className="px-3 py-2 font-semibold">FPS</th>
                      <th className="px-3 py-2 font-semibold">Codecs</th>
                      <th className="px-3 py-2 font-semibold">Size</th>
                      <th className="px-3 py-2 font-semibold">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line font-mono text-xs">
                    {info.formats.slice(0, 60).map((f, i) => (
                      <tr key={`${f.format_id}-${i}`} className="hover:bg-ink-850/60">
                        <td className="px-3 py-2 text-amber-glow">{f.format_id}</td>
                        <td className="px-3 py-2 text-mist-300">{f.ext}</td>
                        <td className="px-3 py-2 text-mist-100">{f.resolution ?? "—"}</td>
                        <td className="px-3 py-2 text-mist-400">{f.fps ?? "—"}</td>
                        <td className="px-3 py-2 text-mist-400">
                          {f.vcodec ?? "—"} / {f.acodec ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-mist-400">{formatBytes(f.filesize)}</td>
                        <td className="px-3 py-2 text-mist-500">{f.note ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card className="p-5 sm:p-6">
        <SectionTitle eyebrow="yt-dlp" title="Search" >
          <Badge tone="mint">python</Badge>
        </SectionTitle>
        <form onSubmit={handleSearch} className="mt-5 flex flex-col gap-3 sm:flex-row">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search videos…"
            aria-label="Search query"
          />
          <Button type="submit" variant="ghost" disabled={searching} className="sm:w-32">
            {searching ? <Spinner /> : null}
            {searching ? "Searching" : "Search"}
          </Button>
        </form>

        {results.length ? (
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {results.map((r) => (
              <button
                key={r.id}
                onClick={() => inspect(r.url)}
                className="group overflow-hidden rounded-xl border border-line bg-ink-850/50 text-left transition hover:border-amber-glow/50"
              >
                <div className="aspect-video w-full overflow-hidden bg-ink-800">
                  {r.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.thumbnail}
                      alt=""
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    />
                  ) : null}
                </div>
                <div className="p-3">
                  <p className="line-clamp-2 text-sm font-medium text-mist-100">{r.title}</p>
                  <p className="mt-1 text-xs text-mist-500">
                    {r.uploader ? `${r.uploader} · ` : ""}
                    {r.duration ? formatDuration(r.duration) : "—"}
                  </p>
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
