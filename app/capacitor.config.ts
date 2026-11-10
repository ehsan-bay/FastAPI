import type { CapacitorConfig } from "@capacitor/cli";
import { readFileSync } from "node:fs";

// The app opens the live website, so every change deployed to the server reaches the app at once
// (no new APK needed). A new APK is only needed for native changes (permissions, plugins, icon).
// Set CAP_BUNDLED=1 to ship the web files inside the app instead (works offline, needs an APK per change).
function siteUrl(): string {
  if (process.env.SALAMAT_APP_URL) return process.env.SALAMAT_APP_URL;
  if (process.env.VITE_API_URL) return process.env.VITE_API_URL;
  try {
    const m = readFileSync(new URL("./.env.production", import.meta.url), "utf8").match(/^VITE_API_URL=(.+)$/m);
    if (m) return m[1].trim();
  } catch {
    /* no .env.production */
  }
  return "";
}

const url = process.env.CAP_BUNDLED === "1" ? "" : siteUrl().replace(/\/+$/, "");

const config: CapacitorConfig = {
  appId: "ir.salamatyar.app",
  appName: "سلامت‌یار",
  webDir: "dist",
  android: { allowMixedContent: false },
  server: url
    ? {
        url,
        // Shown from inside the app when the site can't be reached (no internet).
        errorPath: "offline.html",
        // "*" keeps the bank gateway page (address set in the admin panel) inside the app, so the
        // gateway's return to /api/ipg/callback lands back in the app instead of an external browser.
        allowNavigation: ["*"],
        // The test gateway uses plain http.
        cleartext: true,
      }
    : undefined,
  plugins: {
    LocalNotifications: { smallIcon: "ic_stat_icon_config_sample", iconColor: "#B23A48" },
  },
};

export default config;
