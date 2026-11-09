import { useEffect, useState } from "react";
import { RotateCcw, Server } from "lucide-react";
import { ServerConfig } from "../lib/serverConfig";

/** Change the server the native app opens. The default is the address built into the APK. */
export default function NativeServerForm() {
  const [info, setInfo] = useState<{ url: string; defaultUrl: string; custom: boolean } | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    ServerConfig.get().then((i) => {
      setInfo(i);
      setUrl(i.url);
    }).catch(() => {});
  }, []);

  const save = async (skipCheck = false) => {
    setBusy(true);
    setMsg("در حال بررسی سرور…");
    setFailed(false);
    try {
      await ServerConfig.set({ url, skipCheck });
      setMsg("ذخیره شد؛ اپ با سرور جدید باز می‌شود…");
    } catch (e) {
      setMsg((e as Error).message || "سرور در دسترس نیست");
      setFailed(true);
      setBusy(false);
    }
  };

  if (!info) return null;
  return (
    <div className="col">
      <p className="small muted" style={{ margin: 0 }}>
        سرور فعلی: <span className="ltr">{info.url}</span>
        {info.custom ? " (تغییر داده شده)" : " (پیش‌فرض)"}
      </p>
      <label className="field">
        آدرس سرور
        <input dir="ltr" type="url" inputMode="url" placeholder={info.defaultUrl} value={url} onChange={(e) => setUrl(e.target.value)} />
      </label>
      <button className="btn primary" disabled={busy || !url.trim()} onClick={() => save()}><Server size={18} /> ذخیره و اتصال</button>
      {failed && <button className="btn small ghost" disabled={busy} onClick={() => save(true)}>بدون بررسی ذخیره کن</button>}
      {info.custom && (
        <button className="btn small" disabled={busy} onClick={() => ServerConfig.reset()}><RotateCcw size={16} /> بازگشت به سرور پیش‌فرض</button>
      )}
      {msg && <p className={`small ${failed ? "" : "muted"}`} style={{ margin: 0, color: failed ? "var(--danger)" : undefined }}>{msg}</p>}
      <p className="tiny muted" style={{ margin: 0 }}>پیش‌فرض: <span className="ltr">{info.defaultUrl}</span></p>
    </div>
  );
}
