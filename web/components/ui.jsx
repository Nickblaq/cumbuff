export function Card({ className = "", children }) {
  return (
    <div className={`rounded-2xl border border-line bg-ink-900/70 backdrop-blur-sm ${className}`}>
      {children}
    </div>
  );
}

export function Button({ variant = "primary", className = "", children, ...props }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
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
      className={`w-full rounded-xl border border-line bg-ink-950/80 px-3.5 py-2.5 text-sm text-mist-100 placeholder:text-mist-500 outline-none transition focus:border-amber-glow/60 ${className}`}
      {...props}
    />
  );
}

export function Select({ className = "", children, ...props }) {
  return (
    <select
      className={`w-full appearance-none rounded-xl border border-line bg-ink-950/80 px-3.5 py-2.5 text-sm text-mist-100 outline-none transition focus:border-amber-glow/60 ${className}`}
      {...props}
    >
      {children}
    </select>
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
      className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

export function Alert({ children }) {
  if (!children) return null;
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300">
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
