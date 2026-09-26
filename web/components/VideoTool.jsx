"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createDownload,
  fetchJobFile,
  formatBytes,
  formatDuration,
  formatNumber,
  formatSpeed,
  formatUploadDate,
  parseExtractorArgs,
  postJson,
  saveBlob,
  subscribeJob,
} from "../lib/api";
import { usePersistentState } from "../lib/state";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Progress,
  SectionTitle,
  Select,
  Spinner,
  Stat,
  Textarea,
  Toggle,
} from "./ui";

const AUDIO_FORMATS = ["mp3", "m4a", "wav", "opus", "flac", "aac"];
const QUALITIES = ["128", "192", "256", "320"];
const VIDEO_QUALITIES = [
  { id: "best", label: "Best available" },
  { id: "1080", label: "1080p" },
  { id: "720", label: "720p" },
  { id: "480", label: "480p" },
  { id: "360", label: "360p" },
  { id: "smallest", label: "Smallest" },
];
const SUB_LANGS = ["en", "es", "fr", "de", "pt", "hi", "ar", "ja", "ko", "zh"];

const STAGE_LABEL = {
  queued: "Queued",
  preparing: "Preparing",
  downloading: "Downloading",
  processing: "Processing with ffmpeg",
  done: "Done",
  error: "Failed",
};

export default function VideoTool() {
  const [url, setUrl] = usePersistentState("cumbuff.url", "");
  const [info, setInfo] = useState(null);
  const [inspecting, setInspecting] = useState(false);
  const [error, setError] = useState("");

  const [mode, setMode] = usePersistentState("cumbuff.mode", "video");
  const [audioFormat, setAudioFormat] = usePersistentState("cumbuff.audioFormat", "mp3");
  const [quality, setQuality] = usePersistentState("cumbuff.quality", "192");
  const [videoFormat, setVideoFormat] = usePersistentState("cumbuff.videoFormat", "best");
  const [subtitles, setSubtitles] = usePersistentState("cumbuff.subtitles", false);
  const [subtitlesLang, setSubtitlesLang] = usePersistentState("cumbuff.subLang", "en");
  const [thumbnail, setThumbnail] = usePersistentState("cumbuff.thumbnail", false);
  const [showAdvanced, setShowAdvanced] = usePersistentState("cumbuff.advanced", false);
  const [useCache, setUseCache] = usePersistentState("cumbuff.cache", true);
  const [extractorArgs, setExtractorArgs] = usePersistentState("cumbuff.extractorArgs", "");
  const [cookies, setCookies] = useState(""); // never persisted

  const [job, setJob] = useState(null);
  const [savedJob, setSavedJob] = useState("");
  const closeStream = useRef(null);
  const inspected = useRef(false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const buildAdvanced = useCallback(() => {
    const advanced = { cache: useCache };
    if (cookies.trim()) advanced.cookies = cookies.trim();
    const args = parseExtractorArgs(extractorArgs);
    if (args) advanced.extractor_args = args;
    return advanced;
  }, [cookies, useCache, extractorArgs]);

  const inspect = useCallback(
    async (target) => {
      const value = String(target ?? "").trim();
      if (!value) {
        setError("Paste a video URL first.");
        return;
      }
      setUrl(value);
      setInspecting(true);
      setError("");
      try {
        const data = await postJson("/api/py/metadata", { url: value, advanced: buildAdvanced() });
        setInfo(data);
        if (typeof window !== "undefined") {
          const params = new URLSearchParams(window.location.search);
          params.set("url", value);
          window.history.replaceState(null, "", `?${params.toString()}`);
        }
      } catch (err) {
        setInfo(null);
        setError(err.message);
      } finally {
        setInspecting(false);
      }
    },
    [buildAdvanced, setUrl],
  );

  // Restore a shared link on first load.
  useEffect(() => {
    if (inspected.current || typeof window === "undefined") return;
    const shared = new URLSearchParams(window.location.search).get("url");
    if (shared) {
      inspected.current = true;
      inspect(shared);
    }
  }, [inspect]);

  useEffect(() => () => closeStream.current?.(), []);

  async function startDownload() {
    if (!url.trim()) {
      setError("Paste a video URL first.");
      return;
    }
    closeStream.current?.();
    setJob(null);
    setSavedJob("");
    setError("");
    try {
      const created = await createDownload({
        url: url.trim(),
        kind: mode,
        format: audioFormat,
        quality,
        video_format: videoFormat,
        subtitles,
        subtitles_lang: subtitlesLang,
        thumbnail,
        advanced: buildAdvanced(),
      });
      setJob({ id: created.job_id, status: "queued", stage: "queued", progress: {}, files: [] });
      closeStream.current = subscribeJob(created.events, (snapshot) => {
        setJob(snapshot);
        if (snapshot.status === "error") {
          setError(snapshot.error || "Download failed");
        }
      });
    } catch (err) {
      setError(err.message);
    }
  }

  // When a job finishes, fetch the primary file and save it once.
  useEffect(() => {
    if (!job || job.status !== "done" || savedJob === job.id) return;
    const primary = job.files?.find((f) => f.primary) ?? job.files?.[0];
    if (!primary) return;
    setSavedJob(job.id);
    fetchJobFile(job.id)
      .then((blob) => saveBlob(blob, primary.name))
      .catch((err) => setError(err.message));
  }, [job, savedJob]);

  async function saveAsset(name) {
    try {
      const blob = await fetchJobFile(job.id, name);
      saveBlob(blob, name);
    } catch (err) {
      setError(err.message);
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

  const jobActive = job && (job.status === "queued" || job.status === "running");
  const percent = job?.progress?.percent;
  const detail = [
    job?.progress?.speed ? formatSpeed(job.progress.speed) : "",
    job?.progress?.eta ? `ETA ${formatDuration(job.progress.eta)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

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
              if (e.key === "Enter") inspect(url);
            }}
            placeholder="https://www.youtube.com/watch?v=..."
            aria-label="Video URL"
          />
          <Button onClick={() => inspect(url)} disabled={inspecting} className="sm:w-32">
            {inspecting ? <Spinner /> : null}
            {inspecting ? "Inspecting" : "Inspect"}
          </Button>
        </div>

        <fieldset className="mt-5 flex flex-col gap-4 border-0 p-0">
          <legend className="sr-only">Download type</legend>
          <div className="inline-flex w-fit rounded-2xl border border-line bg-surface-2/60 p-1">
            {[
              { id: "video", label: "Video" },
              { id: "audio", label: "Audio" },
            ].map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={mode === option.id}
                onClick={() => setMode(option.id)}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  mode === option.id
                    ? "bg-accent text-on-accent"
                    : "text-fg-muted hover:text-fg"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {mode === "audio" ? (
            <div className="flex flex-wrap items-end gap-3">
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
            </div>
          ) : (
            <div className="w-full sm:w-56">
              <Field label="Video quality">
                <Select value={videoFormat} onChange={(e) => setVideoFormat(e.target.value)}>
                  {VIDEO_QUALITIES.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-3">
              <Toggle
                label="Download subtitles"
                hint="Writes subtitle tracks alongside the media."
                checked={subtitles}
                onChange={setSubtitles}
              />
              {subtitles ? (
                <Field label="Subtitle language">
                  <Select value={subtitlesLang} onChange={(e) => setSubtitlesLang(e.target.value)}>
                    {SUB_LANGS.map((lang) => (
                      <option key={lang} value={lang}>
                        {lang}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
            </div>
            <Toggle
              label="Download thumbnail"
              hint="Saves the cover image as its own file."
              checked={thumbnail}
              onChange={setThumbnail}
            />
          </div>

          <div className="rounded-2xl border border-line bg-surface-2/40 p-3.5">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              aria-expanded={showAdvanced}
              className="flex w-full items-center justify-between text-sm font-semibold text-fg"
            >
              Advanced yt-dlp options
              <span className="font-mono text-xs text-fg-muted">{showAdvanced ? "–" : "+"}</span>
            </button>
            {showAdvanced ? (
              <div className="mt-4 flex flex-col gap-4">
                <Toggle
                  label="Use the extractor cache"
                  hint="Reuses a persistent yt-dlp cache between requests."
                  checked={useCache}
                  onChange={setUseCache}
                />
                <Field
                  label="Cookies (Netscape format)"
                  hint="Sent only with this request and never stored."
                >
                  <Textarea
                    rows={4}
                    value={cookies}
                    onChange={(e) => setCookies(e.target.value)}
                    placeholder="# Netscape HTTP Cookie File"
                    spellCheck={false}
                  />
                </Field>
                <Field
                  label="Extractor args"
                  hint="One per line, e.g. youtube: player_client=web_safari"
                >
                  <Textarea
                    rows={3}
                    value={extractorArgs}
                    onChange={(e) => setExtractorArgs(e.target.value)}
                    placeholder="youtube: player_client=web,mweb"
                    spellCheck={false}
                  />
                </Field>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={startDownload} disabled={jobActive}>
              {jobActive ? <Spinner /> : null}
              {jobActive
                ? "Working…"
                : mode === "audio"
                  ? "Download audio"
                  : "Download video"}
            </Button>
            {jobActive && job?.id ? (
              <Button
                variant="ghost"
                onClick={() => {
                  closeStream.current?.();
                  setJob({ ...job, status: "cancelled" });
                }}
              >
                Stop watching
              </Button>
            ) : null}
          </div>

          {job && job.status !== "cancelled" ? (
            <div className="mt-1">
              <Progress
                stage={STAGE_LABEL[job.stage] ?? job.stage}
                percent={percent}
                detail={detail}
                active={jobActive}
              />
            </div>
          ) : null}

          {job?.status === "done" ? (
            <div className="rounded-xl border border-accent-2/30 bg-accent-2/5 px-3.5 py-3 text-sm">
              <p className="font-medium text-accent-2">
                Download ready{job.files?.length > 1 ? " — extra files:" : ""}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {job.files
                  .filter((f) => !f.primary)
                  .map((f) => (
                    <Button key={f.name} variant="ghost" onClick={() => saveAsset(f.name)}>
                      {f.name} ({formatBytes(f.size)})
                    </Button>
                  ))}
                {(job.files?.length ?? 0) <= 1 ? (
                  <span className="text-fg-muted">Saved to your downloads.</span>
                ) : null}
              </div>
            </div>
          ) : null}
        </fieldset>

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
                alt={`Thumbnail for ${info.title ?? "video"}`}
                className="h-40 w-full rounded-xl border border-line object-cover sm:w-72"
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-bold leading-snug text-fg">{info.title}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge tone="amber">{info.extractor ?? "video"}</Badge>
                {info.is_live ? <Badge tone="mint">live</Badge> : null}
                {info.uploader ? (
                  <span className="text-sm text-fg-muted">{info.uploader}</span>
                ) : null}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Duration" value={formatDuration(info.duration, info.duration_string)} />
                <Stat label="Views" value={formatNumber(info.view_count)} />
                <Stat label="Likes" value={formatNumber(info.like_count)} />
                <Stat label="Uploaded" value={formatUploadDate(info.upload_date)} />
              </div>
              {info.description ? (
                <p className="mt-4 line-clamp-4 whitespace-pre-line text-sm leading-relaxed text-fg-muted">
                  {info.description}
                </p>
              ) : null}
            </div>
          </div>

          {info.formats?.length ? (
            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-fg">Available formats</h4>
                <span className="text-xs text-fg-subtle">{info.formats.length} tracks</span>
              </div>
              <div className="scroll-thin max-h-80 overflow-auto rounded-xl border border-line">
                <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                  <thead className="sticky top-0 bg-surface-2 text-[11px] uppercase tracking-wider text-fg-subtle">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-semibold">ID</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Ext</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Resolution</th>
                      <th scope="col" className="px-3 py-2 font-semibold">FPS</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Codecs</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Size</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line font-mono text-xs">
                    {info.formats.slice(0, 60).map((f, i) => (
                      <tr key={`${f.format_id}-${i}`} className="hover:bg-surface-2/60">
                        <td className="px-3 py-2 text-accent">{f.format_id}</td>
                        <td className="px-3 py-2 text-fg-soft">{f.ext}</td>
                        <td className="px-3 py-2 text-fg">{f.resolution ?? "—"}</td>
                        <td className="px-3 py-2 text-fg-muted">{f.fps ?? "—"}</td>
                        <td className="px-3 py-2 text-fg-muted">
                          {f.vcodec ?? "—"} / {f.acodec ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-fg-muted">{formatBytes(f.filesize)}</td>
                        <td className="px-3 py-2 text-fg-subtle">{f.note ?? "—"}</td>
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
        <SectionTitle eyebrow="yt-dlp" title="Search">
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
              <div
                key={r.id}
                className="group overflow-hidden rounded-xl border border-line bg-surface-2/50 transition hover:border-accent/50"
              >
                <button
                  type="button"
                  onClick={() => inspect(r.url)}
                  className="block w-full text-left"
                  aria-label={`Inspect ${r.title}`}
                >
                  <div className="aspect-video w-full overflow-hidden bg-surface-3">
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
                    <p className="line-clamp-2 text-sm font-medium text-fg">{r.title}</p>
                    <p className="mt-1 text-xs text-fg-subtle">
                      {r.uploader ? `${r.uploader} · ` : ""}
                      {r.duration ? formatDuration(r.duration) : "—"}
                    </p>
                  </div>
                </button>
                <div className="px-3 pb-3">
                  <Button
                    variant="subtle"
                    className="w-full"
                    onClick={() => {
                      setUrl(r.url ?? "");
                      setMode("audio");
                    }}
                  >
                    Set as audio target
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
