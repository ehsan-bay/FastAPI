import { useEffect, useRef, useState } from "react";
import { Card, Empty, ErrorBox, Page, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { dateTime, duration, num } from "../lib/format";
import { EXERCISES, RepCounter, drawPose, loadPoseLandmarker, type ExerciseKey, type Frame } from "../lib/pose";
import { useApi } from "../lib/useApi";

type Workout = { id: number; exercise: ExerciseKey; reps: number; duration_sec: number; form_score: number; kcal: number; created_at: string };

export default function Coach() {
  const history = useApi<Workout[]>("/api/workouts", { days: 30 });
  const [exercise, setExercise] = useState<ExerciseKey>("squat");
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [frame, setFrame] = useState<Frame | null>(null);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [elapsed, setElapsed] = useState(0);
  const [saved, setSaved] = useState("");

  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const counter = useRef<RepCounter | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const raf = useRef(0);
  const startedAt = useRef(0);

  const stopCamera = () => {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  useEffect(() => stopCamera, []);

  const start = async () => {
    setError("");
    setSaved("");
    setLoading(true);
    try {
      const landmarker = await loadPoseLandmarker();
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      const v = video.current!;
      v.srcObject = stream.current;
      await v.play();
      counter.current = new RepCounter(exercise);
      startedAt.current = performance.now();
      setRunning(true);
      let lastTs = -1;
      let lastUi = 0;
      const loop = () => {
        raf.current = requestAnimationFrame(loop);
        if (v.readyState < 2) return;
        const ts = performance.now();
        if (ts <= lastTs) return;
        lastTs = ts;
        const c = canvas.current!;
        if (c.width !== v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight; }
        const res = landmarker.detectForVideo(v, ts);
        const lm = res.landmarks[0];
        const ctx = c.getContext("2d")!;
        if (!lm) { ctx.clearRect(0, 0, c.width, c.height); return; }
        const f = counter.current!.update(lm);
        drawPose(ctx, lm, f.good);
        if (ts - lastUi > 120) { lastUi = ts; setFrame(f); setElapsed((ts - startedAt.current) / 1000); }
      };
      loop();
    } catch (e) {
      const err = e as Error;
      setError(err.name === "NotAllowedError" ? "اجازه دسترسی به دوربین داده نشد." : `راه‌اندازی دوربین یا مدل ناموفق بود: ${err.message}`);
      stopCamera();
    } finally {
      setLoading(false);
    }
  };

  const finish = async () => {
    stopCamera();
    setRunning(false);
    const c = counter.current;
    if (!c || c.reps === 0) return;
    const w = await api<Workout>("/api/workouts", {
      body: { exercise, reps: c.reps, duration_sec: Math.round(elapsed), form_score: c.formScore },
    }).catch((e) => { setError(e.message); return null; });
    if (w) {
      setSaved(`${num(w.reps)} تکرار ${EXERCISES[exercise].name} ثبت شد · فرم ${num(w.form_score)}٪ · ≈${num(w.kcal)} کیلوکالری`);
      history.reload();
    }
    setFrame(null);
  };

  return (
    <Page title="مربی ورزش" subtitle="شمارش حرکات با دوربین، روی گوشی" back>
      {!running && (
        <Card title="تمرین را انتخاب کن">
          <div className="row gap wrap">
            {(Object.keys(EXERCISES) as ExerciseKey[]).map((k) => (
              <button key={k} className={`btn small ${exercise === k ? "primary" : ""}`} onClick={() => setExercise(k)}>
                {EXERCISES[k].name}
              </button>
            ))}
          </div>
          <p className="muted small">{EXERCISES[exercise].hint} پردازش کاملاً روی گوشی انجام می‌شود و تصویری ارسال نمی‌شود.</p>
          <div className="row gap">
            <button className="btn primary grow" onClick={start} disabled={loading}>
              {loading ? "در حال آماده‌سازی…" : "▶شروع"}
            </button>
            <button className="btn" onClick={() => setFacing(facing === "user" ? "environment" : "user")}>
              {facing === "user" ? "جلو" : "پشت"}
            </button>
          </div>
        </Card>
      )}
      {loading && <Spinner text="بارگذاری مدل تشخیص بدن…" />}
      <ErrorBox error={error} />
      {saved && <div className="alert ok">{saved}</div>}

      <div className={`video-wrap ${facing === "environment" ? "rear" : ""}`} style={{ display: running ? "block" : "none" }}>
        <video ref={video} playsInline muted />
        <canvas ref={canvas} />
        <div className="hud">
          <div>
            <div className="reps">{num(frame?.reps ?? 0)}</div>
            <div className="small">{EXERCISES[exercise].name} · {duration(elapsed)}</div>
          </div>
          <div style={{ maxWidth: "60%", textAlign: "left", fontWeight: 700 }}>{frame?.feedback ?? "در کادر قرار بگیر"}</div>
        </div>
      </div>
      {running && (
        <button className="btn danger" onClick={finish}>پایان و ذخیره</button>
      )}

      <Card title="سابقه ۳۰ روز اخیر">
        {history.data?.length === 0 && <Empty>هنوز تمرینی ثبت نشده.</Empty>}
        <ul className="list">
          {history.data?.map((w) => (
            <li key={w.id}>
              <span className="grow">
                {EXERCISES[w.exercise]?.name ?? w.exercise} — {num(w.reps)} تکرار
                <div className="muted small">{dateTime(w.created_at)}</div>
              </span>
              <span className={`badge ${w.form_score >= 75 ? "ok" : w.form_score >= 50 ? "warn" : "danger"}`}>فرم {num(w.form_score)}٪</span>
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}
