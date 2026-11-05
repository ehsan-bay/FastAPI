import { serverUrl } from "./api";

export const APP_BUILD: string = __APP_BUILD__;
const KEY = "salamat.reloadedFor";

/** Fetches the build id of the site that is live on the server (never from cache). */
export async function liveBuild(): Promise<string | null> {
  try {
    const r = await fetch(`${serverUrl()}/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    return ((await r.json()) as { build?: string }).build ?? null;
  } catch {
    return null;
  }
}

/** Drops cached copies (service worker + its caches) and reloads, so the newest site is shown. */
export async function forceRefresh() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    if (window.caches) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  } catch {
    /* best effort */
  }
  window.location.reload();
}

/**
 * When the server has a newer build than the one running, reload once.
 * Phones (and the native app's web view) can keep showing an old cached copy after a server update.
 */
export async function checkForUpdate(): Promise<boolean> {
  const live = await liveBuild();
  if (!live || live === APP_BUILD) return false;
  let done: string | null = null;
  try {
    done = sessionStorage.getItem(KEY);
    sessionStorage.setItem(KEY, live);
  } catch {
    /* storage unavailable */
  }
  if (done === live) return false; // already tried for this build; avoid a reload loop
  await forceRefresh();
  return true;
}

export function watchForUpdates() {
  const run = () => {
    if (document.visibilityState === "visible") checkForUpdate();
  };
  run();
  document.addEventListener("visibilitychange", run);
  window.setInterval(run, 15 * 60_000);
}
