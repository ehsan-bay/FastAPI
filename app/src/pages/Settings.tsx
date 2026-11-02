import { useState } from "react";
import { Card, ErrorBox, Page } from "../components/ui";
import ServerForm from "../components/ServerForm";
import { api } from "../lib/api";
import { useAuth, type User } from "../lib/auth";
import { useApi } from "../lib/useApi";

type Models = { server: Record<string, boolean>; device: string[] };
const MODEL_FA: Record<string, string> = { food: "تشخیص غذا", skin: "بررسی پوست", lab_ocr: "خواندن برگه آزمایش", llm: "مدل زبانی گفتگو", mood: "تحلیل احساسات" };

export default function Settings({ firstRun }: { firstRun?: boolean }) {
  const { user, logout, setUser } = useAuth();
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
      setMsg("ذخیره شد ✅");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Page title="تنظیمات" back>
      <Card title="پروفایل">
        <form className="col" onSubmit={saveProfile}>
          <p className="muted small ltr" style={{ margin: 0 }}>{user?.email}</p>
          <label className="field">نام<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field">هدف کالری روزانه<input type="number" min={800} max={6000} value={goal} onChange={(e) => setGoal(e.target.value)} /></label>
          <ErrorBox error={error} />
          <button className="btn primary">ذخیره</button>
          {msg && <p className="small">{msg}</p>}
        </form>
      </Card>
      <Card title="سرور"><ServerForm /></Card>
      <Card title="مدل‌های هوش مصنوعی">
        <ul className="list">
          {models.data && Object.entries(models.data.server).map(([k, ok]) => (
            <li key={k}><span className="grow">{MODEL_FA[k] ?? k} <span className="muted small">(سرور)</span></span><span className={`badge ${ok ? "ok" : "medium"}`}>{ok ? "فعال" : k === "llm" ? "حالت ساده" : "غیرفعال"}</span></li>
          ))}
          <li><span className="grow">تشخیص حرکات بدن <span className="muted small">(روی گوشی)</span></span><span className="badge ok">فعال</span></li>
          <li><span className="grow">تحلیل صدای خواب <span className="muted small">(روی گوشی)</span></span><span className="badge ok">فعال</span></li>
        </ul>
      </Card>
      <button className="btn danger" onClick={logout}>خروج از حساب</button>
      <p className="disclaimer center">سلامت‌یار هوشمند نسخه ۱٫۰ — این اپ جایگزین مشاوره پزشکی نیست.</p>
    </Page>
  );
}
