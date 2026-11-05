/**
 * Heart rate from the phone camera (photoplethysmography): with a fingertip on the lens and the flash on,
 * the red brightness of each frame rises and falls with every heartbeat. We estimate the beat rate from
 * that signal with autocorrelation and check it against peak-to-peak intervals.
 */
export type Sample = { t: number; v: number }; // t in seconds, v = mean red value

export const FS = 30; // resampling rate (Hz)

/** Fingertip covers the lens: frame is bright red and not much green/blue. */
export const fingerOn = (r: number, g: number, b: number) => r > 70 && r > g * 1.8 && r > b * 1.8;

function resample(s: Sample[], fs = FS): number[] {
  if (s.length < 2) return [];
  const out: number[] = [];
  let j = 0;
  for (let t = s[0].t; t <= s[s.length - 1].t; t += 1 / fs) {
    while (j < s.length - 2 && s[j + 1].t < t) j++;
    const a = s[j], b = s[j + 1];
    const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
    out.push(a.v + (b.v - a.v) * Math.min(1, Math.max(0, k)));
  }
  return out;
}

const movingAvg = (x: number[], w: number) => {
  const out = new Array(x.length).fill(0);
  let sum = 0;
  const q: number[] = [];
  for (let i = 0; i < x.length; i++) {
    q.push(x[i]);
    sum += x[i];
    if (q.length > w) sum -= q.shift()!;
    out[i] = sum / q.length;
  }
  // centre the window
  const shift = Math.floor(w / 2);
  return out.slice(shift).concat(new Array(shift).fill(out[out.length - 1]));
};

/** Band-pass (about 0.6–4 Hz): remove slow drift, then smooth out noise. Pulse peaks point up. */
export function filtered(samples: Sample[], fs = FS): number[] {
  const x = resample(samples, fs);
  if (x.length < fs * 3) return [];
  const drift = movingAvg(x, Math.round(fs * 1.2));
  const hp = x.map((v, i) => v - drift[i]);
  const lp = movingAvg(hp, Math.max(1, Math.round(fs * 0.12)));
  // Blood volume rises -> more light absorbed -> darker frame, so invert to make beats positive peaks.
  return lp.map((v) => -v);
}

function autocorrBpm(x: number[], fs: number): { bpm: number; strength: number } {
  const n = x.length;
  const mean = x.reduce((a, b) => a + b, 0) / n;
  const y = x.map((v) => v - mean);
  const e0 = y.reduce((a, b) => a + b * b, 0) || 1;
  const minLag = Math.round(fs * 60 / 200), maxLag = Math.round(fs * 60 / 40);
  let best = 0, bestLag = 0;
  const r: number[] = [];
  for (let lag = minLag; lag <= Math.min(maxLag, n - 1); lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += y[i] * y[i + lag];
    r[lag] = s / e0;
    if (r[lag] > best) {
      best = r[lag];
      bestLag = lag;
    }
  }
  // Prefer the shortest lag whose peak is almost as strong (avoids picking 2 beats as one).
  for (let lag = minLag + 1; lag < bestLag; lag++) {
    if (r[lag] > r[lag - 1] && r[lag] >= r[lag + 1] && r[lag] > 0.85 * best) {
      bestLag = lag;
      break;
    }
  }
  if (!bestLag) return { bpm: 0, strength: 0 };
  // parabolic interpolation around the peak for sub-sample precision
  const a = r[bestLag - 1] ?? r[bestLag], b = r[bestLag], c = r[bestLag + 1] ?? r[bestLag];
  const d = a - 2 * b + c;
  const lag = bestLag + (d ? (a - c) / (2 * d) : 0);
  return { bpm: (60 * fs) / lag, strength: best };
}

export function peaks(x: number[], fs = FS): number[] {
  const minGap = Math.round(fs * 60 / 200);
  const sorted = [...x].sort((a, b) => a - b);
  const thr = sorted[Math.floor(sorted.length * 0.6)];
  const out: number[] = [];
  for (let i = 1; i < x.length - 1; i++) {
    if (x[i] > thr && x[i] >= x[i - 1] && x[i] > x[i + 1]) {
      if (out.length && i - out[out.length - 1] < minGap) {
        if (x[i] > x[out[out.length - 1]]) out[out.length - 1] = i;
      } else out.push(i);
    }
  }
  return out;
}

export type HrResult = { bpm: number; quality: "good" | "fair" | "poor"; beats: number };

export function heartRate(samples: Sample[], fs = FS): HrResult | null {
  const x = filtered(samples, fs);
  if (x.length < fs * 8) return null;
  const ac = autocorrBpm(x, fs);
  const pk = peaks(x, fs);
  const ibi = pk.slice(1).map((p, i) => (p - pk[i]) / fs).filter((d) => d > 0.3 && d < 1.5);
  const med = ibi.length ? [...ibi].sort((a, b) => a - b)[Math.floor(ibi.length / 2)] : 0;
  const peakBpm = med ? 60 / med : 0;
  if (!ac.bpm) return null;
  const agree = peakBpm ? Math.abs(peakBpm - ac.bpm) / ac.bpm : 1;
  const quality = ac.strength > 0.5 && agree < 0.08 ? "good" : ac.strength > 0.3 && agree < 0.15 ? "fair" : "poor";
  return { bpm: Math.round(ac.bpm), quality, beats: pk.length };
}
