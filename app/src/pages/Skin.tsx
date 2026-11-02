import { useEffect, useState } from "react";
import { Bar, Card, Disclaimer, Empty, ErrorBox, ImagePicker, Page, Spinner } from "../components/ui";
import { shrinkImage, upload } from "../lib/api";
import { dateTime, num } from "../lib/format";
import { useApi } from "../lib/useApi";

type Pred = { code: string; label: string; risk: "low" | "medium" | "high"; score: number };
type Result = { risk: "low" | "medium" | "high"; advice: string; uncertain: boolean; predictions: Pred[]; disclaimer: string };
const RISK_FA = { low: "ریسک پایین", medium: "نیاز به بررسی", high: "مراجعه به پزشک" };
const PARTS = ["صورت", "گردن", "دست", "پا", "پشت", "سینه", "شکم", "سایر"];

export default function Skin() {
  const history = useApi<{ id: number; body_part: string; top_label: string; risk: Pred["risk"]; created_at: string }[]>("/api/skin/history");
  const [part, setPart] = useState(PARTS[2]);
  const [preview, setPreview] = useState<string>();
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const analyze = async (file: File) => {
    setPreview(URL.createObjectURL(file));
    setResult(null);
    setError("");
    setBusy(true);
    try {
      setResult(await upload<Result>("/api/skin/analyze", await shrinkImage(file, 900), { body_part: part }));
      history.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="بررسی پوست و خال" back>
      <div className="alert warn small">این ابزار فقط برای غربالگری است و تشخیص قطعی نمی‌دهد. هر خال در حال تغییر را به پزشک نشان بده.</div>
      <Card title="📸 عکس از نزدیک بگیر">
        <p className="muted small">نور طبیعی، فاصله ۱۰ سانتی‌متر، ضایعه وسط کادر و واضح باشد. عکس ذخیره نمی‌شود.</p>
        <label className="field" style={{ marginBottom: 10 }}>
          محل ضایعه
          <select value={part} onChange={(e) => setPart(e.target.value)}>
            {PARTS.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
        <ImagePicker onPick={analyze} disabled={busy} label="عکس پوست" />
        {preview && <img src={preview} alt="" className="preview" style={{ marginTop: 12 }} />}
        {busy && <Spinner text="در حال تحلیل…" />}
        <ErrorBox error={error} />
      </Card>
      {result && (
        <Card title={<span>نتیجه: <span className={`badge ${result.risk}`}>{RISK_FA[result.risk]}</span></span>}>
          <div className={`alert ${result.risk === "high" ? "danger" : result.risk === "medium" ? "warn" : "ok"}`}>{result.advice}</div>
          {result.uncertain && <p className="small muted">مدل اطمینان کافی ندارد؛ عکس واضح‌تری امتحان کن.</p>}
          <table style={{ marginTop: 10 }}>
            <tbody>
              {result.predictions.map((p) => (
                <tr key={p.code}>
                  <td>{p.label}</td>
                  <td style={{ width: "35%" }}><Bar value={p.score} max={1} tone={p.risk === "high" ? "danger" : p.risk === "medium" ? "warn" : undefined} /></td>
                  <td style={{ width: 50 }}>{num(Math.round(p.score * 100))}٪</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Disclaimer>{result.disclaimer}</Disclaimer>
        </Card>
      )}
      <Card title="سابقه بررسی‌ها">
        {history.data?.length === 0 && <Empty>موردی ثبت نشده.</Empty>}
        <ul className="list">
          {history.data?.map((h) => (
            <li key={h.id}>
              <span className="grow">{h.body_part} — {h.top_label}<div className="muted small">{dateTime(h.created_at)}</div></span>
              <span className={`badge ${h.risk}`}>{RISK_FA[h.risk]}</span>
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}
