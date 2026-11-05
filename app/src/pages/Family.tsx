import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Bell, ChevronLeft, Copy, Share2, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { Card, Empty, ErrorBox, Page, SectionTitle, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { checkCareAlerts } from "../lib/careAlerts";
import { dateTime } from "../lib/format";
import { requestPermission } from "../lib/reminders";
import { useApi } from "../lib/useApi";

type Alert = { key: string; level: "warn" | "danger"; kind: string; text: string };
type Overview = {
  following: { link_id: number; patient_id: number; name: string; alerts: Alert[] }[];
  followers: { link_id: number; label: string; status: "pending" | "active"; code: string | null; caregiver: string | null; created_at: string }[];
};

const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

export default function Family() {
  const tz = new Date().getTimezoneOffset();
  const data = useApi<Overview>("/api/care", { tz_offset: tz });
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const invite = async () => {
    setError("");
    try {
      await api("/api/care/invite", { body: { label } });
      setLabel("");
      data.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMsg("");
    try {
      const r = await api<{ patient: string }>("/api/care/join", { body: { code } });
      setCode("");
      setMsg(`از این پس وضعیت ${r.patient} را می‌بینید.`);
      data.reload();
      if (await requestPermission()) checkCareAlerts().catch(() => {});
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const remove = async (id: number, text: string) => {
    if (!confirm(text)) return;
    await api(`/api/care/${id}`, { method: "DELETE" });
    data.reload();
  };
  const share = async (c: string) => {
    const text = `کد همراهی من در سلامت‌یار: ${c}\nدر اپ سلامت‌یار ← بیشتر ← خانواده و همراه، این کد را وارد کنید.`;
    try {
      if (typeof navigator.share === "function") await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(c);
        setMsg("کد کپی شد");
      }
    } catch {
      /* cancelled */
    }
  };

  return (
    <Page title="خانواده و همراه" subtitle="مراقبت از عزیزان، از راه دور" back>
      <div className="alert info small">
        <ShieldCheck size={18} style={{ flex: "none", marginTop: 3 }} />
        <span>همراه شما فقط فراموشی دارو، اندازه‌گیری‌های خطرناک و تمام شدن دارو را می‌بیند. یادداشت‌ها و عکس‌ها خصوصی می‌مانند و هر زمان می‌توانید او را حذف کنید.</span>
      </div>
      <ErrorBox error={error} />
      {msg && <div className="alert ok small">{msg}</div>}
      {data.loading && !data.data && <Spinner />}

      <SectionTitle>کسانی که دنبال می‌کنم</SectionTitle>
      {data.data?.following.length === 0 && <Card><Empty icon={Users}>هنوز کسی را دنبال نمی‌کنید. کد همراهی را از عضو خانواده بگیرید.</Empty></Card>}
      {data.data?.following.map((f) => (
        <Link key={f.link_id} to={`/family/${f.patient_id}`} className="card" style={{ color: "var(--text)" }}>
          <div className="row gap">
            <span className="avatar">{f.name.charAt(0)}</span>
            <span className="grow">
              <b>{f.name}</b>
              <div className="small muted">{f.alerts.length ? `${f.alerts.length} مورد نیاز به توجه` : "همه‌چیز مرتب است"}</div>
            </span>
            {f.alerts.some((a) => a.level === "danger") ? <span className="badge danger">هشدار</span> : f.alerts.length ? <span className="badge warn">توجه</span> : <span className="badge ok">خوب</span>}
            <ChevronLeft size={18} className="muted" />
          </div>
          {f.alerts.slice(0, 3).map((a) => (
            <div key={a.key} className={`alert ${a.level} small`} style={{ marginTop: 8 }}>
              <AlertTriangle size={16} style={{ flex: "none", marginTop: 4 }} /><span>{a.text}</span>
            </div>
          ))}
        </Link>
      ))}
      <Card title="دنبال کردن با کد" icon={UserPlus} tone="blue">
        <form className="row gap" onSubmit={join}>
          <input className="ltr grow" style={{ textTransform: "uppercase", letterSpacing: 3, textAlign: "center" }} maxLength={8}
            placeholder="کد ۶ حرفی" value={code} onChange={(e) => setCode(e.target.value)} aria-label="کد همراهی" />
          <button className="btn primary" disabled={code.trim().length < 4}>افزودن</button>
        </form>
      </Card>

      <SectionTitle>همراهان من</SectionTitle>
      <Card title="دعوت یک همراه" icon={Bell} tone="teal">
        <p className="small muted">یک کد بسازید و برای فرزند، همسر یا پرستار بفرستید. او با این کد در اپ خودش، فراموشی دارو و هشدارهای شما را می‌بیند.</p>
        <div className="row gap" style={{ marginTop: 8 }}>
          <input className="grow" placeholder="نسبت (مثلاً پسرم)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} />
          <button className="btn primary" onClick={invite}>ساخت کد</button>
        </div>
        <ul className="list" style={{ marginTop: 8 }}>
          {data.data?.followers.map((f) => (
            <li key={f.link_id}>
              <span className="grow">
                <b>{f.label || (f.status === "active" ? f.caregiver : "دعوت")}</b>
                <div className="small muted">{f.status === "active" ? `فعال · ${f.caregiver}` : `در انتظار · ساخته‌شده ${dateTime(f.created_at)}`}</div>
              </span>
              {f.code && (
                <>
                  <span className="code ltr">{f.code}</span>
                  <button className="btn small soft" onClick={() => share(f.code!)} aria-label="ارسال کد">{canShare ? <Share2 size={16} /> : <Copy size={16} />}</button>
                </>
              )}
              <button className="btn ghost small" aria-label="حذف" onClick={() => remove(f.link_id, f.status === "active" ? "این همراه حذف شود؟ دیگر وضعیت شما را نمی‌بیند." : "این دعوت حذف شود؟")}><Trash2 size={16} /></button>
            </li>
          ))}
        </ul>
        {data.data?.followers.length === 0 && <p className="tiny muted">هنوز همراهی ندارید.</p>}
      </Card>
      <p className="disclaimer">اعلان‌ها وقتی ارسال می‌شوند که اپ همراه باز باشد یا هنگام باز شدن آن. این قابلیت جایگزین خدمات اورژانس نیست.</p>
    </Page>
  );
}
