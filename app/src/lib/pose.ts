// On-device exercise coach: MediaPipe Pose Landmarker + joint-angle rep counter.
import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import { modelUrl } from "./api";

export type ExerciseKey = "squat" | "pushup" | "lunge" | "jumping_jack" | "situp";

export const EXERCISES: Record<ExerciseKey, { name: string; hint: string }> = {
  squat: { name: "اسکوات", hint: "از بغل جلوی دوربین بایست تا کل بدنت دیده شود." },
  pushup: { name: "شنا سوئدی", hint: "گوشی را روی زمین، از بغل بدن بگذار." },
  lunge: { name: "لانج", hint: "از بغل بایست؛ کل پاها باید دیده شوند." },
  jumping_jack: { name: "جامپینگ جک", hint: "روبه‌روی دوربین بایست؛ دست‌ها و پاها دیده شوند." },
  situp: { name: "دراز و نشست", hint: "از بغل روی زمین دراز بکش." },
};

let landmarkerPromise: Promise<PoseLandmarker> | null = null;

export function loadPoseLandmarker(): Promise<PoseLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const files = await FilesetResolver.forVisionTasks("/mediapipe/vision");
      const opts = (delegate: "GPU" | "CPU") => ({
        baseOptions: { modelAssetPath: modelUrl("pose_landmarker_lite.task"), delegate },
        runningMode: "VIDEO" as const,
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      try {
        return await PoseLandmarker.createFromOptions(files, opts("GPU"));
      } catch {
        return await PoseLandmarker.createFromOptions(files, opts("CPU"));
      }
    })();
    landmarkerPromise.catch(() => (landmarkerPromise = null));
  }
  return landmarkerPromise;
}

type P = NormalizedLandmark;
const L = { sh: [11, 12], el: [13, 14], wr: [15, 16], hip: [23, 24], knee: [25, 26], ank: [27, 28] } as const;

/** Angle ABC in degrees. */
export function angle(a: P, b: P, c: P): number {
  const ab = Math.atan2(a.y - b.y, a.x - b.x);
  const cb = Math.atan2(c.y - b.y, c.x - b.x);
  let deg = Math.abs(((ab - cb) * 180) / Math.PI);
  if (deg > 180) deg = 360 - deg;
  return deg;
}

const vis = (p: P) => p.visibility ?? 1;

/** Pick the body side (0 left, 1 right) the camera sees best. */
function side(lm: P[]): 0 | 1 {
  const score = (i: 0 | 1) => vis(lm[L.sh[i]]) + vis(lm[L.hip[i]]) + vis(lm[L.knee[i]]) + vis(lm[L.ank[i]]) + vis(lm[L.el[i]]);
  return score(0) >= score(1) ? 0 : 1;
}

export type Frame = { reps: number; stage: "up" | "down"; feedback: string; good: boolean; metric: number; visible: boolean };

export class RepCounter {
  reps = 0;
  stage: "up" | "down" = "up";
  private smooth: number | null = null;
  private goodFrames = 0;
  private totalFrames = 0;

  constructor(public exercise: ExerciseKey) {}

  get formScore() {
    return this.totalFrames ? Math.round((100 * this.goodFrames) / this.totalFrames) : 0;
  }

  update(lm: P[]): Frame {
    const s = side(lm);
    const sh = lm[L.sh[s]], el = lm[L.el[s]], wr = lm[L.wr[s]], hip = lm[L.hip[s]], knee = lm[L.knee[s]], ank = lm[L.ank[s]];
    const visible = [sh, hip, knee].every((p) => vis(p) > 0.5);
    if (!visible) return { reps: this.reps, stage: this.stage, feedback: "بدنت کامل در کادر نیست", good: false, metric: 0, visible };

    let metric = 0;
    let downAt = 0, upAt = 0;
    let feedback = "";
    let good = true;

    switch (this.exercise) {
      case "squat": {
        metric = angle(hip, knee, ank);
        downAt = 100; upAt = 160;
        const lean = Math.abs((Math.atan2(sh.x - hip.x, hip.y - sh.y) * 180) / Math.PI);
        if (lean > 50) { good = false; feedback = "سینه را بالا نگه دار، زیاد به جلو خم نشو"; }
        break;
      }
      case "pushup": {
        metric = angle(sh, el, wr);
        downAt = 90; upAt = 155;
        const line = angle(sh, hip, ank);
        if (line < 155) { good = false; feedback = hip.y > (sh.y + ank.y) / 2 ? "باسن پایین افتاده؛ شکم را سفت کن" : "باسن را پایین‌تر بیاور؛ بدن صاف باشد"; }
        break;
      }
      case "lunge": {
        metric = Math.min(angle(lm[23], lm[25], lm[27]), angle(lm[24], lm[26], lm[28]));
        downAt = 100; upAt = 160;
        const lean = Math.abs((Math.atan2(sh.x - hip.x, hip.y - sh.y) * 180) / Math.PI);
        if (lean > 30) { good = false; feedback = "بالاتنه را صاف نگه دار"; }
        break;
      }
      case "jumping_jack": {
        // "down" = arms up & legs apart (open), "up" = closed.
        const shoulderW = Math.abs(lm[11].x - lm[12].x) || 0.1;
        const armsUp = lm[15].y < lm[11].y && lm[16].y < lm[12].y;
        const legsApart = Math.abs(lm[27].x - lm[28].x) > shoulderW * 1.4;
        metric = armsUp && legsApart ? 0 : 180;
        downAt = 1; upAt = 179;
        if (armsUp !== legsApart) feedback = "دست و پا را هم‌زمان باز و بسته کن";
        break;
      }
      case "situp": {
        metric = angle(sh, hip, knee);
        downAt = 75; upAt = 120;
        break;
      }
    }

    // Exponential smoothing removes jitter from the landmark model.
    this.smooth = this.smooth === null ? metric : this.smooth * 0.6 + metric * 0.4;
    const m = this.exercise === "jumping_jack" ? metric : this.smooth;
    if (this.stage === "up" && m < downAt) {
      this.stage = "down";
    } else if (this.stage === "down" && m > upAt) {
      this.stage = "up";
      this.reps += 1;
      if (!feedback) feedback = "عالی! 👏";
    }
    if (!feedback && this.stage === "down") feedback = "خوبه، حالا برگرد بالا";
    if (!feedback) feedback = this.exercise === "situp" ? "بالا بیا" : "پایین برو";

    this.totalFrames++;
    if (good) this.goodFrames++;
    return { reps: this.reps, stage: this.stage, feedback, good, metric: Math.round(m), visible };
  }
}

const EDGES: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];

export function drawPose(ctx: CanvasRenderingContext2D, lm: P[], good: boolean) {
  const { width: w, height: h } = ctx.canvas;
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = Math.max(3, w / 160);
  ctx.strokeStyle = good ? "#22c55e" : "#f97316";
  ctx.fillStyle = "#fff";
  for (const [a, b] of EDGES) {
    if (vis(lm[a]) < 0.4 || vis(lm[b]) < 0.4) continue;
    ctx.beginPath();
    ctx.moveTo(lm[a].x * w, lm[a].y * h);
    ctx.lineTo(lm[b].x * w, lm[b].y * h);
    ctx.stroke();
  }
  for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    if (vis(lm[i]) < 0.4) continue;
    ctx.beginPath();
    ctx.arc(lm[i].x * w, lm[i].y * h, ctx.lineWidth * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
}
