import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

const PORT = Number(process.env.PORT || 3000);
const PY_PORT = Number(process.env.PY_INTERNAL_PORT || 8000);
const PY_ORIGIN = `http://127.0.0.1:${PY_PORT}`;
const PY_HEALTH = `${PY_ORIGIN}/health`;

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
  pathFilter: (path) => path === "/api/py" || path.startsWith("/api/py/"),
  target: PY_ORIGIN,
  changeOrigin: true,
  xfwd: true,
  pathRewrite: (path) => path.replace(/^\/api\/py/, "") || "/",
  on: {
    error: (err, _req, res) => {
      console.error("[gateway] python proxy error:", err.message);
      if (res && !res.headersSent && typeof res.writeHead === "function") {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "python_backend_unavailable",
            detail: err.message,
          }),
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

app.use(express.json());

// --- Node API (served in-process by this gateway) ---
app.get("/api/node/hello", (_req, res) => {
  res.json({ from: "node", message: "Hello from the Node.js API" });
});

app.get("/api/node/info", (_req, res) => {
  res.json({
    runtime: "node",
    version: process.version,
    platform: process.platform,
    pid: process.pid,
  });
});

// --- Combined health for the whole service ---
app.get("/health", async (_req, res) => {
  const pyUp = pythonReady && (await pingPython());
  res.status(pyUp ? 200 : 503).json({
    status: pyUp ? "ok" : "degraded",
    services: { node: "up", python: pyUp ? "up" : "down" },
  });
});

app.get("/", (_req, res) => {
  res.json({
    service: "cumbuff",
    description: "Node.js gateway + Python FastAPI sidecar behind a single endpoint",
    endpoints: {
      health: "/health",
      node: ["/api/node/hello", "/api/node/info"],
      python: ["/api/py/hello", "/api/py/info", "/api/py/health"],
    },
  });
});

app.use((_req, res) => res.status(404).json({ error: "not_found" }));

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`[gateway] node api listening on 0.0.0.0:${PORT}`);
  console.log(`[gateway] proxying /api/py/* -> ${PY_ORIGIN}`);
  monitorPython();
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`[gateway] received ${signal}, shutting down`);
    server.close(() => process.exit(0));
  });
}
