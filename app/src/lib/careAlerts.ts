// Caregiver alerts: while the app is open, check the people I follow and show a notification for each new alert.
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { api, getToken } from "./api";

export type CareAlert = { key: string; level: "warn" | "danger"; kind: string; text: string; patient: string; patient_id: number };
const SEEN = "salamat.careSeen";

function seen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN) || "[]"));
  } catch {
    return new Set();
  }
}
function remember(keys: string[]) {
  try {
    localStorage.setItem(SEEN, JSON.stringify(keys.slice(-300)));
  } catch {
    /* ignore */
  }
}

async function notify(a: CareAlert, n: number) {
  const title = a.level === "danger" ? `هشدار برای ${a.patient}` : `یادآوری برای ${a.patient}`;
  if (Capacitor.isNativePlatform()) {
    // ids 900000+ so they never clash with medication reminder ids (med.id * 100 + i)
    await LocalNotifications.schedule({ notifications: [{ id: 900000 + (Date.now() % 90000) + n, title, body: a.text }] });
    return;
  }
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg) await reg.showNotification(title, { body: a.text, icon: "/icon-192.png", tag: a.key, lang: "fa", dir: "rtl" });
  else new Notification(title, { body: a.text, tag: a.key });
}

export async function checkCareAlerts(): Promise<CareAlert[]> {
  if (!getToken()) return [];
  const list = await api<CareAlert[]>("/api/care/alerts", { query: { tz_offset: new Date().getTimezoneOffset() } });
  const old = seen();
  const fresh = list.filter((a) => !old.has(a.key));
  for (const [i, a] of fresh.entries()) await notify(a, i).catch(() => {});
  if (fresh.length) remember([...old, ...fresh.map((a) => a.key)]);
  return list;
}

let timer: number | undefined;
export function watchCareAlerts() {
  if (timer) return;
  const run = () => {
    if (document.visibilityState === "visible") checkCareAlerts().catch(() => {});
  };
  run();
  timer = window.setInterval(run, 5 * 60_000);
  document.addEventListener("visibilitychange", run);
}
