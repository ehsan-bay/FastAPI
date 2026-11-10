import { Link } from "react-router-dom";
import {
  Activity, AlertTriangle, Brain, Camera, ChevronLeft, Dumbbell, FlaskConical, HeartPulse, Mic, Moon, Pill, QrCode,
  ScanFace, Settings as Gear, Shield, Utensils, Wallet, Bone, Users, FileText, CalendarHeart, Package,
} from "lucide-react";
import { Card, IconChip, Page, Ring, SectionTitle, Skeleton, SpeakButton, Tile } from "../components/ui";
import { useAuth } from "../lib/auth";
import { num, toman } from "../lib/format";
import { useApi } from "../lib/useApi";
import { usePrefs } from "../lib/prefs";
import type { CareAlert } from "../lib/careAlerts";

type Dash = {
  nutrition: { kcal: number; protein: number; carbs: number; fat: number; goal: number; count: number };
  vitals: Record<string, { value: number; value2: number | null; level: string; message: string }>;
  sleep: { score: number; hours: number } | null;
  mood: { entries: number; avg: number | null };
  workouts: { count: number; reps: number; kcal: number };
  meds: { percent: number | null };
  refill?: { id: number; name: string; days_left: number }[];
};

const MOOD_FA = ["", "خیلی بد", "بد", "معمولی", "خوب", "عالی"];
const today = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

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

export default function Home() {
  const { user } = useAuth();
  const { data, loading, error } = useApi<Dash>("/api/dashboard", { tz_offset: new Date().getTimezoneOffset() });
  const hour = new Date().getHours();
  const hello = hour < 5 ? "شب بخیر" : hour < 12 ? "صبح بخیر" : hour < 18 ? "روز بخیر" : "عصر بخیر";
  const initial = (user?.name || user?.email || "?").trim().charAt(0);
  const danger = data && Object.values(data.vitals).find((v) => v.level === "danger");
  const prefs = usePrefs();
  const care = useApi<CareAlert[]>("/api/care/alerts", { tz_offset: new Date().getTimezoneOffset() });
  const careBy = (care.data ?? []).reduce<Record<string, CareAlert[]>>((acc, a) => ({ ...acc, [a.patient]: [...(acc[a.patient] ?? []), a] }), {});
  const n = data?.nutrition;

  return (
    <Page
      title={
        <span className="hello">
          <span className="avatar" aria-hidden>{initial}</span>
          <span>
            <span className="tiny muted" style={{ display: "block", fontWeight: 600 }}>{today}</span>
            {hello}{user?.name ? `، ${user.name}` : ""}
          </span>
        </span>
      }
      action={<Link to="/settings" className="icon-btn" aria-label="تنظیمات"><Gear size={20} /></Link>}
    >
      {error && <div className="alert danger">{error}</div>}

      {danger && (
        <div className="alert danger" role="alert">
          <AlertTriangle size={20} style={{ flex: "none", marginTop: 3 }} />
          <span>{danger.message}</span>
        </div>
      )}

      {Object.entries(careBy).map(([who, list]) => (
        <Link key={who} to={`/family/${list[0].patient_id}`} className={`alert ${list.some((a) => a.level === "danger") ? "danger" : "warn"}`}>
          <Users size={20} style={{ flex: "none", marginTop: 3 }} />
          <span className="grow"><b>{who}:</b> {list[0].text}{list.length > 1 ? ` (و ${num(list.length - 1)} مورد دیگر)` : ""}</span>
          <ChevronLeft size={18} style={{ flex: "none", marginTop: 4 }} />
        </Link>
      ))}
      {data?.refill?.map((r) => (
        <Link key={r.id} to="/meds" className="alert warn">
          <Package size={20} style={{ flex: "none", marginTop: 3 }} />
          <span className="grow">داروی {r.name} {r.days_left <= 0 ? "تمام شده است" : `حدود ${num(r.days_left)} روز دیگر تمام می‌شود`}؛ تهیه کنید.</span>
        </Link>
      ))}

      <Card className="hero">
        <div className="row gap" style={{ alignItems: "center" }}>
          <Ring value={n?.kcal ?? 0} max={n?.goal ?? 2000} size={118} stroke={11} tone="#ffffff" track="rgb(255 255 255 / 22%)">
            <div>
              <div style={{ fontSize: "1.45rem", fontWeight: 800 }}>{n ? num(Math.round(n.kcal)) : "—"}</div>
              <div className="tiny" style={{ opacity: 0.85 }}>کیلوکالری</div>
            </div>
          </Ring>
          <div className="grow col" style={{ gap: 8 }}>
            <div>
              <div style={{ fontWeight: 800 }}>انرژی امروز</div>
              <div className="small">{n ? `${num(Math.max(0, Math.round(n.goal - n.kcal)))} کیلوکالری تا هدف` : "…"}</div>
            </div>
            {[["پروتئین", n?.protein ?? 0, 90], ["کربوهیدرات", n?.carbs ?? 0, 260], ["چربی", n?.fat ?? 0, 70]].map(([l, v, m]) => (
              <div key={l as string} className="macro">
                <div className="row between tiny"><span>{l}</span><span>{num(Math.round(v as number))} گرم</span></div>
                <div className="bar" style={{ background: "rgb(255 255 255 / 22%)" }}>
                  <div className="bar-fill" style={{ width: `${Math.min(100, ((v as number) / (m as number)) * 100)}%`, background: "#fff" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        {data && (
          <div style={{ marginTop: 12 }}>
            <SpeakButton text={() => summary(data, user?.name)} label="خلاصه امروز را برایم بخوان" />
          </div>
        )}
      </Card>

      <div className="quick">
        <Link to="/voice"><IconChip icon={Mic} tone="teal" />ثبت صوتی</Link>
        <Link to="/food"><IconChip icon={Camera} tone="orange" />عکس غذا</Link>
        <Link to="/vitals"><IconChip icon={HeartPulse} tone="red" />فشار و قند</Link>
        <Link to="/scan"><IconChip icon={QrCode} tone="indigo" />پرداخت</Link>
      </div>

      <SectionTitle>وضعیت من</SectionTitle>
      {loading && !data ? (
        <div className="stat-row">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={72} r={16} />)}</div>
      ) : data && (
        <div className="stat-row">
          <Link to="/vitals" className="stat">
            <span className="stat-label"><HeartPulse size={14} color="var(--red)" />فشار خون</span>
            <span className="stat-value">{data.vitals.bp ? <>{num(data.vitals.bp.value)}/{num(data.vitals.bp.value2)}<small>mmHg</small></> : <Empty2 />}</span>
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

      <SectionTitle>ابزارهای هوشمند</SectionTitle>
      <div className="grid2 tiles">
        <Tile to="/food" icon={Utensils} tone="orange" title="تشخیص غذا" sub="غذای ایرانی از روی عکس" />
        <Tile to="/coach" icon={Dumbbell} tone="blue" title="مربی ورزش" sub={data ? `${num(data.workouts.reps)} تکرار این هفته` : "شمارش حرکات"} />
        <Tile to="/xray" icon={Bone} tone="slate" title="عکس قفسه سینه" sub="غربالگری رادیولوژی" />
        <Tile to="/skin" icon={ScanFace} tone="amber" title="بررسی پوست" sub="غربالگری خال" />
        <Tile to="/lab" icon={FlaskConical} tone="violet" title="برگه آزمایش" sub="توضیح نتایج به فارسی" />
        <Tile to="/sleep" icon={Moon} tone="indigo" title="پایش خواب" sub="خروپف و سرفه" />
        <Tile to="/heart" icon={Activity} tone="red" title="ضربان با دوربین" sub="انگشت روی دوربین" />
        {prefs.cycle && <Tile to="/cycle" icon={CalendarHeart} tone="rose" title="سلامت بانوان" sub="تقویم و پیش‌بینی" />}
      </div>

      <SectionTitle>خانواده و پزشک</SectionTitle>
      <div className="grid2">
        <Tile to="/family" icon={Users} tone="blue" title="خانواده و همراه" sub="مراقبت از عزیزان" />
        <Tile to="/report" icon={FileText} tone="indigo" title="گزارش برای پزشک" sub="چاپ و PDF" />
      </div>

      <Link to="/wallet" className="card pay-banner">
        <IconChip icon={Wallet} tone="indigo" />
        <span className="grow">
          <b>کیف پول</b>
          <div className="small">موجودی: {toman(user?.wallet_balance)}</div>
        </span>
        <ChevronLeft size={20} />
      </Link>
      {user?.is_admin && (
        <Link to="/admin" className="btn"><Shield size={18} /> پنل مدیریت</Link>
      )}
      <p className="disclaimer center" style={{ justifyContent: "center" }}><Activity size={14} /> سلامت‌یار جایگزین پزشک نیست؛ در شرایط اورژانسی با ۱۱۵ تماس بگیرید.</p>
    </Page>
  );
}

const Empty2 = () => <span className="small muted" style={{ fontWeight: 600 }}>ثبت کنید</span>;
