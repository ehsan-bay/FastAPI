import { useRef, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";

export function Page({ title, back, children, action, wide }: { title: string; back?: boolean; children: ReactNode; action?: ReactNode; wide?: boolean }) {
  const nav = useNavigate();
  return (
    <div className={`page ${wide ? "wide" : ""}`}>
      <header className="topbar">
        {back && (
          <button className="icon-btn" aria-label="بازگشت" onClick={() => nav(-1)}>
            →
          </button>
        )}
        <h1>{title}</h1>
        <div className="spacer" />
        {action}
      </header>
      <main className="content">{children}</main>
    </div>
  );
}

export const Card = ({ children, className = "", title }: { children: ReactNode; className?: string; title?: ReactNode }) => (
  <section className={`card ${className}`}>
    {title && <h2 className="card-title">{title}</h2>}
    {children}
  </section>
);

export const Spinner = ({ text = "در حال بارگذاری…" }: { text?: string }) => (
  <div className="spinner-wrap" role="status">
    <span className="spinner" />
    <span>{text}</span>
  </div>
);

export const ErrorBox = ({ error }: { error?: string }) => (error ? <div className="alert danger">{error}</div> : null);

export const Disclaimer = ({ children }: { children?: ReactNode }) => (
  <p className="disclaimer">⚕️ {children ?? "این نتیجه توسط هوش مصنوعی تولید شده و جایگزین نظر پزشک نیست."}</p>
);

export function ImagePicker({ onPick, label = "انتخاب یا گرفتن عکس", disabled }: { onPick: (f: File) => void; label?: string; disabled?: boolean }) {
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
        📷 {label}
      </button>
      <button className="btn grow" disabled={disabled} onClick={() => gal.current?.click()}>
        🖼️ از گالری
      </button>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={handle} />
      <input ref={gal} type="file" accept="image/*" hidden onChange={handle} />
    </div>
  );
}

export const Tile = ({ to, icon, title, sub }: { to: string; icon: string; title: string; sub?: ReactNode }) => (
  <Link to={to} className="tile">
    <span className="tile-icon">{icon}</span>
    <span className="tile-title">{title}</span>
    {sub !== undefined && <span className="tile-sub">{sub}</span>}
  </Link>
);

export const Bar = ({ value, max, tone }: { value: number; max: number; tone?: "warn" | "danger" | "ok" }) => (
  <div className="bar">
    <div className={`bar-fill ${tone ?? ""}`} style={{ width: `${Math.min(100, (100 * value) / Math.max(1, max))}%` }} />
  </div>
);

export const Tabs = <T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) => (
  <div className="tabs" role="tablist">
    {items.map(([k, label]) => (
      <button key={k} role="tab" aria-selected={value === k} className={value === k ? "active" : ""} onClick={() => onChange(k)}>
        {label}
      </button>
    ))}
  </div>
);

export const Empty = ({ children }: { children: ReactNode }) => <p className="empty">{children}</p>;
