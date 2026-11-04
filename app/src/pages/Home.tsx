import { Bar, Card, Page, Spinner, Tile } from "../components/ui";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { num, toman } from "../lib/format";
import { useApi } from "../lib/useApi";

type Dash = {
  nutrition: { kcal: number; protein: number; carbs: number; fat: number; goal: number; count: number };
  vitals: Record<string, { value: number; value2: number | null; level: string; message: string }>;
  sleep: { score: number; hours: number } | null;
  mood: { entries: number; avg: number | null };
  workouts: { count: number; reps: number; kcal: number };
  meds: { percent: number | null };
};

const MOOD_EMOJI = ["", "😢", "🙁", "😐", "🙂", "😄"];

export default function Home() {
  const { user } = useAuth();
  const { data, loading, error } = useApi<Dash>("/api/dashboard", { tz_offset: new Date().getTimezoneOffset() });
  const hour = new Date().getHours();
  const hello = hour < 12 ? "صبح بخیر" : hour < 18 ? "روز بخیر" : "شب بخیر";

  return (
    <Page title={`${hello}${user?.name ? "، " + user.name : ""} 👋`}>
      {loading && <Spinner />}
      {error && <div className="alert danger">{error}</div>}
      <Link to="/scan" className="card pay-banner">
        <span style={{ fontSize: "2rem" }}>📷</span>
        <span className="grow">
          <b>پرداخت ویزیت پزشک</b>
          <div className="small">QR مطب را اسکن کنید · موجودی کیف پول: {toman(user?.wallet_balance)}</div>
        </span>
        <span>←</span>
      </Link>
      {user?.is_admin && <Link to="/admin" className="btn">🛠️ پنل مدیریت</Link>}
      {data && (
        <>
          <Card title="کالری امروز">
            <div className="row between">
              <span className="big">{num(data.nutrition.kcal)}</span>
              <span className="muted">از {num(data.nutrition.goal)} کیلوکالری</span>
            </div>
            <Bar value={data.nutrition.kcal} max={data.nutrition.goal} tone={data.nutrition.kcal > data.nutrition.goal ? "warn" : undefined} />
            <div className="grid3 small muted" style={{ marginTop: 8 }}>
              <span>پروتئین {num(data.nutrition.protein)}g</span>
              <span>کربوهیدرات {num(data.nutrition.carbs)}g</span>
              <span>چربی {num(data.nutrition.fat)}g</span>
            </div>
          </Card>

          {Object.values(data.vitals).some((v) => v.level === "danger") && (
            <div className="alert danger">⚠️ {Object.values(data.vitals).find((v) => v.level === "danger")!.message}</div>
          )}

          <div className="grid2">
            <Tile to="/food" icon="🍽️" title="عکس غذا" sub="تشخیص کالری با AI" />
            <Tile to="/coach" icon="🏋️" title="مربی ورزش" sub={`${num(data.workouts.reps)} تکرار در هفته`} />
            <Tile to="/sleep" icon="😴" title="خواب" sub={data.sleep ? `امتیاز ${num(data.sleep.score)} · ${num(data.sleep.hours)} ساعت` : "ثبت نشده"} />
            <Tile to="/mind" icon="🧠" title="حال من" sub={data.mood.avg ? `${MOOD_EMOJI[Math.round(data.mood.avg)]} میانگین هفته` : "یادداشت امروز"} />
            <Tile to="/skin" icon="🩺" title="بررسی پوست" sub="غربالگری خال و ضایعه" />
            <Tile to="/lab" icon="🧪" title="برگه آزمایش" sub="توضیح نتایج به فارسی" />
            <Tile to="/vitals" icon="❤️" title="فشار و قند" sub={data.vitals.bp ? `${num(data.vitals.bp.value)}/${num(data.vitals.bp.value2)}` : "ثبت علائم"} />
            <Tile to="/meds" icon="💊" title="داروها" sub={data.meds.percent !== null ? `${num(data.meds.percent)}٪ مصرف به‌موقع` : "یادآور دارو"} />
          </div>
        </>
      )}
    </Page>
  );
}
