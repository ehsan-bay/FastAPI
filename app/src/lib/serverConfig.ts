import { Capacitor, registerPlugin } from "@capacitor/core";

/** Native plugin (android/app/src/main/java/ir/salamatyar/app/ServerConfigPlugin.java). */
type ServerConfigPlugin = {
  get(): Promise<{ url: string; defaultUrl: string; custom: boolean }>;
  /** Checks <url>/api/health, saves the address and restarts the app on it. */
  set(opts: { url: string; skipCheck?: boolean }): Promise<void>;
  /** Back to the address built into the app. */
  reset(): Promise<void>;
};

export const ServerConfig = registerPlugin<ServerConfigPlugin>("ServerConfig");

/** True in an APK new enough to have the plugin (older APKs keep their built-in address). */
export const canChangeServer = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("ServerConfig");
