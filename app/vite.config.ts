import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const API = process.env.API_PROXY ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "سلامت‌یار هوشمند",
        short_name: "سلامت‌یار",
        description: "دستیار سلامت با هوش مصنوعی: تغذیه، ورزش، خواب، پوست، آزمایش، سلامت روان",
        lang: "fa",
        dir: "rtl",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#f4f7f6",
        theme_color: "#0f9d76",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        globIgnores: ["mediapipe/**"],
        navigateFallbackDenylist: [/^\/api\//, /^\/models\//, /^\/docs/],
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
        runtimeCaching: [
          {
            // WASM runtimes and on-device models: cache after first use for offline.
            urlPattern: ({ url }) => url.pathname.startsWith("/mediapipe/") || url.pathname.startsWith("/models/"),
            handler: "CacheFirst",
            options: { cacheName: "ai-models", expiration: { maxEntries: 30 } },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/food/search"),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "api-static" },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: { "/api": API, "/models": API },
  },
  build: { chunkSizeWarningLimit: 1500 },
});
