import { useEffect, useRef, useState } from "react";
import { Moon } from "lucide-react";
import { Card, Empty, ErrorBox, Page, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { dateOnly, duration, num } from "../lib/format";
import { SleepMonitor, labelFa, type SleepStats } from "../lib/sleep";
import { clearPending, flushPendingSleep, loadPending, toPayload } from "../lib/sleepStore";
import { useApi } from "../lib/useApi";

type Session = { id: number; started_at: string; hours: number; score: number; snore_seconds: number; cough_count: number; breath_events: number; recovered: boolean; tips: string[] };

export default function Sleep() {
  const history = useApi<Session[]>("/api/sleep", { days: 30 });
  const monitor = useRef<SleepMonitor | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "recording" | "saving">("idle");
  const [stats, setStats] = useState<SleepStats | null>(null);
  const [live, setLive] = useState({ label: "—", score: 0, level: 0 });
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [last, setLast] = useState<Session | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (state !== "recording") return;
    const t = setInterval(() => setElapsed((Date.now() - monitor.current!.startedAt.getTime()) / 1000), 1000);
    return () => clearInterval(t);
  }, [state]);
  useEffect(() => {
    // Leaving the page stops recording; the night stays saved on the phone and is sent right away.
    return () => {
      const m = monitor.current;
      if (m) m.stop().then(() => flushPendingSleep());
    };
  }, []);

  // Send a night left over from an earlier run (app closed before "wake up", or no internet).
  useEffect(() => {
    flushPendingSleep().then((saved) => {
      if (saved) {
        setLast(saved as Session);
        setNotice("خواب ناتمام قبلی که روی گوشی ذخیره شده بود، ارسال و ثبت شد.");
      }
    });
    const onSaved = () => history.reload();
    window.addEventListener("salamat:sleep-saved", onSaved);
    return () => window.removeEventListener("salamat:sleep-saved", onSaved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async () => {
    setError("");
    setLast(null);
    setState("loading");
    const m = new SleepMonitor((s, l) => { setStats({ ...s }); setLive(l); });
    try {
      await m.start();
      monitor.current = m;
      setElapsed(0);
      setState("recording");
    } catch (e) {
      await m.stop().catch(() => {});
      const err = e as Error;
      setError(err.name === "NotAllowedError" ? "اجازه دسترسی به میکروفون داده نشد." : `شروع ناموفق بود: ${err.message}`);
      setState("idle");
    }
  };

  const stop = async () => {
    if (!monitor.current) return;
    setState("saving");
    const r = await monitor.current.stop();
    monitor.current = null;
    if ((r.endedAt.getTime() - r.startedAt.getTime()) / 1000 < 60) {
      clearPending(r.id);
      setError("جلسه کوتاه‌تر از یک دقیقه بود و ذخیره نشد.");
      setState("idle");
      return;
    }
    const pending = loadPending();
    try {
      if (!pending || pending.id !== r.id) throw new Error("داده جلسه پیدا نشد");
      const s = await api<Session>("/api/sleep", { body: toPayload(pending) });
      clearPending(r.id);
      setLast(s);
      history.reload();
    } catch (e) {
      // Stats stay on the phone and are sent automatically next time the app is opened or online.
      setNotice(`ارسال به سرور ناموفق بود (${(e as Error).message}). آمار روی گوشی ذخیره شد و بعداً خودکار ارسال می‌شود.`);
    }
    setState("idle");
  };

  return (
    <Page title="پایش خواب" subtitle="خروپف و سرفه، روی همین گوشی" back>
      {state === "idle" || state === "loading" ? (
        <Card title="شروع پایش خواب" icon={Moon} tone="indigo">
          <p className="muted small">
            گوشی را به شارژ بزن، کنار تخت (رو به پایین) بگذار و اپ را باز نگه دار. صداها روی خود گوشی تحلیل می‌شوند و هیچ صدایی ضبط یا ارسال نمی‌شود؛
            فقط تعداد رویدادها (خروپف، سرفه، تنفس) ذخیره می‌شود. آمار هر دقیقه روی گوشی ذخیره می‌شود تا اگر اپ بسته شد از دست نرود.
          </p>
          <button className="btn primary" style={{ width: "100%" }} onClick={start} disabled={state === "loading"}>
            {state === "loading" ? "در حال آماده‌سازی…" : "شروع"}
          </button>
        </Card>
      ) : (
        <Card title="در حال پایش…" icon={Moon} tone="indigo">
          <div className="center big">{duration(elapsed)}</div>
          <div className="meter" style={{ margin: "10px 0" }}><div style={{ width: `${live.level * 100}%` }} /></div>
          <p className="center muted small">صدای فعلی: {live.label}</p>
          <div className="grid3 center">
            <div><div className="big">{num(Math.round((stats?.snoreSeconds ?? 0) / 60))}</div><div className="small muted">دقیقه خروپف</div></div>
            <div><div className="big">{num(stats?.coughCount ?? 0)}</div><div className="small muted">سرفه</div></div>
            <div><div className="big">{num(stats?.breathEvents ?? 0)}</div><div className="small muted">رویداد تنفسی</div></div>
          </div>
          {stats && stats.events.length > 0 && (
            <p className="small muted">آخرین رویداد: {labelFa(stats.events[stats.events.length - 1].label)}</p>
          )}
          <button className="btn danger" style={{ width: "100%", marginTop: 12 }} onClick={stop} disabled={state === "saving"}>
            {state === "saving" ? "در حال ذخیره…" : "بیدار شدم — پایان"}
          </button>
        </Card>
      )}
      <ErrorBox error={error} />
      {notice && <div className="alert info small">{notice}</div>}
      {last && (
        <Card title={`امتیاز خواب: ${num(last.score)} از ۱۰۰`}>
          <p className="small">مدت خواب: {num(last.hours)} ساعت</p>
          {last.tips.length ? last.tips.map((t) => <div key={t} className="alert warn small" style={{ marginTop: 6 }}>{t}</div>) : <div className="alert ok">خواب خوبی داشتی! </div>}
        </Card>
      )}
      <Card title="۳۰ شب اخیر">
        {history.loading && <Spinner />}
        {history.data?.length === 0 && <Empty>هنوز خوابی ثبت نشده.</Empty>}
        <ul className="list">
          {history.data?.map((s) => (
            <li key={s.id}>
              <span className="grow">{dateOnly(s.started_at)}{s.recovered && <span className="badge medium" style={{ marginInlineStart: 6 }}>بازیابی‌شده</span>}<div className="muted small">{num(s.hours)} ساعت · خروپف {num(Math.round(s.snore_seconds / 60))} دقیقه</div></span>
              <span className={`badge ${s.score >= 75 ? "ok" : s.score >= 50 ? "warn" : "danger"}`}>{num(s.score)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}
