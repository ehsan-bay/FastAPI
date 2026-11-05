import { useState } from "react";
import { Copy, ExternalLink, FileText, Share2, ShieldCheck } from "lucide-react";
import { Card, ErrorBox, Page, Tabs } from "../components/ui";
import { Capacitor } from "@capacitor/core";
import { api, serverUrl } from "../lib/api";
import { num } from "../lib/format";

type Link = { path: string; expires_at: string; days: number };
const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

export default function Report() {
  const [days, setDays] = useState<"30" | "90">("30");
  const [link, setLink] = useState<Link | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const make = async (): Promise<string | null> => {
    setError("");
    setBusy(true);
    try {
      const l = await api<Link>("/api/report/link", { body: { days: +days, valid_days: 7, tz_offset: new Date().getTimezoneOffset() } });
      setLink(l);
      // Absolute address so it also works when sent to the doctor.
      return (serverUrl() || window.location.origin) + l.path;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const open = async () => {
    const url = await make();
    if (url) window.location.href = url;
  };
  const share = async () => {
    const url = await make();
    if (!url) return;
    const text = `گزارش سلامت من (${num(+days)} روز اخیر) — قابل چاپ و ذخیره PDF:`;
    try {
      if (canShare) await navigator.share({ title: "گزارش سلامت", text, url });
      else {
        await navigator.clipboard.writeText(url);
        setMsg("لینک کپی شد؛ آن را برای پزشک بفرستید.");
      }
    } catch {
      /* cancelled */
    }
  };

  return (
    <Page title="گزارش برای پزشک" subtitle="فشار، قند، داروها و آزمایش در یک صفحه" back>
      <Card title="بازه گزارش" icon={FileText} tone="indigo">
        <Tabs value={days} onChange={(v) => { setDays(v); setLink(null); }} items={[["30", "۳۰ روز اخیر"], ["90", "۳ ماه اخیر"]]} />
        <ul className="small" style={{ margin: "12px 0 0", paddingInlineStart: 18, lineHeight: 2 }}>
          <li>میانگین و نمودار فشار خون و قند خون</li>
          <li>HbA1c تخمینی، وزن، ضربان و اکسیژن</li>
          <li>فهرست داروها و درصد مصرف به‌موقع</li>
          <li>آخرین آزمایش ثبت‌شده؛ موارد خطر با رنگ قرمز</li>
        </ul>
        <div className="col" style={{ marginTop: 14 }}>
          <button className="btn primary block" disabled={busy} onClick={share}>{canShare ? <Share2 size={18} /> : <Copy size={18} />} ارسال برای پزشک</button>
          <button className="btn block" disabled={busy} onClick={open}><ExternalLink size={18} /> مشاهده، چاپ یا ذخیره PDF</button>
        </div>
        <ErrorBox error={error} />
        {msg && <div className="alert ok small" style={{ marginTop: 8 }}>{msg}</div>}
        {link && !msg && <p className="tiny muted" style={{ marginTop: 8 }}>لینک ساخته شد و تا ۷ روز معتبر است.</p>}
        {Capacitor.isNativePlatform() && <p className="tiny muted" style={{ marginTop: 8 }}>برای ذخیره PDF در گوشی: «ارسال برای پزشک» ← Chrome، سپس از منوی Chrome «اشتراک ← چاپ» را بزنید.</p>}
      </Card>
      <div className="alert info small">
        <ShieldCheck size={18} style={{ flex: "none", marginTop: 3 }} />
        <span>لینک فقط همین گزارش را نشان می‌دهد، بعد از ۷ روز باطل می‌شود و با آن نمی‌توان وارد حساب شما شد.</span>
      </div>
    </Page>
  );
}
