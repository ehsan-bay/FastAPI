import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "ir.salamatyar.app",
  appName: "سلامت‌یار",
  webDir: "dist",
  android: { allowMixedContent: false },
  plugins: {
    LocalNotifications: { smallIcon: "ic_stat_icon_config_sample", iconColor: "#0f9d76" },
  },
};

export default config;
