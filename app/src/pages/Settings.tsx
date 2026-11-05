import { useEffect, useState } from "react";
import { Accessibility, Cpu, LogOut, RefreshCw, Server, User as UserIcon } from "lucide-react";
import { Card, ErrorBox, Page, SpeakButton } from "../components/ui";
import { setPrefs, usePrefs } from "../lib/prefs";
import { APP_BUILD, forceRefresh, liveBuild } from "../lib/version";
import ServerForm from "../components/ServerForm";
import { api, isBundledApp } from "../lib/api";
import { useAuth, type User } from "../lib/auth";
import { useApi } from "../lib/useApi";

type Models = { server: Record<string, boolean | string>; device: string[] };
const MODEL_FA: Record<string, string> = {
  food: "تشخیص غذا", asr: "تشخیص گفتار فارسی", tts: "خواندن متن با صدا", xray: "غربالگری عکس قفسه سینه",
  skin: "بررسی پوست", lab_ocr: "خواندن برگه آزمایش", llm: "مدل زبانی گفتگو", mood: "تحلیل احساسات",
};

export default function Settings({ firstRun }: { firstRun?: boolean }) {
  const { user, logout, setUser } = useAuth();
  const prefs = usePrefs();
  const models = useApi<Models>(firstRun ? null : "/api/models");
  const [goal, setGoal] = useState(String(user?.calorie_goal ?? 2000));
  const [name, setName] = useState(user?.name ?? "");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  if (firstRun) {
    return (
      <div className="auth-page">
        <Card className="auth-card" title="اتصال به سرور">
          <p className="muted small">برای استفاده از اپ، آدرس سرور سلامت‌یار را وارد کنید.</p>
          <ServerForm onSaved={() => window.location.reload()} />
        </Card>
      </div>
    );
  }

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      setUser(await api<User>("/api/auth/me", { method: "PATCH", body: { name, calorie_goal: +goal } }));
      setMsg("ذخیره شد");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Page title="تنظیمات" back>
      <Card title="دسترسی‌پذیری" icon={Accessibility} tone="blue">
        <div className="col">
          <label className="row gap" style={{ cursor: "pointer" }}>
            <span className="grow">
              <b>حالت سالمند</b>
              <div className="tiny muted">متن و دکمه‌های بزرگ‌تر، خواندن‌پذیری بیشتر</div>
            </span>
            <span className="switch"><input type="checkbox" checked={prefs.elder} onChange={(e) => setPrefs({ elder: e.target.checked })} aria-label="حالت سالمند" /><span /></span>
          </label>
          <label className="field">
            سرعت خواندن متن: {prefs.speechRate <= 0.8 ? "آهسته" : prefs.speechRate >= 1.1 ? "سریع" : "معمولی"}
            <input type="range" min={0.7} max={1.2} step={0.1} value={prefs.speechRate} onChange={(e) => setPrefs({ speechRate: +e.target.value })} />
          </label>
          <SpeakButton text="سلام. این نمونه صدای سلامت‌یار است. داروی ساعت هشت را فراموش نکنید." label="شنیدن نمونه صدا" />
        </div>
      </Card>
      <Card title="پروفایل" icon={UserIcon}>
        <form className="col" onSubmit={saveProfile}>
          <p className="muted small ltr" style={{ margin: 0 }}>{user?.email}</p>
          <label className="field">نام<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field">هدف کالری روزانه<input type="number" min={800} max={6000} value={goal} onChange={(e) => setGoal(e.target.value)} /></label>
          <ErrorBox error={error} />
          <button className="btn primary">ذخیره</button>
          {msg && <p className="small">{msg}</p>}
        </form>
      </Card>
      {isBundledApp() && <Card title="سرور" icon={Server} tone="slate"><ServerForm /></Card>}
      <Card title="مدل‌های هوش مصنوعی" icon={Cpu} tone="violet">
        <ul className="list">
          {models.data && Object.entries(models.data.server).filter(([, v]) => typeof v === "boolean").map(([k, ok]) => (
            <li key={k}>
              <span className="grow">{MODEL_FA[k] ?? k} <span className="muted tiny">(سرور)</span>
              </span>
              <span className={`badge ${ok ? "ok" : "medium"}`}>{ok ? "فعال" : k === "llm" ? "حالت ساده" : "غیرفعال"}</span>
            </li>
          ))}
          <li><span className="grow">تشخیص حرکات بدن <span className="muted small">(روی گوشی)</span></span><span className="badge ok">فعال</span></li>
          <li><span className="grow">تحلیل صدای خواب <span className="muted small">(روی گوشی)</span></span><span className="badge ok">فعال</span></li>
        </ul>
      </Card>
      <button className="btn danger" onClick={logout}><LogOut size={18} /> خروج از حساب</button>
      <VersionCard />
      <p className="disclaimer center">سلامت‌یار هوشمند — این اپ جایگزین مشاوره پزشکی نیست.</p>
    </Page>
  );
}

const fmtBuild = (b: string | null) => (b && b.length >= 12 ? `${b.slice(0, 4)}.${b.slice(4, 6)}.${b.slice(6, 8)}-${b.slice(8, 12)}` : b ?? "—");

function VersionCard() {
  const [live, setLive] = useState<string | null>(null);
  useEffect(() => {
    liveBuild().then(setLive);
  }, []);
  const old = live !== null && live !== APP_BUILD;
  return (
    <Card title="نسخه برنامه" icon={RefreshCw} tone="slate">
      <div className="small col" style={{ gap: 4 }}>
        <div className="row between"><span className="muted">نسخه در حال اجرا</span><span className="ltr">{fmtBuild(APP_BUILD)}</span></div>
        <div className="row between"><span className="muted">آخرین نسخه روی سرور</span><span className="ltr">{fmtBuild(live)}</span></div>
      </div>
      {old && <div className="alert warn small" style={{ marginTop: 8 }}>نسخه جدیدتری روی سرور هست.</div>}
      <button className="btn soft block" style={{ marginTop: 10 }} onClick={forceRefresh}><RefreshCw size={16} /> به‌روزرسانی و بارگذاری مجدد</button>
    </Card>
  );
}
