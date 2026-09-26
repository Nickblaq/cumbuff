"use client";

import { useRef, useState } from "react";
import { formatBytes, postImage, saveBlob } from "../lib/api";
import { usePersistentState } from "../lib/state";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  SectionTitle,
  Select,
  Spinner,
  Stat,
  Toggle,
} from "./ui";

const FORMATS = ["webp", "avif", "jpeg", "png", "gif"];
const FITS = ["inside", "cover", "contain", "fill", "outside"];
const EFFECTS = ["none", "grayscale", "blur", "sharpen", "negate"];
const POSITIONS = [
  "auto",
  "center",
  "top",
  "right",
  "bottom",
  "left",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "attention",
];

export default function ImageTool() {
  const fileInput = useRef(null);
  const [file, setFile] = useState(null);
  const [originalUrl, setOriginalUrl] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [resultMeta, setResultMeta] = useState(null);
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  const [width, setWidth] = usePersistentState("cumbuff.img.width", "800");
  const [height, setHeight] = usePersistentState("cumbuff.img.height", "");
  const [fit, setFit] = usePersistentState("cumbuff.img.fit", "inside");
  const [format, setFormat] = usePersistentState("cumbuff.img.format", "webp");
  const [quality, setQuality] = usePersistentState("cumbuff.img.quality", "80");
  const [effect, setEffect] = usePersistentState("cumbuff.img.effect", "none");
  const [position, setPosition] = usePersistentState("cumbuff.img.position", "auto");
  const [animated, setAnimated] = usePersistentState("cumbuff.img.animated", true);
  const [withoutEnlargement, setWithoutEnlargement] = usePersistentState(
    "cumbuff.img.noEnlarge",
    false,
  );

  const [phWidth, setPhWidth] = useState("960");
  const [phHeight, setPhHeight] = useState("540");
  const [phText, setPhText] = useState("cumbuff");
  const [phKey, setPhKey] = useState(0);

  function replaceResult(url) {
    setResultUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  }

  function selectFile(next) {
    if (!next) return;
    setFile(next);
    setError("");
    setResultMeta(null);
    replaceResult("");
    setMeta(null);
    setOriginalUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(next);
    });
  }

  function query() {
    const params = new URLSearchParams();
    if (width) params.set("width", width);
    if (height) params.set("height", height);
    params.set("fit", fit);
    params.set("format", format);
    params.set("quality", quality);
    params.set("effect", effect);
    if (position !== "auto") params.set("position", position);
    params.set("animated", animated ? "true" : "false");
    params.set("withoutEnlargement", withoutEnlargement ? "true" : "false");
    return params.toString();
  }

  async function process() {
    if (!file) {
      setError("Choose an image first.");
      return;
    }
    setBusy("process");
    setError("");
    try {
      const blob = await postImage(`/api/node/image/resize?${query()}`, file);
      replaceResult(URL.createObjectURL(blob));
      setResultMeta({ size: blob.size, type: blob.type });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function makeThumbnail() {
    if (!file) {
      setError("Choose an image first.");
      return;
    }
    setBusy("thumb");
    setError("");
    try {
      const blob = await postImage("/api/node/image/thumbnail?size=256", file);
      replaceResult(URL.createObjectURL(blob));
      setResultMeta({ size: blob.size, type: blob.type });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function readMetadata() {
    if (!file) {
      setError("Choose an image first.");
      return;
    }
    setBusy("meta");
    setError("");
    try {
      const res = await fetch("/api/node/image/metadata", {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Could not read metadata");
      setMeta(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  function openPicker() {
    fileInput.current?.click();
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5 sm:p-6">
        <SectionTitle eyebrow="sharp" title="Image studio">
          <Badge tone="amber">node</Badge>
        </SectionTitle>

        {/* Keyboard-accessible dropzone */}
        <button
          type="button"
          onClick={openPicker}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openPicker();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            selectFile(e.dataTransfer.files?.[0]);
          }}
          aria-label="Upload an image by dropping a file, or press Enter to browse"
          className={`mt-5 w-full cursor-pointer rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${
            dragging
              ? "border-amber-glow bg-amber-glow/5"
              : "border-line bg-ink-950/40 hover:border-amber-glow/40"
          }`}
        >
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => selectFile(e.target.files?.[0])}
          />
          <span className="block text-sm font-medium text-mist-100">
            {file ? file.name : "Drop an image or click to browse"}
          </span>
          <span className="mt-1 block text-xs text-mist-500">
            {file ? formatBytes(file.size) : "PNG · JPEG · WEBP · AVIF · GIF · SVG"}
          </span>
        </button>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="Width">
            <Input
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              inputMode="numeric"
              placeholder="auto"
            />
          </Field>
          <Field label="Height">
            <Input
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              inputMode="numeric"
              placeholder="auto"
            />
          </Field>
          <Field label="Fit">
            <Select value={fit} onChange={(e) => setFit(e.target.value)}>
              {FITS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Anchor">
            <Select value={position} onChange={(e) => setPosition(e.target.value)}>
              {POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Format">
            <Select value={format} onChange={(e) => setFormat(e.target.value)}>
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Quality">
            <Input value={quality} onChange={(e) => setQuality(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Effect">
            <Select value={effect} onChange={(e) => setEffect(e.target.value)}>
              {EFFECTS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Toggle
              label="Animated"
              hint="Preserve frames for GIF and WebP."
              checked={animated}
              onChange={setAnimated}
            />
          </div>
        </div>

        <div className="mt-3 max-w-sm">
          <Toggle
            label="Never enlarge"
            hint="Skip upscaling when the target is larger than the source."
            checked={withoutEnlargement}
            onChange={setWithoutEnlargement}
          />
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <Button onClick={process} disabled={busy === "process"}>
            {busy === "process" ? <Spinner /> : null}
            {busy === "process" ? "Processing" : "Transform"}
          </Button>
          <Button variant="ghost" onClick={makeThumbnail} disabled={busy === "thumb"}>
            {busy === "thumb" ? <Spinner /> : null}
            Thumbnail
          </Button>
          <Button variant="ghost" onClick={readMetadata} disabled={busy === "meta"}>
            {busy === "meta" ? <Spinner /> : null}
            Metadata
          </Button>
          {resultUrl ? (
            <Button
              variant="mint"
              onClick={() => {
                fetch(resultUrl)
                  .then((r) => r.blob())
                  .then((b) => saveBlob(b, `cumbuff.${format}`));
              }}
            >
              Download result
            </Button>
          ) : null}
        </div>

        {error ? (
          <div className="mt-4">
            <Alert>{error}</Alert>
          </div>
        ) : null}

        {originalUrl || resultUrl ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-mist-500">
                Original
              </div>
              <div className="flex h-56 items-center justify-center overflow-hidden rounded-xl border border-line bg-[repeating-conic-gradient(#15151f_0%_25%,#1d1d29_0%_50%)] bg-[length:20px_20px]">
                {originalUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={originalUrl}
                    alt="Original upload"
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <span className="text-xs text-mist-500">No image</span>
                )}
              </div>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-mist-500">
                <span>Result</span>
                {resultMeta ? (
                  <span className="font-mono text-mist-400">
                    {formatBytes(resultMeta.size)} · {resultMeta.type}
                  </span>
                ) : null}
              </div>
              <div className="flex h-56 items-center justify-center overflow-hidden rounded-xl border border-line bg-[repeating-conic-gradient(#15151f_0%_25%,#1d1d29_0%_50%)] bg-[length:20px_20px]">
                {resultUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={resultUrl}
                    alt="Transformed result"
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <span className="text-xs text-mist-500">Transform to preview</span>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {meta ? (
          <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            <Stat label="Format" value={meta.format} />
            <Stat label="Dimensions" value={`${meta.width} × ${meta.height}`} />
            <Stat label="Aspect" value={meta.aspectRatio} />
            <Stat label="Channels" value={meta.channels} />
            <Stat label="Alpha" value={meta.hasAlpha ? "yes" : "no"} />
            <Stat
              label="Animated"
              value={meta.isAnimated ? `yes (${meta.pages} frames)` : "no"}
            />
            <Stat label="Size" value={formatBytes(meta.size)} />
          </div>
        ) : null}
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionTitle eyebrow="sharp" title="Placeholder generator">
          <Badge tone="amber">node</Badge>
        </SectionTitle>
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="Width">
            <Input value={phWidth} onChange={(e) => setPhWidth(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Height">
            <Input value={phHeight} onChange={(e) => setPhHeight(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Label">
            <Input value={phText} onChange={(e) => setPhText(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button variant="ghost" className="w-full" onClick={() => setPhKey((k) => k + 1)}>
              Generate
            </Button>
          </div>
        </div>
        <div className="mt-5 flex h-64 items-center justify-center overflow-hidden rounded-xl border border-line bg-ink-950/60">
          {phKey > 0 ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={phKey}
              src={`/api/node/image/placeholder?width=${phWidth || 960}&height=${
                phHeight || 540
              }&text=${encodeURIComponent(phText || "cumbuff")}&v=${phKey}`}
              alt="Generated gradient placeholder"
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="text-xs text-mist-500">Click Generate to render a placeholder</span>
          )}
        </div>
      </Card>
    </div>
  );
}
