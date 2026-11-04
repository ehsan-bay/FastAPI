import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, Page, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateTime, toman } from "../lib/format";

type P = { id: number; ref: string; amount: number; method: string; status: "paid" | "failed" | "pending"; created_at: string;
  doctor: string; specialty: string; gateway_ref: string | null; gateway_rrn: string | null; message: string | null; verified: boolean | null };

/** Where the bank gateway sends the user back (via /api/ipg/callback). */
export default function PayResult() {
  const { id = "0" } = useParams();
  const { refresh } = useAuth();
  const [p, setP] = useState<P | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (id === "0") {
      setError("پاسخ درگاه به هیچ پرداختی مربوط نبود.");
      return;
    }
    let tries = 0;
    let timer = 0;
    const load = async () => {
      try {
        const r = await api<P>(`/api/payments/${id}`);
        setP(r);
        if (r.status === "pending" && tries++ < 10) timer = window.setTimeout(load, 3000);
        else refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    };
    load();
    return () => window.clearTimeout(timer);
  }, [id, refresh]);

  const icon = p?.status === "paid" ? "✅" : p?.status === "failed" ? "❌" : "⏳";
  const title = p?.status === "paid" ? "پرداخت موفق" : p?.status === "failed" ? "پرداخت ناموفق" : "در انتظار تأیید بانک";

  return (
    <Page title="نتیجه پرداخت">
      {!p && !error && <Spinner text="در حال دریافت نتیجه از درگاه…" />}
      {error && <div className="alert danger">{error}</div>}
      {p && (
        <Card className="center">
          <div style={{ fontSize: "3rem" }}>{icon}</div>
          <h2>{title}</h2>
          <div className="big" style={{ margin: "8px 0" }}>{toman(p.amount)}</div>
          {p.message && <p className={`small ${p.status === "paid" ? "muted" : ""}`} style={{ margin: "0 0 8px" }}>{p.message}</p>}
          <table style={{ marginTop: 6 }}>
            <tbody>
              <tr><td className="muted">پزشک</td><td>{p.doctor}</td></tr>
              <tr><td className="muted">روش</td><td>{p.method === "ipg" ? "درگاه بانکی" : "کیف پول"}</td></tr>
              <tr><td className="muted">شماره فاکتور</td><td className="ltr">{p.ref}</td></tr>
              {p.gateway_ref && <tr><td className="muted">کد پیگیری بانک</td><td className="ltr">{p.gateway_ref}</td></tr>}
              {p.gateway_rrn && <tr><td className="muted">شماره مرجع (RRN)</td><td className="ltr">{p.gateway_rrn}</td></tr>}
              <tr><td className="muted">زمان</td><td>{dateTime(p.created_at)}</td></tr>
            </tbody>
          </table>
          {p.status === "pending" && <p className="small muted">نتیجه به‌زودی به‌روز می‌شود. اگر مبلغی از حساب شما کم شده و تأیید نشد، طبق قوانین شاپرک ظرف ۷۲ ساعت برمی‌گردد.</p>}
          <div className="row gap" style={{ marginTop: 14 }}>
            <Link to="/wallet" className="btn grow">گزارش پرداخت‌ها</Link>
            <Link to="/" className="btn primary grow">بازگشت به خانه</Link>
          </div>
        </Card>
      )}
    </Page>
  );
}
