import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Camera, ChevronLeft, ChevronRight, Image as ImageIcon, Info, Loader2, Square, Volume2, type LucideIcon } from "lucide-react";
import { speak, stopSpeaking } from "../lib/speech";

export type Tone = "teal" | "blue" | "violet" | "rose" | "amber" | "green" | "orange" | "slate" | "red" | "indigo";

export function Page({ title, subtitle, back, children, action, wide }: { title: ReactNode; subtitle?: ReactNode; back?: boolean; children: ReactNode; action?: ReactNode; wide?: boolean }) {
  const nav = useNavigate();
  return (
    <div className={`page ${wide ? "wide" : ""}`}>
      <header className="topbar">
        {back && (
          <button className="icon-btn" aria-label="بازگشت" onClick={() => (window.history.length > 1 ? nav(-1) : nav("/"))}>
            <ChevronRight size={22} />
          </button>
        )}
        <div className="topbar-text">
          <h1>{title}</h1>
          {subtitle && <p className="topbar-sub">{subtitle}</p>}
        </div>
        <div className="spacer" />
        {action}
      </header>
      <main className="content">{children}</main>
    </div>
  );
}

export const Card = ({ children, className = "", title, icon: Icon, tone = "teal", action }: { children: ReactNode; className?: string; title?: ReactNode; icon?: LucideIcon; tone?: Tone; action?: ReactNode }) => (
  <section className={`card ${className}`}>
    {(title || action) && (
      <div className="card-head">
        {Icon && <IconChip icon={Icon} tone={tone} size="sm" />}
        {title && <h2 className="card-title">{title}</h2>}
        <div className="spacer" />
        {action}
      </div>
    )}
    {children}
  </section>
);

export const IconChip = ({ icon: Icon, tone = "teal", size = "md" }: { icon: LucideIcon; tone?: Tone; size?: "sm" | "md" | "lg" }) => (
  <span className={`chip-icon ${size} tone-${tone}`} aria-hidden>
    <Icon size={size === "sm" ? 16 : size === "lg" ? 28 : 22} strokeWidth={2} />
  </span>
);

export const Spinner = ({ text = "در حال بارگذاری…" }: { text?: string }) => (
  <div className="spinner-wrap" role="status">
    <span className="spinner" />
    <span>{text}</span>
  </div>
);

export const Skeleton = ({ h = 16, w = "100%", r = 8 }: { h?: number; w?: number | string; r?: number }) => (
  <span className="skeleton" style={{ height: h, width: w, borderRadius: r }} />
);

export const ErrorBox = ({ error }: { error?: string }) => (error ? <div className="alert danger" role="alert">{error}</div> : null);

export const Disclaimer = ({ children }: { children?: ReactNode }) => (
  <p className="disclaimer">
    <Info size={14} />
    <span>{children ?? "این نتیجه توسط هوش مصنوعی تولید شده و جایگزین نظر پزشک نیست."}</span>
  </p>
);

export function ImagePicker({ onPick, label = "گرفتن عکس", disabled }: { onPick: (f: File) => void; label?: string; disabled?: boolean }) {
  const cam = useRef<HTMLInputElement>(null);
  const gal = useRef<HTMLInputElement>(null);
  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onPick(f);
    e.target.value = "";
  };
  return (
    <div className="row gap">
      <button className="btn primary grow" disabled={disabled} onClick={() => cam.current?.click()}>
        <Camera size={18} /> {label}
      </button>
      <button className="btn grow" disabled={disabled} onClick={() => gal.current?.click()}>
        <ImageIcon size={18} /> از گالری
      </button>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={handle} />
      <input ref={gal} type="file" accept="image/*" hidden onChange={handle} />
    </div>
  );
}

export const Tile = ({ to, icon, tone = "teal", title, sub }: { to: string; icon: LucideIcon; tone?: Tone; title: string; sub?: ReactNode }) => (
  <Link to={to} className="tile">
    <IconChip icon={icon} tone={tone} />
    <span className="tile-title">{title}</span>
    {sub !== undefined && <span className="tile-sub">{sub}</span>}
  </Link>
);

export const ListLink = ({ to, icon, tone = "teal", title, sub, end }: { to: string; icon: LucideIcon; tone?: Tone; title: string; sub?: ReactNode; end?: ReactNode }) => (
  <Link to={to} className="list-link">
    <IconChip icon={icon} tone={tone} />
    <span className="grow">
      <span className="list-link-title">{title}</span>
      {sub && <span className="list-link-sub">{sub}</span>}
    </span>
    {end}
    <ChevronLeft size={18} className="muted" />
  </Link>
);

export const Bar = ({ value, max, tone }: { value: number; max: number; tone?: "warn" | "danger" | "ok" }) => (
  <div className="bar" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemax={max}>
    <div className={`bar-fill ${tone ?? ""}`} style={{ width: `${Math.min(100, (100 * value) / Math.max(1, max))}%` }} />
  </div>
);

export const Ring = ({ value, max, size = 132, stroke = 12, children, tone = "var(--primary)", track = "var(--track)" }: { value: number; max: number; size?: number; stroke?: number; children?: ReactNode; tone?: string; track?: string }) => {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.min(1, value / Math.max(1, max));
  return (
    <div className="ring2" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${c * p} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: "stroke-dasharray .6s ease" }} />
      </svg>
      <div className="ring2-inner">{children}</div>
    </div>
  );
};

export const Tabs = <T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) => (
  <div className="tabs" role="tablist">
    {items.map(([k, label]) => (
      <button key={k} role="tab" aria-selected={value === k} className={value === k ? "active" : ""} onClick={() => onChange(k)}>
        {label}
      </button>
    ))}
  </div>
);

export const Empty = ({ children, icon: Icon }: { children: ReactNode; icon?: LucideIcon }) => (
  <div className="empty">
    {Icon && <Icon size={28} strokeWidth={1.5} />}
    <p>{children}</p>
  </div>
);

export const SectionTitle = ({ children, action }: { children: ReactNode; action?: ReactNode }) => (
  <div className="section-title">
    <h2>{children}</h2>
    {action}
  </div>
);

/** Reads text aloud with the Persian voice. Big and clear on purpose (older users). */
export function SpeakButton({ text, label = "بخوان", compact }: { text: string | (() => string); label?: string; compact?: boolean }) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const [err, setErr] = useState("");
  useEffect(() => {
    return () => {
      stopSpeaking();
    };
  }, []);
  const click = async () => {
    if (state !== "idle") {
      stopSpeaking();
      setState("idle");
      return;
    }
    setErr("");
    setState("loading");
    try {
      await speak(typeof text === "function" ? text() : text, () => setState("idle"));
      setState((s) => (s === "loading" ? "playing" : s));
    } catch (e) {
      setState("idle");
      setErr((e as Error).message || "پخش نشد");
    }
  };
  const Icon = state === "loading" ? Loader2 : state === "playing" ? Square : Volume2;
  return (
    <button type="button" className={`btn speak ${compact ? "small" : ""} ${state !== "idle" ? "on" : ""}`} onClick={click}
      aria-label={state === "playing" ? "توقف خواندن" : "خواندن با صدا"} title={err || undefined}>
      <Icon size={compact ? 16 : 18} className={state === "loading" ? "spin" : undefined} />
      {!compact && <span>{state === "playing" ? "توقف" : err ? "دوباره" : label}</span>}
    </button>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        {title && <h2 className="sheet-title">{title}</h2>}
        {children}
      </div>
    </div>
  );
}
