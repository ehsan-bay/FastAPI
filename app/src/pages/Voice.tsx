import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BookHeart, Check, HeartPulse, Mic, RotateCcw, Square, Utensils } from "lucide-react";
import { Card, Disclaimer, ErrorBox, IconChip, Page, Spinner, SpeakButton } from "../components/ui";
import { api, upload } from "../lib/api";
import { num } from "../lib/format";
import { saveVoiceItem, startRecording, type Recording, type VoiceItem } from "../lib/speech";

const EXAMPLES = ["فشارم صد و سی روی هشتاد بود", "قند خونم صد و ده", "ناهار قورمه سبزی و ماست خوردم", "امروز خیلی خسته و نگرانم"];
const MAX = 30;

export default function Voice() {
  const [phase, setPhase] = useState<"idle" | "rec" | "busy" | "review" | "saved">("idle");
  const [secs, setSecs] = useState(0);
  const [text, setText] = useState("");
  const [items, setItems] = useState<VoiceItem[]>([]);
  const [on, setOn] = useState<boolean[]>([]);
  const [error, setError] = useState("");
  const [savedLabels, setSavedLabels] = useState<string[]>([]);
  const rec = useRef<Recording | null>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    return () => {
      rec.current?.cancel();
    };
  }, []);

  useEffect(() => {
    if (phase !== "rec") return;
    const t0 = Date.now();
    let raf = 0;
    const tick = () => {
      setSecs((Date.now() - t0) / 1000);
      btn.current?.style.setProperty("--lv", String(1 + Math.min(0.35, (rec.current?.level() ?? 0) * 1.2)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [phase]);

  const setResult = (r: { text: string; items: VoiceItem[] }) => {
    setText(r.text);
    setItems(r.items);
    setOn(r.items.map(() => true));
  };

  const start = async () => {
    setError("");
    try {
      rec.current = await startRecording(MAX, () => stop());
      setSecs(0);
      setPhase("rec");
    } catch (e) {
      setError((e as Error).name === "NotAllowedError" ? "اجازه دسترسی به میکروفون داده نشد. از تنظیمات مرورگر اجازه دهید." : (e as Error).message);
    }
  };

  const stop = async () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    setPhase("busy");
    try {
      const wav = await r.stop();
      setResult(await upload("/api/voice/transcribe", new File([wav], "voice.wav", { type: "audio/wav" })));
      setPhase("review");
    } catch (e) {
      setError((e as Error).message);
      setPhase("idle");
    }
  };

  const reparse = async () => {
    if (!text.trim()) return;
    setPhase("busy");
    try {
      setResult(await api("/api/voice/understand", { body: { text } }));
    } catch (e) {
      setError((e as Error).message);
    }
    setPhase("review");
  };

  const save = async () => {
    setPhase("busy");
    setError("");
    const done: string[] = [];
    try {
      for (const [i, it] of items.entries()) {
        if (!on[i]) continue;
        await saveVoiceItem(it);
        done.push(labelOf(it));
      }
      setSavedLabels(done);
      setPhase("saved");
    } catch (e) {
      setError((e as Error).message);
      setPhase("review");
    }
  };

  const reset = () => {
    setPhase("idle");
    setText("");
    setItems([]);
    setError("");
  };

  return (
    <Page title="ثبت صوتی" subtitle="بگویید، ما ثبت می‌کنیم">
      {(phase === "idle" || phase === "rec") && (
        <Card>
          <div className="mic-stage">
            <button ref={btn} className={`mic-btn ${phase === "rec" ? "rec" : ""}`} onClick={phase === "rec" ? stop : start}
              aria-label={phase === "rec" ? "پایان ضبط" : "شروع ضبط"}>
              <span className="pulse" />
              {phase === "rec" ? <Square size={44} fill="currentColor" /> : <Mic size={54} />}
            </button>
            {phase === "rec" ? (
              <>
                <div className="mic-timer">{num(Math.floor(secs))} / {num(MAX)} ثانیه</div>
                <p className="mic-hint">در حال گوش دادن… برای پایان دوباره بزنید.</p>
              </>
            ) : (
              <>
                <p className="mic-hint" style={{ fontSize: "1.05rem", color: "var(--text)" }}><b>دکمه را بزنید و صحبت کنید</b></p>
                <p className="mic-hint">فشار خون، قند، وزن، غذایی که خوردید یا حال‌تان را به فارسی بگویید.</p>
                <div className="examples">{EXAMPLES.map((e) => <span key={e}>«{e}»</span>)}</div>
              </>
            )}
          </div>
          <ErrorBox error={error} />
        </Card>
      )}

      {phase === "busy" && <Card><Spinner text="در حال تبدیل صدا به متن…" /></Card>}

      {phase === "review" && (
        <>
          <Card title="متن شنیده‌شده" action={<SpeakButton text={text} compact />}>
            <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 80 }} aria-label="متن" />
            <p className="tiny muted" style={{ marginTop: 6 }}>اگر اشتباه شنیده شده، متن را درست کنید و «بررسی دوباره» را بزنید.</p>
            <div className="row gap" style={{ marginTop: 8 }}>
              <button className="btn small soft" onClick={reparse}>بررسی دوباره</button>
              <button className="btn small ghost" onClick={reset}><RotateCcw size={16} /> ضبط دوباره</button>
            </div>
          </Card>
          <Card title="چه چیزی ثبت شود؟">
            {items.length === 0 && <p className="muted small">چیزی برای ثبت پیدا نشد. متن را کامل‌تر کنید یا دوباره بگویید.</p>}
            <div className="col">
              {items.map((it, i) => (
                <label key={i} className={`voice-item ${on[i] ? "on" : ""}`}>
                  <input type="checkbox" checked={on[i]} onChange={() => setOn(on.map((v, j) => (j === i ? !v : v)))} />
                  <IconChip icon={it.type === "vital" ? HeartPulse : it.type === "meal" ? Utensils : BookHeart}
                    tone={it.type === "vital" ? "red" : it.type === "meal" ? "orange" : "violet"} size="sm" />
                  <span className="grow">
                    <b>{labelOf(it)}</b>
                    {it.type === "meal" && <div className="tiny muted">{num(it.kcal)} کیلوکالری برای یک وعده</div>}
                    {it.type === "journal" && <div className="tiny muted">در یادداشت روزانه ذخیره می‌شود</div>}
                  </span>
                </label>
              ))}
            </div>
            <ErrorBox error={error} />
            <button className="btn primary block" style={{ marginTop: 12 }} disabled={!on.some(Boolean)} onClick={save}>
              <Check size={18} /> تأیید و ثبت
            </button>
            <Disclaimer>تشخیص گفتار ممکن است اشتباه کند؛ قبل از ثبت، اعداد را بررسی کنید.</Disclaimer>
          </Card>
        </>
      )}

      {phase === "saved" && (
        <Card>
          <div className="col center" style={{ alignItems: "center", padding: "10px 0" }}>
            <IconChip icon={Check} tone="green" size="lg" />
            <h2 style={{ fontSize: "1.15rem" }}>ثبت شد</h2>
            <ul className="list" style={{ width: "100%" }}>
              {savedLabels.map((l) => <li key={l}><Check size={16} color="var(--ok)" />{l}</li>)}
            </ul>
            <div className="row gap" style={{ width: "100%" }}>
              <button className="btn primary grow" onClick={reset}><Mic size={18} /> ثبت بعدی</button>
              <Link to="/" className="btn grow">خانه</Link>
            </div>
          </div>
        </Card>
      )}
    </Page>
  );
}

function labelOf(it: VoiceItem): string {
  if (it.type === "meal") return `وعده: ${it.name}`;
  return it.label;
}
