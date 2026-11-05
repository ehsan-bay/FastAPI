import { useSyncExternalStore } from "react";

/** Small per-device preferences (not synced): large text for older users, read-aloud speed. */
export type Prefs = { elder: boolean; speechRate: number; autoRead: boolean; cycle: boolean };
const KEY = "salamat.prefs";
const DEFAULTS: Prefs = { elder: false, speechRate: 0.9, autoRead: false, cycle: false };

function load(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return DEFAULTS;
  }
}

let current = load();
const listeners = new Set<() => void>();

function apply(p: Prefs) {
  document.documentElement.classList.toggle("elder", p.elder);
}
apply(current);

export function setPrefs(patch: Partial<Prefs>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* private mode: keep for this session only */
  }
  apply(current);
  listeners.forEach((l) => l());
}

export const getPrefs = () => current;

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
