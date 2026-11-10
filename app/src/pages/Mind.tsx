import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Mic, Phone, Send, Sparkles } from "lucide-react";
import { Card, Disclaimer, Empty, ErrorBox, Page, Spinner, SpeakButton, Tabs } from "../components/ui";
import { api } from "../lib/api";
import { dateTime, num } from "../lib/format";
import { useApi } from "../lib/useApi";

type Entry = { id: number; text: string; mood: number; sentiment: number; emotions: { key: string; label: string }[]; reply: string; risk: boolean; created_at: string };
type Msg = { role: "user" | "assistant"; content: string };
const MOODS = ["😢", "🙁", "😐", "🙂", "😄"];

export default function Mind() {
  const [tab, setTab] = useState<"journal" | "chat" | "breathe">("journal");
  return (
    <Page title="سلامت روان" subtitle="یادداشت، گفتگو و آرام‌سازی" back>
      <Tabs value={tab} onChange={setTab} items={[["journal", "یادداشت"], ["chat", "گفتگو"], ["breathe", "تنفس"]]} />
      {tab === "journal" && <Journal />}
      {tab === "chat" && <Chat />}
      {tab === "breathe" && <Breathe />}
      <div className="alert info small"><Phone size={16} style={{ flex: "none", marginTop: 4 }} /><span>در شرایط بحرانی: اورژانس اجتماعی ۱۲۳ · صدای مشاور ۱۴۸۰ · اورژانس ۱۱۵</span></div>
    </Page>
  );
}

function Journal() {
  const list = useApi<Entry[]>("/api/journal", { days: 60 });
  const [text, setText] = useState("");
  const [mood, setMood] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [last, setLast] = useState<Entry | null>(null);

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const e = await api<Entry>("/api/journal", { body: { text, mood } });
      setLast(e);
      setText("");
      list.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card title="امروز چه حسی داری؟" action={<Link to="/voice" className="btn small soft"><Mic size={16} /> با صدا</Link>}>
        <div className="moods">
          {MOODS.map((m, i) => (
            <button key={i} className={mood === i + 1 ? "active" : ""} onClick={() => setMood(i + 1)} aria-label={`حال ${i + 1}`}>{m}</button>
          ))}
        </div>
        <textarea style={{ marginTop: 10 }} placeholder="هر چه در ذهنت هست بنویس…" value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} />
        <ErrorBox error={error} />
        <button className="btn primary" style={{ marginTop: 10, width: "100%" }} disabled={busy || !text.trim()} onClick={save}>
          {busy ? "در حال تحلیل…" : "ثبت و تحلیل"}
        </button>
      </Card>
      {last && (
        <Card className={last.risk ? "alert danger" : ""} title="بازخورد" icon={Sparkles} tone="violet" action={<SpeakButton compact text={last.reply} />}>
          <p style={{ margin: 0 }}>{last.reply}</p>
          {last.emotions.length > 0 && (
            <div className="row gap wrap" style={{ marginTop: 8 }}>
              {last.emotions.map((e) => <span key={e.key} className="badge medium">{e.label}</span>)}
            </div>
          )}
        </Card>
      )}
      <Card title="یادداشت‌های قبلی">
        {list.loading && <Spinner />}
        {list.data?.length === 0 && <Empty>هنوز یادداشتی نداری.</Empty>}
        <MoodChart entries={list.data ?? []} />
        <ul className="list">
          {list.data?.map((e) => (
            <li key={e.id} style={{ alignItems: "start" }}>
              <span style={{ fontSize: "1.5rem" }}>{MOODS[e.mood - 1]}</span>
              <span className="grow">
                <div style={{ whiteSpace: "pre-wrap" }}>{e.text.length > 160 ? e.text.slice(0, 160) + "…" : e.text}</div>
                <div className="muted small">{dateTime(e.created_at)}</div>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function MoodChart({ entries }: { entries: Entry[] }) {
  const pts = [...entries].reverse().slice(-20);
  if (pts.length < 2) return null;
  const w = 300, h = 80;
  const x = (i: number) => (i / (pts.length - 1)) * (w - 20) + 10;
  const y = (m: number) => h - 10 - ((m - 1) / 4) * (h - 20);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 90, direction: "ltr" }} role="img" aria-label="نمودار حال">
      <polyline fill="none" stroke="var(--primary)" strokeWidth="2.5" points={pts.map((p, i) => `${x(i)},${y(p.mood)}`).join(" ")} />
      {pts.map((p, i) => <circle key={p.id} cx={x(i)} cy={y(p.mood)} r="3.5" fill="var(--primary)" />)}
    </svg>
  );
}

function Chat() {
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", content: "سلام! من سلامت‌یار هستم. درباره خواب، تغذیه، ورزش یا حال روحی‌ات بپرس." }]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const next = [...msgs, { role: "user" as const, content: text.trim() }];
    setMsgs(next);
    setText("");
    setBusy(true);
    try {
      const r = await api<{ reply: string }>("/api/assistant/chat", { body: { messages: next.slice(1).slice(-12) } });
      setMsgs([...next, { role: "assistant", content: r.reply }]);
    } catch (err) {
      setMsgs([...next, { role: "assistant", content: (err as Error).message }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="chat">
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.content}
            {m.role === "assistant" && i > 0 && <div style={{ marginTop: 6 }}><SpeakButton compact text={m.content} /></div>}
          </div>
        ))}
        {busy && <div className="msg assistant">…</div>}
        <div ref={end} />
      </div>
      <form className="row gap" style={{ marginTop: 12 }} onSubmit={send}>
        <input className="grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="پیامت را بنویس…" maxLength={2000} />
        <button className="btn primary" disabled={busy} aria-label="ارسال"><Send size={18} /></button>
      </form>
      <Disclaimer>دستیار فقط راهنمایی عمومی می‌دهد و جایگزین پزشک یا روان‌درمانگر نیست.</Disclaimer>
    </Card>
  );
}

const PHASES: [string, number][] = [["دم", 4], ["نگه‌دار", 7], ["بازدم", 8]];
const CYCLE = PHASES.reduce((s, p) => s + p[1], 0);

function phaseAt(t: number) {
  let r = t % CYCLE;
  for (const [label, len] of PHASES) {
    if (r < len) return { label, len, left: len - r };
    r -= len;
  }
  return { label: PHASES[0][0], len: PHASES[0][1], left: PHASES[0][1] };
}

function Breathe() {
  const [on, setOn] = useState(false);
  const [t, setT] = useState(0);

  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [on]);

  const { label, len, left } = phaseAt(t);
  const scale = label === "بازدم" ? 0.8 : 1.25;
  return (
    <Card title="تنفس ۴-۷-۸ برای آرامش">
      <div style={{ display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{
          width: 140, height: 140, borderRadius: "50%", background: "var(--primary-soft)", border: "3px solid var(--primary)",
          display: "grid", placeItems: "center", transform: `scale(${on ? scale : 1})`, transition: `transform ${len}s ease-in-out`,
        }}>
          <div className="center"><div style={{ fontWeight: 800 }}>{on ? label : "آماده"}</div><div className="big">{on ? num(left) : ""}</div></div>
        </div>
      </div>
      <p className="muted small center">چرخه‌ها: {num(Math.floor(t / CYCLE))} — ۴ چرخه کافی است.</p>
      <button className="btn primary" style={{ width: "100%" }} onClick={() => { setOn(!on); setT(0); }}>
        {on ? "توقف" : "شروع"}
      </button>
    </Card>
  );
}
