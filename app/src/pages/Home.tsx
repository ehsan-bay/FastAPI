import { Link } from "react-router-dom";
import {
  Activity, AlertTriangle, Bone, Brain, CalendarHeart, Check, ChevronLeft, Dumbbell, FileText, FlaskConical, HeartPulse,
  Moon, Package, Pill, QrCode, ScanFace, Settings as Gear, Shield, Users, Utensils, Wallet,
} from "lucide-react";
import { Card, IconChip, Page, SectionTitle, Skeleton, SpeakButton } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { num, parseDate, toman } from "../lib/format";
import { useApi } from "../lib/useApi";
import { usePrefs } from "../lib/prefs";
import type { CareAlert } from "../lib/careAlerts";

type Vital = { value: number; value2: number | null; level: string; message: string; at?: string };
type Dash = {
  nutrition: { kcal: number; protein: number; carbs: number; fat: number; goal: number; count: number };
  vitals: Record<string, Vital>;
  sleep: { score: number; hours: number } | null;
  mood: { entries: number; avg: number | null };
  workouts: { count: number; reps: number; kcal: number };
  meds: { percent: number | null };
  refill?: { id: number; name: string; days_left: number }[];
};
type Med = { id: number; name: string; dose: string; times: string[]; active: boolean; today: { status: string; at: string }[] };

const MOOD_FA = ["", "خیلی بد", "بد", "معمولی", "خوب", "عالی"];
const todayLabel = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
const faTime = (t: string) => t.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[+d]);

function summary(d: Dash, name?: string): string {
  const parts = [`سلام${name ? " " + name : ""}. خلاصه امروز شما:`];
  parts.push(`امروز ${Math.round(d.nutrition.kcal)} کیلوکالری از هدف ${d.nutrition.goal} خورده‌اید.`);
  const bp = d.vitals.bp;
  if (bp) parts.push(`آخرین فشار خون ${bp.value} روی ${bp.value2} بوده است. ${bp.message}`);
  const g = d.vitals.glucose;
  if (g) parts.push(`آخرین قند خون ${g.value} بوده است.`);
  if (d.sleep) parts.push(`دیشب ${d.sleep.hours} ساعت خوابیده‌اید.`);
  if (d.meds.percent !== null) parts.push(`در این هفته ${d.meds.percent} درصد داروها را به‌موقع مصرف کرده‌اید.`);
  return parts.join(" ");
}

/** Doses of today in time order, with how many of them are already logged. */
function doses(meds: Med[]) {
  const out: { med: Med; time: string; done: boolean }[] = [];
  for (const m of meds.filter((x) => x.active)) {
    const logged = m.today.length;
    m.times.forEach((t, i) => out.push({ med: m, time: t, done: i < logged }));
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

const isToday = (s?: string) => !!s && parseDate(s).toDateString() === new Date().toDateString();

export default function Home() {
  const { user } = useAuth();
  const prefs = usePrefs();
  const tz = new Date().getTimezoneOffset();
  const dash = useApi<Dash>("/api/dashboard", { tz_offset: tz });
  const meds = useApi<Med[]>("/api/meds");
  const care = useApi<CareAlert[]>("/api/care/alerts", { tz_offset: tz });
  const data = dash.data;
  const hour = new Date().getHours();
  const hello = hour < 5 ? "شب بخیر" : hour < 12 ? "صبح بخیر" : hour < 18 ? "روز بخیر" : "عصر بخیر";
  const danger = data && Object.values(data.vitals).find((v) => v.level === "danger");
  const careBy = (care.data ?? []).reduce<Record<string, CareAlert[]>>((acc, a) => ({ ...acc, [a.patient]: [...(acc[a.patient] ?? []), a] }), {});
  const n = data?.nutrition;
  const list = doses(meds.data ?? []);
  const nowHm = `${String(hour).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`;
  const next = list.find((d) => !d.done);
  const dosesLeft = list.filter((d) => !d.done).length;

  const take = async (id: number) => {
    await api(`/api/meds/${id}/log`, { body: { status: "taken" } });
    meds.reload();
    dash.reload();
  };

  return (
    <Page
      title={
        <span className="hello">
          <img src="/logo.svg" alt="" className="brand-logo" />
          <span>
            <span className="tiny muted" style={{ display: "block", fontWeight: 600 }}>{todayLabel}</span>
            {hello}{user?.name ? `، ${user.name}` : ""}
          </span>
        </span>
      }
      action={<Link to="/settings" className="icon-btn" aria-label="تنظیمات"><Gear size={20} /></Link>}
    >
      {dash.error && <div className="alert danger">{dash.error}</div>}

      {danger && (
        <div className="alert danger" role="alert">
          <AlertTriangle size={20} style={{ flex: "none", marginTop: 3 }} />
          <span>{danger.message}</span>
        </div>
      )}
      {Object.entries(careBy).map(([who, items]) => (
        <Link key={who} to={`/family/${items[0].patient_id}`} className={`alert ${items.some((a) => a.level === "danger") ? "danger" : "warn"}`}>
          <Users size={20} style={{ flex: "none", marginTop: 3 }} />
          <span className="grow"><b>{who}:</b> {items[0].text}{items.length > 1 ? ` (و ${num(items.length - 1)} مورد دیگر)` : ""}</span>
          <ChevronLeft size={18} style={{ flex: "none", marginTop: 4 }} />
        </Link>
      ))}
      {data?.refill?.map((r) => (
        <Link key={r.id} to="/meds" className="alert warn">
          <Package size={20} style={{ flex: "none", marginTop: 3 }} />
          <span className="grow">داروی {r.name} {r.days_left <= 0 ? "تمام شده است" : `حدود ${num(r.days_left)} روز دیگر تمام می‌شود`}؛ تهیه کنید.</span>
        </Link>
      ))}

      {/* Today: what to do now */}
      <Card className="accent">
        <div className="today-head">
          <b>امروز</b>
          {data && <SpeakButton compact text={() => summary(data, user?.name)} />}
        </div>
        <div style={{ marginTop: 6 }}>
          {next ? (
            <div className="task">
              <IconChip icon={Pill} tone="rose" size="sm" />
              <div className="t-main">
                <div className="t-title">{next.med.name} {next.med.dose && <span className="small muted">{next.med.dose}</span>}</div>
                <div className="t-sub">نوبت ساعت <span className="ltr">{faTime(next.time)}</span>{next.time < nowHm ? " · گذشته" : ""}{dosesLeft > 1 ? ` · ${num(dosesLeft - 1)} نوبت دیگر امروز` : ""}</div>
              </div>
              <button className="btn small primary" onClick={() => take(next.med.id)}><Check size={16} /> خوردم</button>
            </div>
          ) : (
            <div className="task done">
              <IconChip icon={Pill} tone="rose" size="sm" />
              <div className="t-main">
                <div className="t-title">{list.length ? "داروهای امروز مصرف شد" : "دارویی ثبت نشده"}</div>
                {!list.length && <div className="t-sub"><Link to="/meds">افزودن دارو و یادآور</Link></div>}
              </div>
            </div>
          )}
          {data && (
            <Link to="/vitals" className={`task ${isToday(data.vitals.bp?.at) ? "done" : ""}`} style={{ color: "inherit" }}>
              <IconChip icon={HeartPulse} tone="red" size="sm" />
              <div className="t-main">
                <div className="t-title">اندازه‌گیری فشار خون</div>
                <div className="t-sub">{data.vitals.bp ? <>آخرین: <span className="ltr">{num(data.vitals.bp.value)}/{num(data.vitals.bp.value2)}</span> · {data.vitals.bp.message}</> : "هنوز ثبت نشده"}</div>
              </div>
              <ChevronLeft size={18} className="muted" />
            </Link>
          )}
          {n && (
            <Link to="/food" className="task" style={{ color: "inherit" }}>
              <IconChip icon={Utensils} tone="orange" size="sm" />
              <div className="t-main">
                <div className="t-title">وعده‌های غذایی</div>
                <div className="t-sub">{num(n.count)} وعده · {num(Math.round(n.kcal))} از {num(n.goal)} کیلوکالری</div>
                <div className="bar" style={{ marginTop: 6 }}><div className={`bar-fill ${n.kcal > n.goal ? "warn" : ""}`} style={{ width: `${Math.min(100, (n.kcal / Math.max(1, n.goal)) * 100)}%` }} /></div>
              </div>
              <ChevronLeft size={18} className="muted" />
            </Link>
          )}
        </div>
      </Card>

      <SectionTitle>وضعیت من</SectionTitle>
      {dash.loading && !data ? (
        <div className="stat-row">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={70} r={14} />)}</div>
      ) : data && (
        <div className="stat-row">
          <Link to="/vitals" className="stat">
            <span className="stat-label"><HeartPulse size={14} color="var(--red)" />قند خون</span>
            <span className="stat-value">{data.vitals.glucose ? <>{num(data.vitals.glucose.value)}<small>mg/dL</small></> : <Empty2 />}</span>
          </Link>
          <Link to="/sleep" className="stat">
            <span className="stat-label"><Moon size={14} color="var(--indigo)" />خواب</span>
            <span className="stat-value">{data.sleep ? <>{num(data.sleep.hours)}<small>ساعت</small></> : <Empty2 />}</span>
          </Link>
          <Link to="/mind" className="stat">
            <span className="stat-label"><Brain size={14} color="var(--violet)" />حال هفته</span>
            <span className="stat-value">{data.mood.avg ? MOOD_FA[Math.round(data.mood.avg)] : <Empty2 />}</span>
          </Link>
          <Link to="/meds" className="stat">
            <span className="stat-label"><Pill size={14} color="var(--rose)" />مصرف دارو</span>
            <span className="stat-value">{data.meds.percent !== null ? <>{num(data.meds.percent)}<small>٪</small></> : <Empty2 />}</span>
          </Link>
        </div>
      )}

      <SectionTitle>ابزارها</SectionTitle>
      <div className="tool-grid">
        <Link to="/food"><IconChip icon={Utensils} tone="orange" />تشخیص غذا</Link>
        <Link to="/coach"><IconChip icon={Dumbbell} tone="blue" />مربی ورزش</Link>
        <Link to="/heart"><IconChip icon={Activity} tone="red" />ضربان قلب</Link>
        <Link to="/xray"><IconChip icon={Bone} tone="slate" />عکس قفسه سینه</Link>
        <Link to="/skin"><IconChip icon={ScanFace} tone="amber" />بررسی پوست</Link>
        <Link to="/lab"><IconChip icon={FlaskConical} tone="violet" />برگه آزمایش</Link>
        <Link to="/sleep"><IconChip icon={Moon} tone="indigo" />پایش خواب</Link>
        <Link to="/mind"><IconChip icon={Brain} tone="teal" />سلامت روان</Link>
        {prefs.cycle && <Link to="/cycle"><IconChip icon={CalendarHeart} tone="rose" />سلامت بانوان</Link>}
      </div>

      <SectionTitle>خانواده و پزشک</SectionTitle>
      <Card className="list-card">
        <Link to="/family" className="list-link"><IconChip icon={Users} tone="blue" /><span className="grow"><span className="list-link-title">خانواده و همراه</span><span className="list-link-sub">مراقبت از عزیزان، از راه دور</span></span><ChevronLeft size={18} className="muted" /></Link>
        <Link to="/report" className="list-link"><IconChip icon={FileText} tone="indigo" /><span className="grow"><span className="list-link-title">گزارش برای پزشک</span><span className="list-link-sub">چاپ یا PDF فشار، قند و داروها</span></span><ChevronLeft size={18} className="muted" /></Link>
        <Link to="/scan" className="list-link"><IconChip icon={QrCode} tone="green" /><span className="grow"><span className="list-link-title">پرداخت ویزیت</span><span className="list-link-sub">اسکن QR مطب</span></span><ChevronLeft size={18} className="muted" /></Link>
        <Link to="/wallet" className="list-link"><IconChip icon={Wallet} tone="slate" /><span className="grow"><span className="list-link-title">کیف پول</span><span className="list-link-sub">موجودی: {toman(user?.wallet_balance)}</span></span><ChevronLeft size={18} className="muted" /></Link>
        {user?.is_admin && <Link to="/admin" className="list-link"><IconChip icon={Shield} tone="slate" /><span className="grow"><span className="list-link-title">پنل مدیریت</span></span><ChevronLeft size={18} className="muted" /></Link>}
      </Card>
      <p className="disclaimer center" style={{ justifyContent: "center" }}>سلامت‌یار جایگزین پزشک نیست؛ در شرایط اورژانسی با ۱۱۵ تماس بگیرید.</p>
    </Page>
  );
}

const Empty2 = () => <span className="small muted" style={{ fontWeight: 600 }}>ثبت کنید</span>;
