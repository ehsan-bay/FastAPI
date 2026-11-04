import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, ErrorBox, Page } from "../components/ui";
import { makeQrReader, tokenFromQr } from "../lib/qr";

export default function Scan() {
  const nav = useNavigate();
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [manual, setManual] = useState("");
  const [hint, setHint] = useState("QR روی میز پزشک را در کادر قرار دهید");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (stopped) return;
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        const read = makeQrReader(v);
        const tick = async () => {
          if (stopped) return;
          const text = await read();
          if (text) {
            const token = tokenFromQr(text);
            if (token) {
              stopped = true;
              nav(`/pay/${token}`, { replace: true });
              return;
            }
            setHint("این QR مربوط به پرداخت ویزیت نیست");
          }
          timer = window.setTimeout(tick, 250);
        };
        tick();
      } catch (e) {
        const err = e as Error;
        setError(err.name === "NotAllowedError" ? "اجازه دسترسی به دوربین داده نشد." : "دوربین در دسترس نیست. کد را دستی وارد کنید.");
      }
    })();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [nav]);

  const goManual = (e: React.FormEvent) => {
    e.preventDefault();
    const token = tokenFromQr(manual);
    if (token) nav(`/pay/${token}`);
    else setError("کد وارد شده معتبر نیست");
  };

  return (
    <Page title="پرداخت ویزیت" back>
      <div className="video-wrap rear" style={{ aspectRatio: "1 / 1" }}>
        <video ref={video} playsInline muted />
        <div className="scan-frame" />
        <div className="hud" style={{ justifyContent: "center" }}><span>{hint}</span></div>
      </div>
      <ErrorBox error={error} />
      <Card title="ورود دستی کد">
        <form className="row gap" onSubmit={goManual}>
          <input dir="ltr" placeholder="لینک یا کد زیر QR" value={manual} onChange={(e) => setManual(e.target.value)} />
          <button className="btn primary">ادامه</button>
        </form>
      </Card>
    </Page>
  );
}
