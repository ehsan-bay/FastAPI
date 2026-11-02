// Keeps the current night's sleep stats on the phone so they survive the app being closed,
// and uploads unsent nights later. The server ignores duplicates (same client_id).
import { api } from "./api";
import type { SleepStats } from "./sleep";

const KEY = "salamat.sleep.pending";
const MIN_SECONDS = 60; // shorter sessions are not worth saving
const ACTIVE_WINDOW_MS = 3 * 60_000; // a checkpoint this fresh may belong to a recording in another tab

export type PendingSleep = {
  id: string;
  startedAt: string; // ISO
  lastAt: string; // ISO time of the last checkpoint
  endedAt?: string; // set when the user pressed "wake up" but the upload failed
  interruptedAt?: string; // set when the app was closed while recording
  stats: SleepStats;
};

let recordingHere = false;
export const setRecording = (on: boolean) => { recordingHere = on; };

export function newSessionId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
}

export function loadPending(): PendingSleep | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingSleep) : null;
  } catch {
    return null;
  }
}

export function savePending(p: PendingSleep) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage full or blocked: nothing else we can do */
  }
}

export function clearPending(id?: string) {
  try {
    if (!id || loadPending()?.id === id) localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function toPayload(p: PendingSleep) {
  const end = p.endedAt ?? p.lastAt;
  return {
    client_id: p.id,
    started_at: p.startedAt,
    ended_at: end,
    recovered: !p.endedAt,
    snore_seconds: Math.round(p.stats.snoreSeconds),
    cough_count: p.stats.coughCount,
    breath_events: p.stats.breathEvents,
    noise_seconds: Math.round(p.stats.noiseSeconds),
    timeline: p.stats.events.slice(0, 5000),
  };
}

const seconds = (p: PendingSleep) => (Date.parse(p.endedAt ?? p.lastAt) - Date.parse(p.startedAt)) / 1000;

let flushing: Promise<unknown> | null = null;

/**
 * Upload a night left over from an earlier run (app closed, crash, no internet).
 * Returns the saved session, or null when there was nothing to send.
 */
export function flushPendingSleep(): Promise<any | null> {
  if (flushing) return flushing;
  flushing = (async () => {
    const p = loadPending();
    if (!p || recordingHere) return null;
    if (!p.endedAt && !p.interruptedAt && Date.now() - Date.parse(p.lastAt) < ACTIVE_WINDOW_MS) return null;
    if (!(seconds(p) >= MIN_SECONDS)) {
      clearPending(p.id);
      return null;
    }
    try {
      const saved = await api("/api/sleep", { body: toPayload(p) });
      clearPending(p.id);
      window.dispatchEvent(new CustomEvent("salamat:sleep-saved", { detail: saved }));
      return saved;
    } catch (e) {
      // 4xx means the data itself is bad (e.g. >16 h); drop it so we don't retry forever.
      const status = (e as { status?: number }).status ?? 0;
      if (status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429) clearPending(p.id);
      return null;
    }
  })().finally(() => { flushing = null; });
  return flushing;
}
