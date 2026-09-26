export async function postJson(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return unwrap(res);
}

async function unwrap(res) {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.detail ?? data?.error ?? `Request failed with status ${res.status}`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return data;
}

export async function postImage(path, file) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? data?.detail ?? `Request failed with status ${res.status}`);
  }
  return res.blob();
}

// Create an async download job; the sidecar returns { job_id, events, file }.
export function createDownload(payload) {
  return postJson("/api/py/download", payload);
}

// Subscribe to a job's Server-Sent Events stream. Returns an unsubscribe fn.
export function subscribeJob(eventsPath, onUpdate) {
  const source = new EventSource(`/api/py${eventsPath}`);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    source.close();
  };
  source.onmessage = (event) => {
    try {
      onUpdate(JSON.parse(event.data));
    } catch {
      /* ignore malformed frames */
    }
  };
  source.addEventListener("end", close);
  source.addEventListener("timeout", close);
  source.onerror = close;
  return close;
}

export async function fetchJobFile(jobId, name) {
  const suffix = name ? `?name=${encodeURIComponent(name)}` : "";
  const res = await fetch(`/api/py/jobs/${encodeURIComponent(jobId)}/file${suffix}`);
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? data?.error ?? `Download failed with status ${res.status}`);
  }
  return res.blob();
}

export function saveBlob(blob, filename) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 15000);
}

export function formatBytes(bytes) {
  if (!bytes || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatNumber(n) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact" }).format(n);
}

export function formatDuration(seconds, fallback) {
  if (fallback) return fallback;
  if (!seconds && seconds !== 0) return "—";
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (v) => String(v).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatSpeed(bytesPerSecond) {
  if (!bytesPerSecond) return "";
  return `${formatBytes(bytesPerSecond)}/s`;
}

// Turn "key: a,b" lines from the advanced panel into extractor_args.
export function parseExtractorArgs(text) {
  const args = {};
  for (const line of String(text || "").split("\n")) {
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey?.trim();
    const values = rest.join(":").split(",").map((v) => v.trim()).filter(Boolean);
    if (key && values.length) args[key] = values;
  }
  return Object.keys(args).length ? args : undefined;
}

export function formatUploadDate(value) {
  if (!value || value.length !== 8) return "—";
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}
