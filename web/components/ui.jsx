const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-glow/80 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950";

export function Card({ className = "", children }) {
  return (
    <div className={`rounded-2xl border border-line bg-ink-900/70 backdrop-blur-sm ${className}`}>
      {children}
    </div>
  );
}

export function Button({ variant = "primary", className = "", children, ...props }) {
  const base = `inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
  const variants = {
    primary:
      "bg-amber-glow text-ink-950 hover:brightness-105 shadow-[0_12px_34px_-14px_rgba(244,181,68,0.75)]",
    ghost:
      "border border-line bg-ink-850 text-mist-100 hover:border-amber-glow/50 hover:text-amber-glow",
    subtle: "bg-ink-800 text-mist-300 hover:text-mist-100",
    mint: "bg-mint-glow text-ink-950 hover:brightness-105",
  };
  return (
    <button
      className={`${base} ${variants[variant] ?? variants.primary} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Input({ className = "", ...props }) {
  return (
    <input
      className={`w-full rounded-xl border border-line bg-ink-950/80 px-3.5 py-2.5 text-sm text-mist-100 placeholder:text-mist-500 transition focus:border-amber-glow/60 ${FOCUS} ${className}`}
      {...props}
    />
  );
}

export function Textarea({ className = "", ...props }) {
  return (
    <textarea
      className={`scroll-thin w-full rounded-xl border border-line bg-ink-950/80 px-3.5 py-2.5 font-mono text-xs text-mist-100 placeholder:text-mist-500 transition focus:border-amber-glow/60 ${FOCUS} ${className}`}
      {...props}
    />
  );
}

export function Select({ className = "", children, ...props }) {
  return (
    <span className="relative block">
      <select
        className={`w-full appearance-none rounded-xl border border-line bg-ink-950/80 px-3.5 py-2.5 pr-9 text-sm text-mist-100 transition focus:border-amber-glow/60 ${FOCUS} ${className}`}
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mist-400"
      >
        <path
          d="M6 8l4 4 4-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-mist-500">
        {label}
      </span>
      {children}
      {hint ? <span className="text-xs text-mist-500">{hint}</span> : null}
    </label>
  );
}

export function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="flex items-start gap-3 rounded-xl border border-line bg-ink-950/50 px-3.5 py-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={`mt-0.5 h-4 w-4 shrink-0 rounded border-line bg-ink-900 accent-amber-glow ${FOCUS}`}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-mist-100">{label}</span>
        {hint ? <span className="block text-xs text-mist-500">{hint}</span> : null}
      </span>
    </label>
  );
}

export function Badge({ children, tone = "default" }) {
  const tones = {
    default: "border-line bg-ink-800 text-mist-300",
    amber: "border-amber-glow/30 bg-amber-glow/10 text-amber-glow",
    mint: "border-mint-glow/30 bg-mint-glow/10 text-mint-glow",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
        tones[tone] ?? tones.default
      }`}
    >
      {children}
    </span>
  );
}

export function Spinner({ className = "" }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

export function Progress({ stage, percent, detail, active = true }) {
  const known = typeof percent === "number" && Number.isFinite(percent);
  const value = known ? Math.max(0, Math.min(100, percent)) : 0;
  const indeterminate = active && !known;
  return (
    <div className="flex flex-col gap-1.5" aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-mist-300">{stage}</span>
        <span className="truncate font-mono text-mist-400">
          {indeterminate ? "starting…" : `${value.toFixed(0)}%`}
          {detail ? ` · ${detail}` : ""}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-ink-800">
        {indeterminate ? (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-amber-glow to-mint-glow" />
        ) : (
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-glow to-mint-glow transition-[width] duration-300"
            style={{ width: `${value}%` }}
          />
        )}
      </div>
    </div>
  );
}

export function Alert({ children }) {
  if (!children) return null;
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300"
    >
      {children}
    </div>
  );
}

export function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-line bg-ink-850/60 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-mist-500">
        {label}
      </div>
      <div className="truncate text-sm font-medium text-mist-100">{value ?? "—"}</div>
    </div>
  );
}

export function SectionTitle({ eyebrow, title, children }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-glow/80">
          {eyebrow}
        </div>
        <h2 className="mt-1 text-xl font-bold tracking-tight text-mist-100">{title}</h2>
      </div>
      {children}
    </div>
  );
}
