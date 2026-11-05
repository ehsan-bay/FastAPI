import { useEffect, useState } from "react";
import { AlertTriangle, Bone, CheckCircle2, History, Info } from "lucide-react";
import { Bar, Card, Disclaimer, Empty, ErrorBox, ImagePicker, Page, Spinner, SpeakButton } from "../components/ui";
import { shrinkImage, upload } from "../lib/api";
import { dateTime, num } from "../lib/format";
import { useApi } from "../lib/useApi";

type Finding = { code: string; label: string; score: number; flag: boolean; urgent: boolean };
type Level = "low" | "medium" | "high";
type Result = { level: Level; findings: Finding[]; flagged: string[]; disclaimer: string };

const LEVEL: Record<Level, { title: string; text: string }> = {
  low: { title: "یافته قابل‌توجهی دیده نشد", text: "مدل نشانه واضحی از بیماری‌های بررسی‌شده پیدا نکرد. این به معنی سالم بودن قطعی نیست." },
  medium: { title: "نیاز به بررسی پزشک", text: "مدل نشانه‌هایی دیده که بهتر است پزشک یا رادیولوژیست عکس را ببیند." },
  high: { title: "مراجعه زودتر به پزشک", text: "مدل نشانه‌هایی دیده که ممکن است فوری باشند. هرچه زودتر با پزشک مشورت کنید." },
};

export default function XRay() {
  const history = useApi<{ id: number; level: Level; flagged: string[]; created_at: string }[]>("/api/xray/history");
  const [preview, setPreview] = useState<string>();
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [all, setAll] = useState(false);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const analyze = async (file: File) => {
    setPreview(URL.createObjectURL(file));
    setResult(null);
    setError("");
    setBusy(true);
    try {
      setResult(await upload<Result>("/api/xray/analyze", await shrinkImage(file, 1024)));
      history.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const spoken = (r: Result) =>
    `${LEVEL[r.level].title}. ${LEVEL[r.level].text} ${r.flagged.length ? "موارد قابل‌توجه: " + r.flagged.join("، ") + "." : ""} ${r.disclaimer}`;
  const shown = result ? (all ? result.findings : result.findings.slice(0, 6)) : [];

  return (
    <Page title="عکس قفسه سینه" subtitle="غربالگری رادیولوژی با هوش مصنوعی" back>
      <div className="alert warn small">
        <Info size={18} style={{ flex: "none", marginTop: 3 }} />
        <span>فقط برای عکس رادیولوژی قفسه سینه از روبه‌رو (PA/AP). ابزار کمکی است و تشخیص نمی‌دهد؛ گزارش نهایی با رادیولوژیست است.</span>
      </div>
      <Card title="بارگذاری عکس" icon={Bone} tone="slate">
        <p className="muted small" style={{ marginBottom: 10 }}>از خود فیلم روی نگاتوسکوپ یا فایل دیجیتال عکس بگیرید؛ کل قفسه سینه داخل کادر و صاف باشد. عکس ذخیره نمی‌شود.</p>
        <ImagePicker onPick={analyze} disabled={busy} label="عکس از فیلم" />
        {preview && <img src={preview} alt="عکس رادیولوژی" className="preview contain" style={{ marginTop: 12 }} />}
        {busy && <Spinner text="در حال تحلیل ۱۸ یافته…" />}
        <ErrorBox error={error} />
      </Card>

      {result && (
        <Card title="نتیجه" action={<SpeakButton text={spoken(result)} compact />}>
          <div className={`level-banner ${result.level}`}>
            {result.level === "low" ? <CheckCircle2 size={28} /> : <AlertTriangle size={28} />}
            <div>
              <b>{LEVEL[result.level].title}</b>
              <div className="small" style={{ color: "var(--text-2)" }}>{LEVEL[result.level].text}</div>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            {shown.map((f) => (
              <div key={f.code} className="finding">
                <span className="name">{f.label} {f.flag && <span className={`badge ${f.urgent ? "high" : "medium"}`}>{f.urgent ? "مهم" : "بررسی"}</span>}</span>
                <Bar value={f.score} max={1} tone={f.flag ? (f.urgent ? "danger" : "warn") : "ok"} />
                <span className="small num">{num(Math.round(f.score * 100))}٪</span>
              </div>
            ))}
          </div>
          {result.findings.length > 6 && (
            <button className="btn small ghost block" onClick={() => setAll(!all)}>{all ? "نمایش کمتر" : `نمایش همه ${num(result.findings.length)} مورد`}</button>
          )}
          <p className="tiny muted">عدد هر مورد احتمال تخمینی مدل است (۵۰٪ به بالا = قابل‌توجه)، نه درصد قطعی بیماری.</p>
          <Disclaimer>{result.disclaimer}</Disclaimer>
        </Card>
      )}

      <Card title="سابقه بررسی‌ها" icon={History} tone="slate">
        {history.loading && <Spinner />}
        {history.data?.length === 0 && <Empty>هنوز عکسی بررسی نشده.</Empty>}
        <ul className="list">
          {history.data?.map((h) => (
            <li key={h.id}>
              <span className="grow">
                {h.flagged.length ? h.flagged.join("، ") : "بدون یافته قابل‌توجه"}
                <div className="muted tiny">{dateTime(h.created_at)}</div>
              </span>
              <span className={`badge ${h.level}`}>{h.level === "low" ? "طبیعی" : h.level === "medium" ? "بررسی" : "مهم"}</span>
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}
