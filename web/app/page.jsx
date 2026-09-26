"use client";

import VideoTool from "../components/VideoTool";
import ImageTool from "../components/ImageTool";
import { useHashParam } from "../lib/state";

const TABS = [
  { id: "video", label: "Video", sub: "yt-dlp · python" },
  { id: "image", label: "Image", sub: "sharp · node" },
];

const CHIPS = [
  "video downloads",
  "live progress",
  "audio extraction",
  "subtitles",
  "animated webp / gif",
  "convert",
  "thumbnails",
];

const ENDPOINTS = [
  "POST /api/py/metadata",
  "POST /api/py/download",
  "GET  /api/py/jobs/:id/events",
  "POST /api/py/audio",
  "POST /api/node/image/resize",
  "POST /api/node/image/thumbnail",
  "GET  /api/node/image/placeholder",
  "GET  /api — full index",
];

export default function Home() {
  const [tab, setTab] = useHashParam("video");

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-70" />
      <div className="bg-aurora pointer-events-none absolute inset-x-0 top-0 h-[440px] sm:h-[520px]" />

      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:gap-12 sm:px-8 sm:py-14">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent font-mono text-sm font-bold text-on-accent">
              cb
            </span>
            <span className="font-mono text-sm font-semibold tracking-tight text-fg">cumbuff</span>
          </div>
          <a
            href="/health"
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-line bg-surface px-3 py-1 font-mono text-[11px] text-fg-muted transition hover:border-accent/50 hover:text-accent"
          >
            /health
          </a>
        </header>

        <section className="max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            yt-dlp + sharp in one service
          </span>
          <h1 className="mt-4 text-[1.9rem] font-extrabold leading-[1.12] tracking-tight text-fg sm:mt-5 sm:text-6xl">
            One endpoint for{" "}
            <span className="bg-gradient-to-r from-accent to-accent-2 bg-clip-text text-transparent">
              video and image
            </span>{" "}
            work.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-fg-muted sm:mt-5 sm:text-lg">
            Download video and audio with live progress, grab subtitles and thumbnails, and resize,
            convert or animate images. A Next.js UI on top of a Node gateway and a private Python
            sidecar — all served from a single port.
          </p>
          <div className="mt-6 flex flex-wrap gap-2 sm:mt-7">
            {CHIPS.map((chip) => (
              <span
                key={chip}
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-fg-muted"
              >
                {chip}
              </span>
            ))}
          </div>
        </section>

        <section aria-label="Tools">
          <div
            role="tablist"
            aria-label="Choose a tool"
            className="mb-5 flex w-full gap-1 rounded-2xl border border-line bg-surface p-1 sm:mb-6 sm:inline-flex sm:w-auto"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                id={`tab-${t.id}`}
                role="tab"
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                onClick={() => setTab(t.id)}
                className={`flex-1 rounded-xl px-4 py-2.5 text-center transition sm:flex-none sm:px-5 sm:text-left ${
                  tab === t.id
                    ? "bg-accent text-on-accent shadow-[0_10px_28px_-14px_rgba(194,65,12,0.6)]"
                    : "text-fg-muted hover:text-fg"
                }`}
              >
                <span className="block text-sm font-bold">{t.label}</span>
                <span
                  className={`block font-mono text-[10px] uppercase tracking-wider ${
                    tab === t.id ? "text-on-accent/80" : "text-fg-subtle"
                  }`}
                >
                  {t.sub}
                </span>
              </button>
            ))}
          </div>

          <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={-1}>
            {tab === "image" ? <ImageTool /> : <VideoTool />}
          </div>
        </section>

        <footer className="border-t border-line pt-6 sm:pt-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-mono text-xs text-fg-subtle">GET /api — full endpoint index</p>
              <p className="mt-1 text-xs text-fg-subtle">
                Everything below is served from this same origin.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {ENDPOINTS.map((e) => (
                <span key={e} className="break-all font-mono text-[11px] text-fg-muted">
                  {e}
                </span>
              ))}
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
