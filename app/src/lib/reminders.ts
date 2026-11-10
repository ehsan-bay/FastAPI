// Medication reminders: native local notifications on Android/iOS, Notification API on web.
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

export type Med = { id: number; name: string; dose: string; times: string[]; active: boolean };

export async function requestPermission(): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    const r = await LocalNotifications.requestPermissions();
    return r.display === "granted";
  }
  if (!("Notification" in window)) return false;
  return (await Notification.requestPermission()) === "granted";
}

/** Replace all scheduled reminders with the current medication list. */
export async function scheduleReminders(meds: Med[]) {
  if (Capacitor.isNativePlatform()) {
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
    const notifications = meds
      .filter((m) => m.active)
      .flatMap((m) =>
        m.times.map((t, i) => {
          const [hour, minute] = t.split(":").map(Number);
          return {
            id: m.id * 100 + i,
            title: "یادآور دارو 💊",
            body: `${m.name}${m.dose ? " — " + m.dose : ""}`,
            schedule: { on: { hour, minute }, allowWhileIdle: true },
          };
        }),
      );
    if (notifications.length) await LocalNotifications.schedule({ notifications });
    return;
  }
  webMeds = meds.filter((m) => m.active);
  startWebTicker();
}

let webMeds: Med[] = [];
let ticker: number | undefined;
const fired = new Set<string>();

// Web/PWA: checks every 30s while the app is open (browsers do not allow exact background alarms).
function startWebTicker() {
  if (ticker) return;
  ticker = window.setInterval(() => {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const now = new Date();
    const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    for (const m of webMeds) {
      const key = `${m.id}-${hm}-${now.toDateString()}`;
      if (m.times.includes(hm) && !fired.has(key)) {
        fired.add(key);
        const body = `${m.name}${m.dose ? " — " + m.dose : ""}`;
        navigator.serviceWorker?.ready
          .then((reg) => reg.showNotification("یادآور دارو 💊", { body, icon: "/icon-192.png", lang: "fa", dir: "rtl" }))
          .catch(() => new Notification("یادآور دارو 💊", { body }));
      }
    }
  }, 30_000);
}
