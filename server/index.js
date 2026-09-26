import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import compression from "compression";
import helmet from "helmet";
import { createProxyMiddleware } from "http-proxy-middleware";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PORT = Number(process.env.PORT || 3000);
const PY_PORT = Number(process.env.PY_INTERNAL_PORT || 8000);
const PY_ORIGIN = `http://127.0.0.1:${PY_PORT}`;
const PY_HEALTH = `${PY_ORIGIN}/health`;
const WEB_DIR = path.join(__dirname, "..", "web", "out");
const LONG_REQUEST_MS = 30 * 60 * 1000;

const app = express();
app.disable("x-powered-by");

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
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "info",
          msg: `python sidecar ${ready ? "ready" : "unavailable"}`,
        }),
      );
    }
    pythonReady = ready;
    await new Promise((resolve) => setTimeout(resolve, ready ? 5000 : 500));
  }
}

// Single-flight probe: never block a request on a 10s wait; answer immediately
// with 503 + Retry-After and refresh readiness in the background.
let probeInFlight = null;
function kickProbe() {
  if (!probeInFlight) {
    probeInFlight = pingPython()
      .then((ok) => {
        pythonReady = ok;
      })
      .catch(() => {})
      .finally(() => {
        probeInFlight = null;
      });
  }
  return probeInFlight;
}

/* ------------------------------------------------------------------ *
 * Request logging (structured, with request ids)
 * ------------------------------------------------------------------ */

app.use((req, res, next) => {
  req.id = req.headers["x-request-id"] || crypto.randomUUID();
  res.setHeader("X-Request-Id", req.id);
  const start = Date.now();
  res.on("finish", () => {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: res.statusCode >= 500 ? "error" : "info",
        msg: "request",
        id: req.id,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        ms: Date.now() - start,
      }),
    );
  });
  next();
});

/* ------------------------------------------------------------------ *
 * Security headers + compression
 * ------------------------------------------------------------------ */

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "blob:", "https:"],
        "media-src": ["'self'", "blob:"],
        "font-src": ["'self'", "data:"],
        "connect-src": ["'self'"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"],
      },
    },
    // Remote thumbnails and cross-origin media must keep working.
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

app.use(
  compression({
    threshold: 1024,
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) return false;
      // Never buffer Server-Sent Events or media streams.
      const type = res.getHeader("Content-Type");
      if (typeof type === "string" && type.includes("text/event-stream")) return false;
      return compression.filter(req, res);
    },
  }),
);

/* ------------------------------------------------------------------ *
 * Python sidecar proxy
 * ------------------------------------------------------------------ */

const pythonProxy = createProxyMiddleware({
  pathFilter: (p) => p === "/api/py" || p.startsWith("/api/py/"),
  target: PY_ORIGIN,
  changeOrigin: true,
  xfwd: true,
  proxyTimeout: LONG_REQUEST_MS,
  timeout: LONG_REQUEST_MS,
  pathRewrite: (p) => p.replace(/^\/api\/py/, "") || "/",
  on: {
    error: (err, _req, res) => {
      console.error(
        JSON.stringify({ ts: new Date().toISOString(), level: "error", msg: "proxy error", detail: err.message }),
      );
      if (res && !res.headersSent && typeof res.writeHead === "function") {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "python_backend_unavailable", detail: err.message }));
      }
    },
  },
});

// Proxy first, before body parsing, so request bodies stream straight through.
app.use((req, res, next) => {
  if (!req.path.startsWith("/api/py")) return next();
  if (pythonReady) return pythonProxy(req, res, next);
  kickProbe();
  res.set("Retry-After", "2").status(503).json({
    error: "python_backend_starting",
    detail: "The Python sidecar is not ready yet. Please retry in a moment.",
    retry_after: 2,
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
const POSITIONS = [
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
  "entropy",
];
const ANIMATED_FORMATS = new Set(["gif", "webp"]);

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

function parseBool(value, fallback) {
  if (value === undefined) return fallback;
  return value === "1" || value === "true" || value === "yes";
}

function parseFormat(value) {
  const f = String(value || "").toLowerCase();
  if (f === "jpg") return "jpeg";
  return MIME[f] ? f : null;
}

function parsePosition(value) {
  return POSITIONS.includes(value) ? value : undefined;
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
    console.error(
      JSON.stringify({ ts: new Date().toISOString(), level: "error", msg: "sharp error", detail: err.message }),
    );
    res.status(400).json({ error: "image_processing_failed", detail: err.message });
  }
}

// Resize / convert / animate / apply an effect and stream the result back.
app.post("/api/node/image/resize", rawImage, (req, res) =>
  runSharp(res, async () => {
    if (!requireBody(req, res)) return;
    const width = parseNum(req.query.width, 1, 6000, undefined);
    const height = parseNum(req.query.height, 1, 6000, undefined);
    const fit = FITS.includes(req.query.fit) ? req.query.fit : "inside";
    const position = parsePosition(req.query.position);
    const effect = EFFECTS.includes(req.query.effect) ? req.query.effect : "none";
    const quality = parseNum(req.query.quality, 1, 100, 80);
    const withoutEnlargement = parseBool(req.query.withoutEnlargement, false);

    const meta = await sharp(req.body, { failOn: "none" }).metadata();
    const inputAnimated = (meta.pages || 1) > 1;
    const outFormat = parseFormat(req.query.format) || (MIME[meta.format] ? meta.format : "webp");
    const keepAnimation =
      inputAnimated && ANIMATED_FORMATS.has(outFormat) && parseBool(req.query.animated, true);

    let pipeline = sharp(req.body, { failOn: "none", animated: keepAnimation });
    if (width || height) {
      pipeline = pipeline.resize({ width, height, fit, position, withoutEnlargement });
    }
    pipeline = applyEffect(pipeline, effect, req);

    const outOpts = { quality };
    if (keepAnimation && outFormat === "gif") outOpts.loop = 0;
    pipeline = pipeline.toFormat(outFormat, outOpts);

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    res.setHeader("Content-Type", MIME[outFormat] || "application/octet-stream");
    res.setHeader("X-Image-Width", info.width);
    res.setHeader("X-Image-Height", info.height);
    res.setHeader("X-Image-Format", info.format);
    res.setHeader("X-Image-Animated", keepAnimation ? "true" : "false");
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
      loop: m.loop,
      delay: m.delay,
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
          <stop offset="0%" stop-color="#fff4ec"/>
          <stop offset="55%" stop-color="#ffe4d1"/>
          <stop offset="100%" stop-color="#d7f2ec"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <rect x="24" y="24" width="${Math.max(width - 48, 1)}" height="${Math.max(height - 48, 1)}"
        fill="none" stroke="#c2410c" stroke-opacity="0.45" stroke-width="2" rx="18"/>
      <text x="50%" y="50%" fill="#c2410c" font-family="monospace" font-size="${Math.max(
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
 * Social share image (generated once with sharp, no binary asset needed)
 * ------------------------------------------------------------------ */

app.get("/og.png", (_req, res) =>
  runSharp(res, async () => {
    const width = 1200;
    const height = 630;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#fffbf7"/>
          <stop offset="60%" stop-color="#fff1e6"/>
          <stop offset="100%" stop-color="#e6f6f2"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>
      <rect x="0" y="0" width="100%" height="6" fill="#c2410c"/>
      <g font-family="Inter, Segoe UI, sans-serif" fill="#23180f">
        <text x="90" y="300" font-size="86" font-weight="800">cumbuff</text>
        <text x="90" y="370" font-size="34" fill="#6b5544">one endpoint for video &amp; image work</text>
        <text x="90" y="440" font-size="26" font-family="monospace" fill="#0f766e">yt-dlp + sharp · node + python</text>
      </g>
      <rect x="88" y="150" width="88" height="88" rx="22" fill="#c2410c"/>
      <text x="132" y="210" font-family="monospace" font-size="40" font-weight="700" fill="#ffffff" text-anchor="middle">cb</text>
    </svg>`;
    const data = await sharp(Buffer.from(svg)).png().toBuffer();
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
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
 * Health: liveness (always ok) vs readiness (needs the sidecar)
 * ------------------------------------------------------------------ */

app.get("/health", (_req, res) => {
  // Liveness: the gateway is up. Never fails on a sidecar restart.
  res.json({ status: "ok", services: { node: "up", python: pythonReady ? "up" : "down" } });
});

app.get("/health/ready", async (_req, res) => {
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
      health: ["GET /health (liveness)", "GET /health/ready (readiness)"],
      node: [
        "GET  /api/node/hello",
        "GET  /api/node/info",
        "GET  /api/node/image/placeholder?width=&height=&text=",
        "POST /api/node/image/resize?width=&height=&fit=&position=&format=&quality=&effect=&animated=&withoutEnlargement=",
        "POST /api/node/image/thumbnail?size=",
        "POST /api/node/image/metadata",
        "POST /api/node/image/svg?width=&format=",
        "GET  /og.png",
      ],
      python: [
        "POST /api/py/metadata { url, advanced? }",
        "POST /api/py/formats { url, advanced? }",
        "POST /api/py/search { query, limit, advanced? }",
        "POST /api/py/download { url, kind, format, quality, video_format, subtitles, thumbnail, advanced? }",
        "GET  /api/py/jobs/{id}",
        "GET  /api/py/jobs/{id}/events (SSE)",
        "GET  /api/py/jobs/{id}/file?name=",
        "POST /api/py/audio { url, format, quality }",
      ],
    },
  });
});

app.use(
  express.static(WEB_DIR, {
    extensions: ["html"],
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}_next${path.sep}static${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache");
      } else {
        res.setHeader("Cache-Control", "public, max-age=86400");
      }
    },
  }),
);

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

export function start() {
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        msg: `gateway listening on 0.0.0.0:${PORT}`,
        python: PY_ORIGIN,
        web: WEB_DIR,
      }),
    );
    monitorPython();
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: `received ${signal}` }));
      server.close(() => process.exit(0));
    });
  }
  return server;
}

export { app };

// Only listen when executed directly, so tests can import the app.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  start();
}
