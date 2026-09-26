import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProxyMiddleware } from "http-proxy-middleware";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3000);
const PY_PORT = Number(process.env.PY_INTERNAL_PORT || 8000);
const PY_ORIGIN = `http://127.0.0.1:${PY_PORT}`;
const PY_HEALTH = `${PY_ORIGIN}/health`;
const WEB_DIR = path.join(__dirname, "..", "web", "out");

const app = express();
let pythonReady = false;

async function pingPython() {
  try {
    const res = await fetch(PY_HEALTH, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

// Poll the sidecar so we always know whether it is serving traffic.
async function monitorPython() {
  for (;;) {
    const ready = await pingPython();
    if (ready !== pythonReady) {
      console.log(`[gateway] python sidecar ${ready ? "ready" : "unavailable"}`);
    }
    pythonReady = ready;
    await new Promise((resolve) => setTimeout(resolve, ready ? 5000 : 500));
  }
}

// Retry until the sidecar answers, so early requests are not dropped.
async function waitForPython(maxMs = 10000) {
  const deadline = Date.now() + maxMs;
  do {
    if (await pingPython()) {
      pythonReady = true;
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  } while (Date.now() < deadline);
  return false;
}

const pythonProxy = createProxyMiddleware({
  pathFilter: (p) => p === "/api/py" || p.startsWith("/api/py/"),
  target: PY_ORIGIN,
  changeOrigin: true,
  xfwd: true,
  pathRewrite: (p) => p.replace(/^\/api\/py/, "") || "/",
  on: {
    error: (err, _req, res) => {
      console.error("[gateway] python proxy error:", err.message);
      if (res && !res.headersSent && typeof res.writeHead === "function") {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: "python_backend_unavailable", detail: err.message }),
        );
      }
    },
  },
});

// Proxy first, before body parsing, so request bodies stream straight through.
app.use(async (req, res, next) => {
  if (!req.path.startsWith("/api/py")) return next();
  if (pythonReady || (await waitForPython())) return pythonProxy(req, res, next);
  res.status(503).json({
    error: "python_backend_starting",
    detail: "The Python sidecar is not ready yet. Please retry shortly.",
  });
});

app.use(express.json({ limit: "2mb" }));

/* ------------------------------------------------------------------ *
 * sharp image tools (Node, served in-process)
 * ------------------------------------------------------------------ */

const MIME = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  tiff: "image/tiff",
};
const FITS = ["cover", "contain", "fill", "inside", "outside"];
const EFFECTS = ["none", "grayscale", "blur", "sharpen", "negate"];

// Accept raw image bytes (or SVG text); never parse these as JSON.
const rawImage = express.raw({
  type: ["image/*", "application/octet-stream", "text/plain", "application/xml", "text/xml"],
  limit: "25mb",
});

function parseNum(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function parseFormat(value) {
  const f = String(value || "").toLowerCase();
  if (f === "jpg") return "jpeg";
  return MIME[f] ? f : null;
}

function requireBody(req, res) {
  if (!req.body || !req.body.length) {
    res.status(400).json({
      error: "empty_body",
      detail: "POST the raw image bytes with an image/* Content-Type.",
    });
    return false;
  }
  return true;
}

function applyEffect(pipeline, effect, req) {
  if (effect === "grayscale") return pipeline.grayscale();
  if (effect === "blur") return pipeline.blur(parseNum(req.query.sigma, 0.3, 100, 8));
  if (effect === "sharpen") return pipeline.sharpen();
  if (effect === "negate") return pipeline.negate();
  return pipeline;
}

async function runSharp(res, work) {
  try {
    await work();
  } catch (err) {
    console.error("[gateway] sharp error:", err.message);
    res.status(400).json({ error: "image_processing_failed", detail: err.message });
  }
}

// Resize / convert / apply an effect and stream the result back.
app.post("/api/node/image/resize", rawImage, (req, res) =>
  runSharp(res, async () => {
    if (!requireBody(req, res)) return;
    const width = parseNum(req.query.width, 1, 6000, undefined);
    const height = parseNum(req.query.height, 1, 6000, undefined);
    const fit = FITS.includes(req.query.fit) ? req.query.fit : "inside";
    const effect = EFFECTS.includes(req.query.effect) ? req.query.effect : "none";
    const quality = parseNum(req.query.quality, 1, 100, 80);

    const input = sharp(req.body, { failOn: "none" });
    const meta = await input.metadata();
    const outFormat = parseFormat(req.query.format) || (MIME[meta.format] ? meta.format : "webp");

    let pipeline = sharp(req.body, { failOn: "none" });
    if (width || height) pipeline = pipeline.resize({ width, height, fit });
    pipeline = applyEffect(pipeline, effect, req);
    pipeline = pipeline.toFormat(outFormat, { quality });

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    res.setHeader("Content-Type", MIME[outFormat] || "application/octet-stream");
    res.setHeader("X-Image-Width", info.width);
    res.setHeader("X-Image-Height", info.height);
    res.setHeader("X-Image-Format", info.format);
    res.setHeader("Cache-Control", "no-store");
    res.send(data);
  }),
);

// Square thumbnail, always webp.
app.post("/api/node/image/thumbnail", rawImage, (req, res) =>
  runSharp(res, async () => {
    if (!requireBody(req, res)) return;
    const size = parseNum(req.query.size, 16, 1024, 256);
    const data = await sharp(req.body, { failOn: "none" })
      .resize(size, size, { fit: "cover", position: "attention" })
      .webp({ quality: 80 })
      .toBuffer();
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("X-Image-Size", size);
    res.setHeader("Cache-Control", "no-store");
    res.send(data);
  }),
);

// Inspect an image without transforming it.
app.post("/api/node/image/metadata", rawImage, (req, res) =>
  runSharp(res, async () => {
    if (!requireBody(req, res)) return;
    const m = await sharp(req.body, { failOn: "none" }).metadata();
    res.json({
      format: m.format,
      width: m.width,
      height: m.height,
      space: m.space,
      channels: m.channels,
      hasAlpha: m.hasAlpha,
      density: m.density,
      orientation: m.orientation,
      isAnimated: m.pages > 1,
      pages: m.pages,
      size: req.body.length,
      aspectRatio: m.width && m.height ? Number((m.width / m.height).toFixed(3)) : null,
    });
  }),
);

// Rasterize an SVG (posted as text or image/svg+xml) to png/webp/jpeg.
app.post("/api/node/image/svg", rawImage, (req, res) =>
  runSharp(res, async () => {
    if (!requireBody(req, res)) return;
    const width = parseNum(req.query.width, 1, 6000, undefined);
    const format = parseFormat(req.query.format) || "png";
    let pipeline = sharp(Buffer.from(req.body.toString("utf8")), { density: 300 });
    if (width) pipeline = pipeline.resize({ width });
    const data = await pipeline.toFormat(format).toBuffer();
    res.setHeader("Content-Type", MIME[format]);
    res.setHeader("Cache-Control", "no-store");
    res.send(data);
  }),
);

// Generate a gradient placeholder so the tool is usable with no upload.
app.get("/api/node/image/placeholder", (req, res) =>
  runSharp(res, async () => {
    const width = parseNum(req.query.width, 16, 2400, 960);
    const height = parseNum(req.query.height, 16, 2400, 540);
    const label = String(req.query.text || `${width} x ${height}`)
      .slice(0, 48)
      .replace(/[<>&"']/g, "");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#101017"/>
          <stop offset="55%" stop-color="#2a1d12"/>
          <stop offset="100%" stop-color="#0e2b26"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <rect x="24" y="24" width="${Math.max(width - 48, 1)}" height="${Math.max(height - 48, 1)}"
        fill="none" stroke="#f4b544" stroke-opacity="0.35" stroke-width="2" rx="18"/>
      <text x="50%" y="50%" fill="#f4b544" font-family="monospace" font-size="${Math.max(
        Math.round(Math.min(width, height) / 12),
        14,
      )}" text-anchor="middle" dominant-baseline="middle">${label}</text>
    </svg>`;
    const data = await sharp(Buffer.from(svg)).png().toBuffer();
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.send(data);
  }),
);

/* ------------------------------------------------------------------ *
 * Node service routes
 * ------------------------------------------------------------------ */

app.get("/api/node/hello", (_req, res) => {
  res.json({ from: "node", message: "Hello from the Node.js API" });
});

app.get("/api/node/info", (_req, res) => {
  res.json({
    runtime: "node",
    version: process.version,
    platform: process.platform,
    pid: process.pid,
    sharp: sharp.versions?.sharp || "unknown",
  });
});

/* ------------------------------------------------------------------ *
 * Combined health for the whole service
 * ------------------------------------------------------------------ */

app.get("/health", async (_req, res) => {
  const pyUp = pythonReady && (await pingPython());
  res.status(pyUp ? 200 : 503).json({
    status: pyUp ? "ok" : "degraded",
    services: { node: "up", python: pyUp ? "up" : "down" },
  });
});

/* ------------------------------------------------------------------ *
 * Static Next.js export + API index
 * ------------------------------------------------------------------ */

app.get("/api", (_req, res) => {
  res.json({
    service: "cumbuff",
    description: "Node (sharp) + Python (yt-dlp) behind one endpoint, with a Next.js UI",
    endpoints: {
      health: "/health",
      node: [
        "GET  /api/node/hello",
        "GET  /api/node/info",
        "GET  /api/node/image/placeholder?width=&height=&text=",
        "POST /api/node/image/resize?width=&height=&fit=&format=&quality=&effect=",
        "POST /api/node/image/thumbnail?size=",
        "POST /api/node/image/metadata",
        "POST /api/node/image/svg?width=&format=",
      ],
      python: [
        "POST /api/py/metadata { url }",
        "POST /api/py/formats { url }",
        "POST /api/py/search { query, limit }",
        "POST /api/py/audio { url, format, quality }",
      ],
    },
  });
});

app.use(express.static(WEB_DIR, { extensions: ["html"] }));

// Fallback: API misses stay JSON, everything else serves the SPA shell.
app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "not_found", path: req.path });
  }
  res.sendFile(path.join(WEB_DIR, "index.html"), (err) => {
    if (err) {
      res.status(200).json({
        service: "cumbuff",
        note: "The Next.js UI is not built yet. Run `npm run build` (Railpack does this on deploy).",
      });
    }
  });
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`[gateway] node api listening on 0.0.0.0:${PORT}`);
  console.log(`[gateway] proxying /api/py/* -> ${PY_ORIGIN}`);
  console.log(`[gateway] serving static UI from ${WEB_DIR}`);
  monitorPython();
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`[gateway] received ${signal}, shutting down`);
    server.close(() => process.exit(0));
  });
}
