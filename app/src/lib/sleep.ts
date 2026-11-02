// On-device sleep sound analysis: MediaPipe Audio Classifier (YAMNet, 521 sound classes).
import { AudioClassifier, FilesetResolver } from "@mediapipe/tasks-audio";
import { modelUrl } from "./api";

export type SleepEvent = { t: number; label: string; score: number };
export type SleepStats = { snoreSeconds: number; coughCount: number; breathEvents: number; noiseSeconds: number; events: SleepEvent[] };

const WATCH: Record<string, { fa: string; kind: "snore" | "cough" | "breath" | "noise" }> = {
  Snoring: { fa: "خروپف", kind: "snore" },
  Snort: { fa: "خرخر", kind: "snore" },
  Cough: { fa: "سرفه", kind: "cough" },
  Sneeze: { fa: "عطسه", kind: "cough" },
  Gasp: { fa: "نفس بریده", kind: "breath" },
  Wheeze: { fa: "خس‌خس", kind: "breath" },
  Breathing: { fa: "تنفس سنگین", kind: "breath" },
  Speech: { fa: "صحبت در خواب", kind: "noise" },
  Music: { fa: "موسیقی/صدا", kind: "noise" },
  Vehicle: { fa: "صدای خودرو", kind: "noise" },
  Dog: { fa: "پارس سگ", kind: "noise" },
  Alarm: { fa: "زنگ", kind: "noise" },
};
export const labelFa = (l: string) => WATCH[l]?.fa ?? l;

export class SleepMonitor {
  stats: SleepStats = { snoreSeconds: 0, coughCount: 0, breathEvents: 0, noiseSeconds: 0, events: [] };
  startedAt = new Date();
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private node?: ScriptProcessorNode;
  private classifier?: AudioClassifier;
  private buf: Float32Array[] = [];
  private bufLen = 0;
  private lastEventAt: Record<string, number> = {};
  private wakeLock: any = null;

  constructor(private onUpdate: (s: SleepStats, live: { label: string; score: number; level: number }) => void) {}

  async start() {
    const files = await FilesetResolver.forAudioTasks("/mediapipe/audio");
    this.classifier = await AudioClassifier.createFromOptions(files, {
      baseOptions: { modelAssetPath: modelUrl("yamnet.tflite") },
      maxResults: 5,
      scoreThreshold: 0.15,
    });
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.node.onaudioprocess = (e) => this.onAudio(e.inputBuffer.getChannelData(0));
    src.connect(this.node);
    // Must be connected to run; a zero-gain node keeps it silent.
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.node.connect(mute).connect(this.ctx.destination);
    this.startedAt = new Date();
    try {
      this.wakeLock = await (navigator as any).wakeLock?.request("screen");
    } catch {
      /* not supported: user is told to keep the screen on */
    }
  }

  private onAudio(chunk: Float32Array) {
    this.buf.push(new Float32Array(chunk));
    this.bufLen += chunk.length;
    const rate = this.ctx!.sampleRate;
    if (this.bufLen < rate) return; // classify ~1 second windows
    const win = new Float32Array(this.bufLen);
    let o = 0;
    for (const b of this.buf) { win.set(b, o); o += b.length; }
    this.buf = [];
    this.bufLen = 0;
    this.classifyWindow(win, rate);
  }

  private classifyWindow(win: Float32Array, rate: number) {
    const seconds = win.length / rate;
    let sum = 0;
    for (let i = 0; i < win.length; i++) sum += win[i] * win[i];
    const rms = Math.sqrt(sum / win.length);
    const level = Math.max(0, Math.min(1, (20 * Math.log10(rms + 1e-9) + 70) / 60)); // ~ -70..-10 dBFS
    if (rms < 0.002) {
      this.onUpdate(this.stats, { label: "سکوت", score: 1, level });
      return; // quiet: skip the model to save battery
    }
    const results = this.classifier!.classify(win, rate);
    const cats = results.flatMap((r) => r.classifications[0]?.categories ?? []);
    const top = cats[0];
    const t = Math.round((Date.now() - this.startedAt.getTime()) / 1000);
    for (const c of cats) {
      const w = WATCH[c.categoryName];
      if (!w || c.score < 0.3) continue;
      if (w.kind === "snore") this.stats.snoreSeconds += seconds;
      if (w.kind === "noise") this.stats.noiseSeconds += seconds;
      // Count discrete events at most once per 3 seconds.
      const last = this.lastEventAt[w.kind] ?? -999;
      if (t - last >= 3) {
        if (w.kind === "cough") this.stats.coughCount++;
        if (w.kind === "breath" && c.categoryName !== "Breathing") this.stats.breathEvents++;
        if (this.stats.events.length < 5000) this.stats.events.push({ t, label: c.categoryName, score: Math.round(c.score * 100) / 100 });
        this.lastEventAt[w.kind] = t;
      }
      break;
    }
    this.onUpdate(this.stats, { label: top ? labelFa(top.categoryName) : "—", score: top?.score ?? 0, level });
  }

  async stop() {
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => {});
    this.classifier?.close();
    try { await this.wakeLock?.release(); } catch { /* ignore */ }
    return { startedAt: this.startedAt, endedAt: new Date(), stats: this.stats };
  }
}
