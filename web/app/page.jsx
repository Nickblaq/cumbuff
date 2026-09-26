"use client";

import { useState } from "react";
import VideoTool from "../components/VideoTool";
import ImageTool from "../components/ImageTool";

const TABS = [
  { id: "video", label: "Video", sub: "yt-dlp · python" },
  { id: "image", label: "Image", sub: "sharp · node" },
];

const ENDPOINTS = [
  "POST /api/py/metadata",
  "POST /api/py/search",
  "POST /api/py/audio",
  "POST /api/node/image/resize",
  "POST /api/node/image/thumbnail",
  "POST /api/node/image/metadata",
  "GET  /api/node/image/placeholder",
];

export default function Home() {
  const [tab, setTab] = useState("video");

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-60" />
      <div className="bg-aurora pointer-events-none absolute inset-x-0 top-0 h-[520px]" />

      <div className="relative mx-auto flex max-w-6xl flex-col gap-12 px-5 py-10 sm:px-8 sm:py-14">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-glow font-mono text-sm font-bold text-ink-950">
              cb
            </span>
            <span className="font-mono text-sm font-semibold tracking-tight text-mist-100">
              cumbuff
            </span>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <span className="rounded-full border border-line bg-ink-900/70 px-3 py-1 font-mono text-[11px] text-mist-400">
              one endpoint
            </span>
            <a
              href="/health"
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-line bg-ink-900/70 px-3 py-1 font-mono text-[11px] text-mist-400 transition hover:text-amber-glow"
            >
              /health
            </a>
          </div>
        </header>

        <section className="max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-amber-glow/30 bg-amber-glow/10 px-3 py-1 text-xs font-semibold text-amber-glow">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-glow" />
            yt-dlp + sharp in one service
          </span>
          <h1 className="mt-5 text-4xl font-extrabold leading-[1.05] tracking-tight text-mist-100 sm:text-6xl">
            One endpoint for{" "}
            <span className="bg-gradient-to-r from-amber-glow to-mint-glow bg-clip-text text-transparent">
              video and image
            </span>{" "}
            work.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-mist-400 sm:text-lg">
            Pull metadata and audio from anywhere yt-dlp supports, then resize, convert and inspect
            images with sharp. A Next.js UI on top of a Node gateway and a private Python sidecar —
            all served from a single port.
          </p>
          <div className="mt-7 flex flex-wrap gap-2">
            {["ffmpeg ready", "metadata", "audio extraction", "resize", "convert", "thumbnails"].map(
              (chip) => (
                <span
                  key={chip}
                  className="rounded-lg border border-line bg-ink-900/70 px-3 py-1.5 text-xs text-mist-400"
                >
                  {chip}
                </span>
              ),
            )}
          </div>
        </section>

        <section>
          <div className="mb-6 inline-flex rounded-2xl border border-line bg-ink-900/70 p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-xl px-5 py-2.5 text-left transition ${
                  tab === t.id
                    ? "bg-amber-glow text-ink-950 shadow-[0_10px_28px_-14px_rgba(244,181,68,0.8)]"
                    : "text-mist-400 hover:text-mist-100"
                }`}
              >
                <span className="block text-sm font-bold">{t.label}</span>
                <span
                  className={`block font-mono text-[10px] uppercase tracking-wider ${
                    tab === t.id ? "text-ink-950/70" : "text-mist-500"
                  }`}
                >
                  {t.sub}
                </span>
              </button>
            ))}
          </div>

          {tab === "video" ? <VideoTool /> : <ImageTool />}
        </section>

        <footer className="mt-4 border-t border-line pt-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-mono text-xs text-mist-500">
                GET /api — full endpoint index
              </p>
              <p className="mt-1 text-xs text-mist-500">
                Everything below is served from this same origin.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {ENDPOINTS.map((e) => (
                <span key={e} className="font-mono text-[11px] text-mist-400">
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
