import { useState } from "react";
import { Card, ErrorBox, Tabs } from "../components/ui";
import ServerForm from "../components/ServerForm";
import NativeServerForm from "../components/NativeServerForm";
import { canChangeServer } from "../lib/serverConfig";
import { isBundledApp } from "../lib/api";
import { useAuth } from "../lib/auth";

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showServer, setShowServer] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "login") await login(email, password);
      else await register(email, password, name);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <Card className="auth-card">
        <img src="/logo.svg" alt="" className="logo" />
        <h1 className="center wordmark">سلامت‌<span>یار</span></h1>
        <p className="muted center small" style={{ marginBottom: 14 }}>همراه هوشمند سلامت شما؛ تغذیه، فشار و قند، دارو، خواب و سلامت روان</p>
        <Tabs value={mode} onChange={setMode} items={[["login", "ورود"], ["register", "ثبت‌نام"]]} />
        <form className="col" style={{ marginTop: 14 }} onSubmit={submit}>
          {mode === "register" && (
            <label className="field">
              نام
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </label>
          )}
          <label className="field">
            ایمیل
            <input type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          <label className="field">
            رمز عبور
            <input
              type="password" dir="ltr" required minLength={6} value={password}
              onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </label>
          <ErrorBox error={error} />
          <button className="btn primary" disabled={busy}>
            {busy ? "…" : mode === "login" ? "ورود" : "ساخت حساب"}
          </button>
          {(isBundledApp() || canChangeServer()) && (
            <button type="button" className="btn ghost small" onClick={() => setShowServer(!showServer)}>تنظیم آدرس سرور</button>
          )}
        </form>
        {showServer && (isBundledApp() ? <ServerForm onSaved={() => setShowServer(false)} /> : <div style={{ marginTop: 12 }}><NativeServerForm /></div>)}
      </Card>
    </div>
  );
}
