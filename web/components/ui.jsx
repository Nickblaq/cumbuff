const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

export function Card({ className = "", children }) {
  return (
    <div
      className={`rounded-2xl border border-line bg-surface shadow-[0_14px_36px_-28px_rgba(35,24,15,0.45)] ${className}`}
    >
      {children}
    </div>
  );
}

export function Button({ variant = "primary", className = "", children, ...props }) {
  const base = `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
  const variants = {
    primary:
      "bg-accent text-on-accent hover:brightness-105 shadow-[0_12px_34px_-14px_rgba(194,65,12,0.32)]",
    ghost:
      "border border-line bg-surface-2 text-fg hover:border-accent/50 hover:text-accent",
    subtle: "bg-surface-3 text-fg-soft hover:text-fg",
    mint: "bg-accent-2 text-on-accent hover:brightness-105",
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
      className={`min-h-11 w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm text-fg placeholder:text-fg-subtle transition focus:border-accent/60 ${FOCUS} ${className}`}
      {...props}
    />
  );
}

export function Textarea({ className = "", ...props }) {
  return (
    <textarea
      className={`scroll-thin w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 font-mono text-xs text-fg placeholder:text-fg-subtle transition focus:border-accent/60 ${FOCUS} ${className}`}
      {...props}
    />
  );
}

export function Select({ className = "", children, ...props }) {
  return (
    <span className="relative block">
      <select
        className={`min-h-11 w-full appearance-none rounded-xl border border-line bg-canvas px-3.5 py-2.5 pr-9 text-sm text-fg transition focus:border-accent/60 ${FOCUS} ${className}`}
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
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
      <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
        {label}
      </span>
      {children}
      {hint ? <span className="text-xs text-fg-subtle">{hint}</span> : null}
    </label>
  );
}

export function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="flex items-start gap-3 rounded-xl border border-line bg-surface-2/50 px-3.5 py-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={`mt-0.5 h-4 w-4 shrink-0 rounded border-line bg-surface accent-accent ${FOCUS}`}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">{label}</span>
        {hint ? <span className="block text-xs text-fg-subtle">{hint}</span> : null}
      </span>
    </label>
  );
}

export function Badge({ children, tone = "default" }) {
  const tones = {
    default: "border-line bg-surface-3 text-fg-soft",
    amber: "border-accent/30 bg-accent/10 text-accent",
    mint: "border-accent-2/30 bg-accent-2/10 text-accent-2",
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
        <span className="font-medium text-fg-soft">{stage}</span>
        <span className="truncate font-mono text-fg-muted">
          {indeterminate ? "starting…" : `${value.toFixed(0)}%`}
          {detail ? ` · ${detail}` : ""}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
        {indeterminate ? (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-accent to-accent-2" />
        ) : (
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2 transition-[width] duration-300"
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
      className="rounded-xl border border-red-300 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
    >
      {children}
    </div>
  );
}

export function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
        {label}
      </div>
      <div className="truncate text-sm font-medium text-fg">{value ?? "—"}</div>
    </div>
  );
}

export function SectionTitle({ eyebrow, title, children }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent/80">
          {eyebrow}
        </div>
        <h2 className="mt-1 text-xl font-bold tracking-tight text-fg">{title}</h2>
      </div>
      {children}
    </div>
  );
}
