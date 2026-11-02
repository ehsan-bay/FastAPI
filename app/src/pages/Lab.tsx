import { useState } from "react";
import { Card, Disclaimer, Empty, ErrorBox, ImagePicker, Page, Spinner, Tabs } from "../components/ui";
import { api, shrinkImage, upload } from "../lib/api";
import { dateTime, num } from "../lib/format";
import { useApi } from "../lib/useApi";

type Row = { key: string; name: string; value: number; unit: string; low: number; high: number; status: "low" | "high" | "normal"; note: string };
type Result = { results: Row[]; summary: string; text: string; disclaimer: string };
const STATUS_FA = { low: "پایین", high: "بالا", normal: "طبیعی" };

export default function Lab() {
  const history = useApi<{ id: number; summary: string; results: Row[]; created_at: string }[]>("/api/lab/history");
  const [mode, setMode] = useState<"photo" | "text">("photo");
  const [text, setText] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showRaw, setShowRaw] = useState(false);

  const run = async (fn: () => Promise<Result>) => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(await fn());
      history.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const fromPhoto = (f: File) => run(async () => upload<Result>("/api/lab/analyze", await shrinkImage(f, 2000)));
  const fromText = () => run(() => {
    const fd = new FormData();
    fd.append("text", text);
    return api<Result>("/api/lab/analyze", { body: fd });
  });

  return (
    <Page title="تفسیر برگه آزمایش" back>
      <Tabs value={mode} onChange={setMode} items={[["photo", "📷 عکس برگه"], ["text", "⌨️ تایپ نتایج"]]} />
      <Card>
        {mode === "photo" ? (
          <>
            <p className="muted small">برگه را صاف و در نور کافی بگیر. نام آزمایش‌ها (مثل FBS، CBC، Cholesterol) باید خوانا باشد.</p>
            <ImagePicker onPick={fromPhoto} disabled={busy} label="عکس برگه" />
          </>
        ) : (
          <>
            <textarea dir="ltr" placeholder={"FBS 105\nCholesterol 220\nHDL 38\nTSH 2.1"} value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn primary" style={{ marginTop: 10, width: "100%" }} onClick={fromText} disabled={busy || !text.trim()}>تحلیل</button>
          </>
        )}
        {busy && <Spinner text="در حال خواندن برگه با OCR…" />}
        <ErrorBox error={error} />
      </Card>

      {result && (
        <Card title="نتیجه">
          <div className={`alert ${result.results.some((r) => r.status !== "normal") ? "warn" : "ok"}`}>{result.summary}</div>
          {result.results.length > 0 && <ResultTable rows={result.results} />}
          <button className="btn ghost small" onClick={() => setShowRaw(!showRaw)}>{showRaw ? "پنهان کردن متن خوانده‌شده" : "نمایش متن خوانده‌شده"}</button>
          {showRaw && <pre className="ltr small" style={{ whiteSpace: "pre-wrap", background: "var(--surface-2)", padding: 10, borderRadius: 10 }}>{result.text}</pre>}
          <Disclaimer>{result.disclaimer}</Disclaimer>
        </Card>
      )}

      <Card title="آزمایش‌های قبلی">
        {history.data?.length === 0 && <Empty>موردی ثبت نشده.</Empty>}
        <ul className="list">
          {history.data?.map((h) => (
            <li key={h.id} style={{ display: "block" }}>
              <div className="muted small">{dateTime(h.created_at)}</div>
              <div className="small">{h.summary}</div>
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}

function ResultTable({ rows }: { rows: Row[] }) {
  return (
    <div style={{ overflowX: "auto", margin: "10px 0" }}>
      <table>
        <thead><tr><th>آزمایش</th><th>مقدار</th><th>محدوده</th><th>وضعیت</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.name}<div className="muted small">{r.note}</div></td>
              <td className="ltr">{num(r.value)} <span className="muted small">{r.unit}</span></td>
              <td className="ltr small">{r.high >= 1000 ? `> ${num(r.low)}` : r.low <= 0 ? `< ${num(r.high)}` : `${num(r.low)}–${num(r.high)}`}</td>
              <td><span className={`badge ${r.status}`}>{STATUS_FA[r.status]}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
