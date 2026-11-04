import { Capacitor } from "@capacitor/core";

const KEY_SERVER = "salamat.server";
const KEY_TOKEN = "salamat.token";

function store(key: string, value?: string | null): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage can be unavailable (private mode); app still works for this session */
  }
  return value ?? null;
}

/** Server base URL. Web/PWA build uses the same origin; native apps need a full URL. */
export function serverUrl(): string {
  const saved = store(KEY_SERVER);
  if (saved) return saved.replace(/\/+$/, "");
  // The web/PWA build talks to the server it was loaded from. Native apps have no such
  // origin, so they use the build-time default (app/.env.production) unless changed in Settings.
  if (!Capacitor.isNativePlatform()) return "";
  const env = import.meta.env.VITE_API_URL as string | undefined;
  return env ? env.replace(/\/+$/, "") : "";
}

export function setServerUrl(url: string) {
  store(KEY_SERVER, url.trim() ? url.trim() : null);
}

export const needsServerSetup = () => Capacitor.isNativePlatform() && !serverUrl();
export const modelUrl = (file: string) => `${serverUrl()}/models/${file}`;

export const getToken = () => store(KEY_TOKEN);
export const setToken = (t: string | null) => store(KEY_TOKEN, t);

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Body = Record<string, unknown> | unknown[] | FormData | undefined;

export async function api<T = any>(path: string, opts: { method?: string; body?: Body; query?: Record<string, any> } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const qs = opts.query
    ? "?" + new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]))
    : "";
  let res: Response;
  try {
    res = await fetch(`${serverUrl()}${path}${qs}`, { method: opts.method ?? (body ? "POST" : "GET"), headers, body });
  } catch {
    throw new ApiError(0, "اتصال به سرور برقرار نشد. اینترنت یا آدرس سرور را بررسی کنید.");
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && token) {
      setToken(null);
      window.dispatchEvent(new Event("salamat:logout"));
    }
    const msg = typeof data === "object" && data?.detail ? (typeof data.detail === "string" ? data.detail : "خطا در درخواست") : `خطای سرور (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export function upload<T = any>(path: string, file: Blob, fields: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append("file", file, (file as File).name ?? "image.jpg");
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return api<T>(path, { body: fd });
}

/** Shrink big camera photos before upload (faster on mobile data). */
export async function shrinkImage(file: File, max = 1600): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5e6) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.88));
  } catch {
    return file;
  }
}
