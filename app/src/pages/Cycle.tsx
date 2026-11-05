import { useMemo, useState } from "react";
import { CalendarHeart, ChevronLeft, ChevronRight, Droplet, History, Trash2 } from "lucide-react";
import { Card, Empty, ErrorBox, Page, Ring, Sheet, Spinner } from "../components/ui";
import JalaliDate from "../components/JalaliDate";
import { api } from "../lib/api";
import { num } from "../lib/format";
import { MONTHS, WEEKDAYS, addDays, diffDays, isoDay, isoToJalali, jalaliLabel, jalaliToIso, monthLength, weekdayIndex } from "../lib/jalali";
import { useApi } from "../lib/useApi";

type Entry = { id: number; start: string; end: string | null; flow: string; symptoms: string[]; note: string };
type Pred = {
  cycle_length: number; period_length: number; based_on: number; regular: boolean | null;
  last_start?: string; cycle_day?: number; next_start?: string; days_to_next?: number; ovulation?: string;
  fertile_start?: string; fertile_end?: string; phase?: "period" | "fertile" | "luteal" | "follicular"; late?: number; in_period?: boolean;
};
const SYMPTOMS: [string, string][] = [["cramps", "دل‌درد"], ["headache", "سردرد"], ["bloating", "نفخ"], ["back", "کمردرد"], ["breast", "حساسیت سینه"], ["fatigue", "خستگی"], ["mood", "تغییر خلق"], ["acne", "جوش"], ["nausea", "تهوع"]];
const FLOWS: [string, string][] = [["light", "کم"], ["medium", "متوسط"], ["heavy", "زیاد"]];
const PHASE: Record<string, string> = { period: "دوران پریود", fertile: "دوره باروری", luteal: "بعد از تخمک‌گذاری", follicular: "قبل از تخمک‌گذاری" };

export default function Cycle() {
  const today = isoDay(new Date());
  const data = useApi<{ entries: Entry[]; prediction: Pred }>("/api/cycle", { today });
  const [error, setError] = useState("");
  const [pick, setPick] = useState(false);
  const [pickDate, setPickDate] = useState(today);
  const [ty, tm] = isoToJalali(today);
  const [view, setView] = useState<[number, number]>([ty, tm]);
  const p = data.data?.prediction;
  const entries = data.data?.entries ?? [];
  const open = entries.find((e) => e.end === null && diffDays(today, e.start) < 10);
  const current = open ?? entries[0];

  const call = async (fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
      data.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const start = (iso: string) => call(() => api("/api/cycle", { body: { start: iso } }));
  const end = () => open && call(() => api(`/api/cycle/${open.id}`, { method: "PUT", body: { ...open, end: today } }));
  const toggleSymptom = (k: string) => current && call(() => api(`/api/cycle/${current.id}`, { method: "PUT", body: { ...current, symptoms: current.symptoms.includes(k) ? current.symptoms.filter((s) => s !== k) : [...current.symptoms, k] } }));
  const setFlow = (f: string) => current && call(() => api(`/api/cycle/${current.id}`, { method: "PUT", body: { ...current, flow: current.flow === f ? "" : f } }));
  const remove = (id: number) => confirm("این مورد حذف شود؟") && call(() => api(`/api/cycle/${id}`, { method: "DELETE" }));

  // Day marks for the calendar
  const marks = useMemo(() => {
    const m = new Map<string, string>();
    if (p?.fertile_start && p.fertile_end) for (let d = p.fertile_start; d <= p.fertile_end; d = addDays(d, 1)) m.set(d, "fertile");
    if (p?.ovulation) m.set(p.ovulation, "ovulation");
    if (p?.next_start) for (let c = 0; c < 3; c++) {
      const s = addDays(p.next_start, c * p.cycle_length);
      for (let i = 0; i < p.period_length; i++) m.set(addDays(s, i), "predicted");
    }
    for (const e of entries) {
      const last = e.end ?? (e === open ? today : addDays(e.start, (p?.period_length ?? 5) - 1));
      for (let d = e.start; d <= last; d = addDays(d, 1)) m.set(d, "period");
    }
    return m;
  }, [p, entries, open, today]);

  const [vy, vm] = view;
  const first = jalaliToIso(vy, vm, 1);
  const cells: (string | null)[] = [...Array(weekdayIndex(first)).fill(null), ...Array.from({ length: monthLength(vy, vm) }, (_, i) => jalaliToIso(vy, vm, i + 1))];
  const move = (n: number) => setView(([y, m]) => (m + n > 12 ? [y + 1, 1] : m + n < 1 ? [y - 1, 12] : [y, m + n]));
  const fa = (n: number) => new Intl.NumberFormat("fa-IR", { useGrouping: false }).format(n);

  return (
    <Page title="سلامت بانوان" subtitle="تقویم قاعدگی و پیش‌بینی" back>
      {data.loading && !data.data && <Spinner />}
      <ErrorBox error={error} />
      {p && (
        <Card className="cycle-hero">
          {p.last_start ? (
            <div className="row gap">
              <Ring value={p.cycle_day ?? 0} max={p.cycle_length} size={110} stroke={11} tone="var(--rose)">
                <div><div className="tiny muted">روز</div><b style={{ fontSize: "1.6rem" }}>{num(p.cycle_day)}</b></div>
              </Ring>
              <div className="grow col" style={{ gap: 4 }}>
                <b>{p.in_period ? "دوران پریود" : p.late ? `پریود ${num(p.late)} روز تأخیر دارد` : PHASE[p.phase ?? "follicular"]}</b>
                {!p.in_period && p.next_start && !p.late && <span className="small">پریود بعدی: <b>{p.days_to_next === 0 ? "امروز" : `${num(p.days_to_next)} روز دیگر`}</b> ({jalaliLabel(p.next_start, false)})</span>}
                {p.fertile_start && p.fertile_end && <span className="small muted">باروری: {jalaliLabel(p.fertile_start, false)} تا {jalaliLabel(p.fertile_end, false)}</span>}
                <span className="tiny muted">چرخه {num(p.cycle_length)} روزه · پریود {num(p.period_length)} روزه{p.based_on ? ` · بر پایه ${num(p.based_on)} چرخه` : " · پیش‌فرض"}</span>
              </div>
            </div>
          ) : <p>تاریخ شروع آخرین پریود را ثبت کنید تا پیش‌بینی شروع شود.</p>}
          <div className="row gap" style={{ marginTop: 12 }}>
            {open ? <button className="btn primary grow" onClick={end}>پریود تمام شد</button>
              : <button className="btn primary grow" onClick={() => start(today)}><Droplet size={18} /> پریود امروز شروع شد</button>}
            <button className="btn" onClick={() => { setPickDate(today); setPick(true); }}>تاریخ دیگر</button>
          </div>
          {p.regular === false && <p className="tiny muted" style={{ marginTop: 8 }}>چرخه‌های شما نامنظم است (اختلاف بیش از ۷ روز)؛ پیش‌بینی دقت کمتری دارد.</p>}
          {(p.late ?? 0) >= 7 && <div className="alert warn small" style={{ marginTop: 8 }}>تأخیر بیش از یک هفته است؛ در صورت نیاز آزمایش بارداری یا مشورت با پزشک را در نظر بگیرید.</div>}
        </Card>
      )}

      <Card title={`${MONTHS[vm - 1]} ${fa(vy)}`} icon={CalendarHeart} tone="rose" action={
        <div className="row gap-s">
          <button className="icon-btn" aria-label="ماه قبل" onClick={() => move(-1)}><ChevronRight size={18} /></button>
          <button className="icon-btn" aria-label="ماه بعد" onClick={() => move(1)}><ChevronLeft size={18} /></button>
        </div>}>
        <div className="cal">
          {WEEKDAYS.map((w) => <span key={w} className="cal-h">{w}</span>)}
          {cells.map((d, i) => d ? (
            <span key={d} className={`cal-d ${marks.get(d) ?? ""} ${d === today ? "today" : ""}`}>{fa(isoToJalali(d)[2])}</span>
          ) : <span key={`e${i}`} />)}
        </div>
        <div className="cal-legend tiny">
          <span><i className="period" />پریود</span><span><i className="predicted" />پیش‌بینی</span><span><i className="fertile" />باروری</span><span><i className="ovulation" />تخمک‌گذاری</span>
        </div>
      </Card>

      {current && (
        <Card title={`علائم (${jalaliLabel(current.start, false)})`}>
          <div className="row gap-s wrap">
            {FLOWS.map(([k, l]) => <button key={k} className={`chip ${current.flow === k ? "on" : ""}`} onClick={() => setFlow(k)}>خونریزی {l}</button>)}
          </div>
          <div className="row gap-s wrap" style={{ marginTop: 8 }}>
            {SYMPTOMS.map(([k, l]) => <button key={k} className={`chip ${current.symptoms.includes(k) ? "on" : ""}`} onClick={() => toggleSymptom(k)}>{l}</button>)}
          </div>
        </Card>
      )}

      <Card title="سابقه" icon={History} tone="slate">
        {entries.length === 0 && <Empty>هنوز ثبتی ندارید.</Empty>}
        <ul className="list">
          {entries.map((e) => (
            <li key={e.id}>
              <span className="grow">{jalaliLabel(e.start)}
                <div className="tiny muted">{e.end ? `${num(diffDays(e.end, e.start) + 1)} روز` : "ادامه دارد"}{e.symptoms.length ? ` · ${e.symptoms.map((s) => SYMPTOMS.find(([k]) => k === s)?.[1]).join("، ")}` : ""}</div>
              </span>
              <button className="btn ghost small" aria-label="حذف" onClick={() => remove(e.id)}><Trash2 size={16} /></button>
            </li>
          ))}
        </ul>
      </Card>
      <p className="disclaimer">پیش‌بینی‌ها تقریبی‌اند و برای پیشگیری از بارداری قابل اتکا نیستند. اطلاعات این بخش خصوصی است و برای همراهان شما نمایش داده نمی‌شود.</p>

      <Sheet open={pick} onClose={() => setPick(false)} title="تاریخ شروع پریود">
        <JalaliDate value={pickDate} onChange={setPickDate} maxIso={today} label="تاریخ شروع" />
        <button className="btn primary block" onClick={() => { setPick(false); start(pickDate); }}>ثبت</button>
      </Sheet>
    </Page>
  );
}
