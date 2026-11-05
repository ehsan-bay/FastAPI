import { useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, HeartPulse, Pill } from "lucide-react";
import { Card, Empty, Page, Ring, Spinner } from "../components/ui";
import { dateTime, num } from "../lib/format";
import { useApi } from "../lib/useApi";

type Detail = {
  name: string;
  alerts: { key: string; level: "warn" | "danger"; text: string }[];
  vitals: Record<string, { value: number; value2: number | null; level: "ok" | "warn" | "danger"; message: string; at: string }>;
  meds: { id: number; name: string; dose: string; times: string[]; taken: number; planned: number; missed: number; refill: { days_left: number; low: boolean } | null }[];
  adherence: { percent: number | null; taken: number; expected: number };
};
const NAMES: Record<string, [string, string]> = { bp: ["فشار خون", "mmHg"], glucose: ["قند خون", "mg/dL"], hr: ["ضربان", "bpm"], spo2: ["اکسیژن", "٪"], weight: ["وزن", "kg"] };

export default function CarePatient() {
  const { id } = useParams();
  const { data, error, loading } = useApi<Detail>(`/api/care/patient/${id}`, { tz_offset: new Date().getTimezoneOffset() });
  return (
    <Page title={data?.name ?? "وضعیت"} subtitle="وضعیت امروز" back>
      {loading && !data && <Spinner />}
      {error && <div className="alert danger">{error}</div>}
      {data && (
        <>
          {data.alerts.length === 0 ? (
            <div className="alert ok"><CheckCircle2 size={18} style={{ flex: "none", marginTop: 3 }} /><span>مورد نگران‌کننده‌ای نیست.</span></div>
          ) : data.alerts.map((a) => (
            <div key={a.key} className={`alert ${a.level}`}><AlertTriangle size={18} style={{ flex: "none", marginTop: 3 }} /><span>{a.text}</span></div>
          ))}
          <Card title="داروهای امروز" icon={Pill} tone="rose">
            {data.adherence.percent !== null && (
              <div className="row gap" style={{ marginBottom: 8 }}>
                <Ring value={data.adherence.percent} max={100} size={70} stroke={8}><b className="small">{num(data.adherence.percent)}٪</b></Ring>
                <span className="small muted">مصرف به‌موقع در ۷ روز اخیر</span>
              </div>
            )}
            {data.meds.length === 0 && <Empty>دارویی ثبت نشده.</Empty>}
            <ul className="list">
              {data.meds.map((m) => (
                <li key={m.id}>
                  <span className="grow"><b>{m.name}</b> <span className="muted small">{m.dose}</span>
                    <div className="tiny muted ltr" style={{ textAlign: "right" }}>{m.times.join(" · ")}</div>
                  </span>
                  {m.missed > 0 ? <span className="badge danger">{num(m.missed)} نوبت جا مانده</span> : <span className="badge ok">{num(m.taken)}/{num(m.planned)}</span>}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="آخرین اندازه‌گیری‌ها" icon={HeartPulse} tone="red">
            {Object.keys(data.vitals).length === 0 && <Empty>در ۳۰ روز اخیر ثبتی نیست.</Empty>}
            <ul className="list">
              {Object.entries(data.vitals).map(([k, v]) => (
                <li key={k}>
                  <span className="grow"><b>{NAMES[k]?.[0] ?? k}</b><div className="tiny muted">{dateTime(v.at)}</div></span>
                  <span className="ltr">{num(v.value)}{v.value2 ? `/${num(v.value2)}` : ""} <small className="muted">{NAMES[k]?.[1]}</small></span>
                  <span className={`badge ${v.level}`}>{v.level === "ok" ? "طبیعی" : v.level === "warn" ? "توجه" : "خطر"}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </Page>
  );
}
