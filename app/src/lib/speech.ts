import { api, getToken, serverUrl } from "./api";
import { getPrefs } from "./prefs";

/* ---------- read aloud (server Persian voice, browser voice as fallback) ---------- */
let audio: HTMLAudioElement | null = null;
let stopCurrent: (() => void) | null = null;
const cache = new Map<string, string>();

export function stopSpeaking() {
  stopCurrent?.();
  stopCurrent = null;
}

function browserSpeak(text: string, onEnd: () => void): boolean {
  const synth = window.speechSynthesis;
  if (!synth) return false;
  const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith("fa"));
  if (!voice) return false;
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = getPrefs().speechRate;
  u.onend = onEnd;
  u.onerror = onEnd;
  synth.speak(u);
  stopCurrent = () => {
    synth.cancel();
    onEnd();
  };
  return true;
}

/** Speaks Persian text. Resolves when playback starts; onEnd is called when it stops. */
export async function speak(text: string, onEnd: () => void = () => {}): Promise<void> {
  stopSpeaking();
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 1200);
  if (!clean) return onEnd();
  const rate = getPrefs().speechRate;
  const key = `${rate}|${clean}`;
  let url = cache.get(key);
  if (!url) {
    try {
      const res = await fetch(`${serverUrl()}/api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
        body: JSON.stringify({ text: clean, speed: rate }),
      });
      if (!res.ok) throw new Error(String(res.status));
      url = URL.createObjectURL(await res.blob());
      cache.set(key, url);
    } catch {
      if (browserSpeak(clean, onEnd)) return;
      onEnd();
      throw new Error("خواندن متن در دسترس نیست");
    }
  }
  audio ??= new Audio();
  const a = audio;
  a.src = url;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    a.onended = a.onerror = null;
    onEnd();
  };
  a.onended = finish;
  a.onerror = finish;
  stopCurrent = () => {
    a.pause();
    finish();
  };
  await a.play().catch((e) => {
    finish();
    throw e;
  });
}

/* ---------- voice recording -> 16 kHz mono 16-bit WAV ---------- */
export type Recording = { stop: () => Promise<Blob>; cancel: () => void; level: () => number };

export async function startRecording(maxSeconds = 30, onAutoStop?: () => void): Promise<Recording> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("ضبط صدا در این مرورگر پشتیبانی نمی‌شود");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  const ctx: AudioContext = new AC();
  await ctx.resume();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  let peak = 0;
  let total = 0;
  proc.onaudioprocess = (e) => {
    const d = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(d));
    total += d.length;
    let m = 0;
    for (let i = 0; i < d.length; i += 16) m = Math.max(m, Math.abs(d[i]));
    peak = m;
    if (total / ctx.sampleRate >= maxSeconds) onAutoStop?.();
  };
  src.connect(proc);
  proc.connect(ctx.destination);
  const close = () => {
    proc.disconnect();
    src.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
  };
  return {
    level: () => peak,
    cancel: close,
    stop: async () => {
      const rate = ctx.sampleRate;
      close();
      return encodeWav(await resample(chunks, rate, 16000), 16000);
    },
  };
}

/** Joins the chunks and resamples with the browser's own (band-limited) resampler. */
async function resample(chunks: Float32Array[], inRate: number, outRate: number): Promise<Float32Array> {
  const len = chunks.reduce((s, c) => s + c.length, 0);
  const all = new Float32Array(len);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  if (inRate === outRate || !len) return all;
  try {
    const OAC = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
    const off: OfflineAudioContext = new OAC(1, Math.ceil((len * outRate) / inRate), outRate);
    const buf = off.createBuffer(1, len, inRate);
    buf.copyToChannel(all, 0);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start();
    return (await off.startRendering()).getChannelData(0);
  } catch {
    // Fallback: average neighbouring samples (simple low-pass) while downsampling.
    const ratio = inRate / outRate;
    const n = Math.floor(len / ratio);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * ratio);
      const b = Math.min(len, Math.floor((i + 1) * ratio));
      let s = 0;
      for (let j = a; j < b; j++) s += all[j];
      out[i] = s / Math.max(1, b - a);
    }
    return out;
  }
}

function encodeWav(samples: Float32Array, outRate: number): Blob {
  const n = samples.length;
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  const buf = new ArrayBuffer(44 + pcm.byteLength);
  const v = new DataView(buf);
  const str = (off: number, s: string) => [...s].forEach((c, i) => v.setUint8(off + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + pcm.byteLength, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, outRate, true);
  v.setUint32(28, outRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, pcm.byteLength, true);
  new Int16Array(buf, 44).set(pcm);
  return new Blob([buf], { type: "audio/wav" });
}

export type VoiceItem =
  | { type: "vital"; kind: string; value: number; value2?: number; label: string }
  | { type: "meal"; food_key: string; name: string; kcal: number; servings: number; confidence: number }
  | { type: "journal"; text: string; label: string };

/** Saves one confirmed voice entry through the normal endpoints. */
export function saveVoiceItem(it: VoiceItem) {
  if (it.type === "vital") return api("/api/vitals", { body: { kind: it.kind, value: it.value, value2: it.value2 ?? null, note: "ثبت صوتی" } });
  if (it.type === "meal") return api("/api/meals", { body: { food_key: it.food_key, servings: it.servings, source: "ai" } });
  return api("/api/journal", { body: { text: it.text, mood: 3 } });
}
