import { useState } from "react";
import { Link } from "react-router-dom";
import { Camera, Droplets, HeartPulse, History, Mic, Trash2, TrendingUp } from "lucide-react";
import { Bar, Card, Empty, ErrorBox, Page, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { dateTime, num, toLatinDigits } from "../lib/format";
import { useApi } from "../lib/useApi";

type Kind = "bp" | "glucose" | "weight" | "hr" | "spo2";
type Vital = { id: number; kind: Kind; value: number; value2: number | null; created_at: string; level: "ok" | "warn" | "danger"; message: string };
type Insight = { kind: Kind; label: string; count: number; mean?: number; message: string; anomalies: { value: number }[] };

const KINDS: Record<Kind, { fa: string; unit: string; icon?: string }> = {
  bp: { fa: "فشار خون", unit: "mmHg", icon: "🩸" },
  glucose: { fa: "قند خون", unit: "mg/dL", icon: "🍬" },
  weight: { fa: "وزن", unit: "kg", icon: "⚖️" },
  hr: { fa: "ضربان قلب", unit: "bpm", icon: "💓" },
  spo2: { fa: "اکسیژن خون", unit: "%", icon: "🫁" },
};

export default function Vitals() {
  const [kind, setKind] = useState<Kind>("bp");
  const list = useApi<Vital[]>("/api/vitals", { kind, days: 90 });
  const insights = useApi<Insight[]>("/api/vitals/insights");
  const [v1, setV1] = useState("");
  const [v2, setV2] = useState("");
  const [error, setError] = useState("");
  const [last, setLast] = useState<Vital | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const body: Record<string, unknown> = { kind, value: +toLatinDigits(v1) };
      if (kind === "bp") body.value2 = +toLatinDigits(v2);
      setLast(await api<Vital>("/api/vitals", { body }));
      setV1("");
      setV2("");
      list.reload();
      insights.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async (id: number) => {
    await api(`/api/vitals/${id}`, { method: "DELETE" });
    list.reload();
    insights.reload();
  };

  const ins = insights.data?.find((i) => i.kind === kind);
  return (
    <Page title="علائم حیاتی" subtitle="فشار، قند، وزن، ضربان، اکسیژن" back action={<Link to="/voice" className="icon-btn" aria-label="ثبت صوتی"><Mic size={20} /></Link>}>
      <div className="row gap wrap">
        {(Object.keys(KINDS) as Kind[]).map((k) => (
          <button key={k} className={`btn small ${kind === k ? "primary" : ""}`} onClick={() => { setKind(k); setLast(null); }}>
            {KINDS[k].fa}
          </button>
        ))}
      </div>
      <Card title={`ثبت ${KINDS[kind].fa}`}>
        <form className="row gap" onSubmit={save}>
          <input inputMode="decimal" required placeholder={kind === "bp" ? "بالا (۱۲۰)" : KINDS[kind].unit} value={v1} onChange={(e) => setV1(e.target.value)} />
          {kind === "bp" && <input inputMode="decimal" required placeholder="پایین (۸۰)" value={v2} onChange={(e) => setV2(e.target.value)} />}
          <button className="btn primary">ثبت</button>
        </form>
        <ErrorBox error={error} />
        {last && <div className={`alert ${last.level === "ok" ? "ok" : last.level}`} style={{ marginTop: 10 }}>{last.message}</div>}
      </Card>
      {kind === "glucose" && <A1cCard key={list.data?.length ?? 0} />}
      {kind === "hr" && (
        <Link to="/heart" className="card pay-banner" style={{ background: "linear-gradient(135deg,#b91c1c,#ef4444)" }}>
          <HeartPulse size={28} />
          <span className="grow"><b>اندازه‌گیری ضربان با دوربین</b><div className="small">انگشت را روی دوربین پشت گوشی بگذارید</div></span>
          <Camera size={20} />
        </Link>
      )}
      <Card title="تحلیل روند" icon={TrendingUp} tone="violet">
        {ins ? (
          <>
            <p style={{ margin: 0 }}>{ins.message}</p>
            {ins.mean !== undefined && <p className="muted small" style={{ margin: 0 }}>میانگین: {num(ins.mean)} {KINDS[kind].unit} · {num(ins.count)} اندازه‌گیری</p>}
          </>
        ) : <Empty>داده کافی نیست.</Empty>}
        <Chart rows={list.data ?? []} kind={kind} />
      </Card>
      <Card title="سابقه" icon={History} tone="slate">
        {list.loading && <Spinner />}
        {list.data?.length === 0 && <Empty>موردی ثبت نشده.</Empty>}
        <ul className="list">
          {list.data?.map((v) => (
            <li key={v.id}>
              <span className="grow">
                <span className="ltr">{num(v.value)}{v.value2 ? `/${num(v.value2)}` : ""}</span> <span className="muted small">{KINDS[v.kind].unit}</span>
                <div className="muted small">{dateTime(v.created_at)}</div>
              </span>
              <span className={`badge ${v.level}`}>{v.level === "ok" ? "طبیعی" : v.level === "warn" ? "توجه" : "خطر"}</span>
              <button className="btn ghost small" aria-label="حذف" onClick={() => remove(v.id)}><Trash2 size={16} /></button>
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}

function Chart({ rows, kind }: { rows: Vital[]; kind: Kind }) {
  const pts = [...rows].reverse().slice(-30);
  if (pts.length < 2) return null;
  const vals = pts.flatMap((p) => (p.value2 ? [p.value, p.value2] : [p.value]));
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const w = 320, h = 120;
  const x = (i: number) => 10 + (i / (pts.length - 1)) * (w - 20);
  const y = (v: number) => h - 12 - ((v - lo) / span) * (h - 24);
  const line = (get: (p: Vital) => number | null, color: string) => (
    <polyline fill="none" stroke={color} strokeWidth="2.5" points={pts.map((p, i) => `${x(i)},${y(get(p) ?? 0)}`).join(" ")} />
  );
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 130, direction: "ltr", marginTop: 8 }} role="img" aria-label="نمودار">
      {line((p) => p.value, "var(--primary)")}
      {kind === "bp" && line((p) => p.value2, "var(--warn)")}
      {pts.map((p, i) => <circle key={p.id} cx={x(i)} cy={y(p.value)} r="3.5" fill={p.level === "danger" ? "var(--danger)" : p.level === "warn" ? "var(--warn)" : "var(--primary)"} />)}
      <text x="4" y="12" fontSize="10" fill="var(--muted)">{Math.round(hi)}</text>
      <text x="4" y={h - 2} fontSize="10" fill="var(--muted)">{Math.round(lo)}</text>
    </svg>
  );
}

type A1c = { available: boolean; readings: number; needed: number; days: number; min_days?: number; mean_glucose?: number; value?: number; level?: "ok" | "warn" | "danger"; message?: string };

function A1cCard() {
  const { data } = useApi<A1c>("/api/vitals/a1c", { days: 90 });
  if (!data) return null;
  return (
    <Card title="HbA1c تخمینی (۳ ماه)" icon={Droplets} tone="amber">
      {data.available ? (
        <>
          <div className="row gap" style={{ alignItems: "baseline" }}>
            <span className="big">{num(data.value)}٪</span>
            <span className={`badge ${data.level}`}>{data.message}</span>
          </div>
          <p className="small muted">بر پایه {num(data.readings)} اندازه‌گیری در {num(data.days)} روز · میانگین قند {num(data.mean_glucose)} mg/dL</p>
        </>
      ) : (
        <>
          <p className="small">برای تخمین، دست‌کم {num(data.needed)} اندازه‌گیری در {num(data.min_days ?? 7)} روز لازم است.</p>
          <Bar value={Math.min(data.readings / data.needed, data.days / (data.min_days ?? 7))} max={1} />
          <p className="tiny muted" style={{ marginTop: 4 }}>{num(Math.min(data.readings, data.needed))} از {num(data.needed)} اندازه‌گیری · {num(Math.min(data.days, data.min_days ?? 7))} از {num(data.min_days ?? 7)} روز</p>
        </>
      )}
      <p className="disclaimer">تخمین از قندهای خانگی است و جای آزمایش HbA1c را نمی‌گیرد.</p>
    </Card>
  );
}
