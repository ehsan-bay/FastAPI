// QR helpers: generate payment QR codes (admin) and read them with the camera (patient).
import QRCode from "qrcode";
import jsQR from "jsqr";
import { serverUrl } from "./api";

/** Link encoded in a doctor's QR. Opening it with any phone camera goes to the payment page. */
export function payLink(token: string) {
  const base = serverUrl() || window.location.origin;
  return `${base}/pay/${token}`;
}

export function qrDataUrl(text: string, size = 512) {
  return QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: "M", color: { dark: "#052e25", light: "#ffffff" } });
}

/** Extract the doctor token from a scanned QR (a /pay/<token> link or the bare token). */
export function tokenFromQr(text: string): string | null {
  const m = text.trim().match(/\/pay\/([A-Za-z0-9_-]{4,40})\/?(?:[?#].*)?$/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{8,40}$/.test(text.trim()) ? text.trim() : null;
}

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

/** Returns a function that reads a QR from the current video frame (native BarcodeDetector when available). */
export function makeQrReader(video: HTMLVideoElement) {
  const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
  const detector = BD ? new BD({ formats: ["qr_code"] }) : null;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  return async (): Promise<string | null> => {
    if (video.readyState < 2) return null;
    if (detector) {
      try {
        const found = await detector.detect(video);
        if (found[0]?.rawValue) return found[0].rawValue;
        return null;
      } catch {
        /* fall back to jsQR below */
      }
    }
    const w = Math.min(640, video.videoWidth);
    const h = Math.round((video.videoHeight / video.videoWidth) * w);
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
    return code?.data ?? null;
  };
}
