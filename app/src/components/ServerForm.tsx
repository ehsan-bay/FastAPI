import { useState } from "react";
import { serverUrl, setServerUrl } from "../lib/api";

/** Lets native-app users point the app at their own server. */
export default function ServerForm({ onSaved }: { onSaved?: () => void }) {
  const [url, setUrl] = useState(serverUrl());
  const [status, setStatus] = useState("");

  const test = async () => {
    const clean = url.trim().replace(/\/+$/, "");
    setStatus("در حال بررسی…");
    try {
      const r = await fetch(`${clean}/api/health`);
      if (!r.ok) throw new Error();
      setServerUrl(clean);
      setStatus("✅ متصل شد");
      onSaved?.();
    } catch {
      setStatus("❌ سرور در دسترس نیست. آدرس را بررسی کنید (مثلاً https://example.onrender.com)");
    }
  };

  return (
    <div className="col">
      <label className="field">
        آدرس سرور
        <input dir="ltr" type="url" placeholder="https://your-server.onrender.com" value={url} onChange={(e) => setUrl(e.target.value)} />
      </label>
      <button className="btn" onClick={test} type="button">ذخیره و آزمایش اتصال</button>
      {status && <p className="small">{status}</p>}
      <p className="muted small">در نسخه وب خالی بگذارید (همان سرور سایت استفاده می‌شود).</p>
    </div>
  );
}
