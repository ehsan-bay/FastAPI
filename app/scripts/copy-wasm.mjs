// Copies MediaPipe WASM runtimes into public/ so on-device AI works offline (no CDN).
import { cpSync, existsSync, mkdirSync } from "node:fs";

for (const [pkg, dir] of [["tasks-vision", "vision"], ["tasks-audio", "audio"]]) {
  const src = `node_modules/@mediapipe/${pkg}/wasm`;
  if (!existsSync(src)) continue;
  mkdirSync(`public/mediapipe/${dir}`, { recursive: true });
  cpSync(src, `public/mediapipe/${dir}`, { recursive: true });
}
console.log("MediaPipe wasm copied to public/mediapipe");
