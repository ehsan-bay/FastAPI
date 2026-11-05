import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Fingerprint, HeartPulse, RotateCcw } from "lucide-react";
import { Card, Disclaimer, ErrorBox, IconChip, Page, SpeakButton } from "../components/ui";
import { api } from "../lib/api";
import { num } from "../lib/format";
import { filtered, fingerOn, heartRate, type HrResult, type Sample } from "../lib/ppg";

const SECONDS = 25;
type Phase = "idle" | "wait" | "measure" | "done";

export default function Heart() {
  const video = useRef<HTMLVideoElement>(null);
  const wave = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [live, setLive] = useState<number | null>(null);
  const [result, setResult] = useState<HrResult | null>(null);
  const [torch, setTorch] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  useEffect(() => {
    return () => {
      stop();
    };
  }, []);

  const start = async () => {
    setError("");
    setResult(null);
    setSaved(false);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 30 } }, audio: false });
      stream.current = s;
      const track = s.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
      if (caps.torch) await track.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] }).catch(() => setTorch(false));
      else setTorch(false);
      const v = video.current!;
      v.srcObject = s;
      await v.play();
      setPhase("wait");
      loop(v);
    } catch (e) {
      setError((e as Error).name === "NotAllowedError" ? "اجازه دسترسی به دوربین داده نشد." : "دوربین در دسترس نیست.");
    }
  };

  const loop = (v: HTMLVideoElement) => {
    const c = document.createElement("canvas");
    c.width = 40;
    c.height = 30;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    let samples: Sample[] = [];
    let t0 = 0;
    let lostAt = 0;
    const tick = () => {
      if (!stream.current) return;
      ctx.drawImage(v, 0, 0, c.width, c.height);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
      }
      const n = d.length / 4;
      r /= n; g /= n; b /= n;
      const now = performance.now() / 1000;
      if (fingerOn(r, g, b)) {
        lostAt = 0;
        if (!t0) {
          t0 = now;
          samples = [];
          setPhase("measure");
        }
        samples.push({ t: now - t0, v: r });
        const el = now - t0;
        setProgress(Math.min(1, el / SECONDS));
        if (samples.length % 15 === 0 && el > 8) {
          const hr = heartRate(samples.slice(-300));
          setLive(hr && hr.quality !== "poor" ? hr.bpm : null);
        }
        drawWave(samples);
        if (el >= SECONDS) {
          const hr = heartRate(samples.filter((s) => s.t > 3)); // first seconds settle the exposure
          stop();
          setResult(hr);
          setPhase("done");
          return;
        }
      } else if (t0) {
        lostAt ||= now;
        if (now - lostAt > 1) { // finger moved: start over
          t0 = 0;
          setProgress(0);
          setLive(null);
          setPhase("wait");
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const drawWave = (s: Sample[]) => {
    const cv = wave.current;
    if (!cv || s.length < 100) return;
    const x = filtered(s.slice(-180));
    if (!x.length) return;
    const ctx = cv.getContext("2d")!;
    const w = cv.width, h = cv.height;
    const lo = Math.min(...x), hi = Math.max(...x), span = hi - lo || 1;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 3;
    ctx.beginPath();
    x.forEach((v, i) => {
      const px = (i / (x.length - 1)) * w, py = h - 6 - ((v - lo) / span) * (h - 12);
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    });
    ctx.stroke();
  };

  const save = async () => {
    if (!result) return;
    try {
      await api("/api/vitals", { body: { kind: "hr", value: result.bpm, note: "اندازه‌گیری با دوربین" } });
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const ok = result && result.quality !== "poor" && result.bpm >= 40 && result.bpm <= 200;
  return (
    <Page title="ضربان قلب با دوربین" subtitle="بدون دستگاه، با دوربین گوشی" back>
      <video ref={video} playsInline muted style={{ position: "absolute", width: 1, height: 1, opacity: 0 }} />
      {phase === "idle" && (
        <Card>
          <div className="col center" style={{ alignItems: "center" }}>
            <IconChip icon={Fingerprint} tone="red" size="lg" />
            <b>نوک انگشت اشاره را آرام روی دوربین پشت گوشی بگذارید</b>
            <p className="small muted">دوربین و فلاش را کامل بپوشانید، فشار ندهید و ۲۵ ثانیه بی‌حرکت بمانید. بهتر است نشسته و آرام باشید.</p>
            <button className="btn primary block" onClick={start}><HeartPulse size={18} /> شروع اندازه‌گیری</button>
          </div>
          <ErrorBox error={error} />
        </Card>
      )}
      {(phase === "wait" || phase === "measure") && (
        <Card>
          <div className="col center" style={{ alignItems: "center" }}>
            <div className={`heart-beat ${phase === "measure" ? "on" : ""}`}><HeartPulse size={64} /></div>
            <b style={{ fontSize: "2.4rem" }}>{live ? num(live) : "—"}</b>
            <span className="small muted">{phase === "wait" ? "انگشت را روی دوربین بگذارید…" : "در حال اندازه‌گیری؛ تکان ندهید"}</span>
            <canvas ref={wave} width={600} height={120} style={{ width: "100%", height: 80 }} />
            <div className="bar" style={{ width: "100%" }}><div className="bar-fill" style={{ width: `${progress * 100}%`, background: "#ef4444" }} /></div>
            {!torch && <p className="tiny muted">فلاش این گوشی از مرورگر روشن نمی‌شود؛ در نور زیاد اندازه بگیرید.</p>}
            <button className="btn ghost small" onClick={() => { stop(); setPhase("idle"); }}>انصراف</button>
          </div>
        </Card>
      )}
      {phase === "done" && (
        <Card>
          {ok ? (
            <div className="col center" style={{ alignItems: "center" }}>
              <span className="tiny muted">ضربان قلب</span>
              <b style={{ fontSize: "3rem", lineHeight: 1.1 }}>{num(result!.bpm)}</b>
              <span className="muted">ضربه در دقیقه</span>
              <span className={`badge ${result!.quality === "good" ? "ok" : "medium"}`}>کیفیت سیگنال: {result!.quality === "good" ? "خوب" : "متوسط"}</span>
              <p className="small">{result!.bpm < 60 ? "کمتر از محدوده معمول استراحت (۶۰ تا ۱۰۰)." : result!.bpm > 100 ? "بیشتر از محدوده معمول استراحت (۶۰ تا ۱۰۰)؛ اگر در حال استراحت بودید و تکرار شد با پزشک مشورت کنید." : "در محدوده معمول استراحت (۶۰ تا ۱۰۰)."}</p>
              <div className="row gap" style={{ width: "100%" }}>
                {saved ? <Link to="/vitals" className="btn grow"><Check size={18} /> ثبت شد</Link>
                  : <button className="btn primary grow" onClick={save}><Check size={18} /> ثبت در علائم حیاتی</button>}
                <button className="btn" onClick={start}><RotateCcw size={18} /></button>
              </div>
              <SpeakButton text={`ضربان قلب شما ${result!.bpm} ضربه در دقیقه است.`} />
            </div>
          ) : (
            <div className="col center" style={{ alignItems: "center" }}>
              <b>سیگنال واضح نبود</b>
              <p className="small muted">انگشت را بدون فشار و کامل روی دوربین بگذارید و تکان ندهید. اگر فلاش روشن نمی‌شود، در نور زیاد اندازه بگیرید.</p>
              <button className="btn primary block" onClick={start}><RotateCcw size={18} /> دوباره</button>
            </div>
          )}
        </Card>
      )}
      <Disclaimer>اندازه‌گیری با دوربین تقریبی است و برای تشخیص بی‌نظمی ضربان مناسب نیست. در صورت درد قفسه سینه یا تپش شدید با ۱۱۵ تماس بگیرید.</Disclaimer>
    </Page>
  );
}
