import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, Empty, Page, Spinner, Tabs } from "../components/ui";
import { dateTime, num, toman } from "../lib/format";
import { useApi } from "../lib/useApi";

type Pay = { id: number; ref: string; amount: number; doctor: string; specialty: string; status: string; method: string; created_at: string };
const STATUS_FA: Record<string, [string, string]> = { pending: ["در انتظار تأیید", "medium"], failed: ["ناموفق", "high"] };
type Report = { items: Pay[]; count: number; total: number; by_doctor: { doctor: string; specialty: string; count: number; total: number }[]; wallet_balance: number };
type Txn = { id: number; amount: number; kind: string; note: string; balance_after: number; created_at: string };
const KIND = { initial: "شارژ اولیه", payment: "پرداخت ویزیت", admin: "تنظیم مدیر" } as Record<string, string>;
const PERIODS: [string, number][] = [["۷ روز", 7], ["۳۰ روز", 30], ["۳ ماه", 90], ["همه", 3650]];

export default function Wallet() {
  const [tab, setTab] = useState<"report" | "txns">("report");
  const [days, setDays] = useState(30);
  const rep = useApi<Report>("/api/payments", { days });
  const wallet = useApi<{ balance: number; transactions: Txn[] }>(tab === "txns" ? "/api/wallet" : null);

  return (
    <Page title="کیف پول و گزارش‌ها" back>
      <Card className="wallet-card">
        <div className="small" style={{ opacity: 0.85 }}>موجودی کیف پول</div>
        <div className="big">{toman(rep.data?.wallet_balance ?? wallet.data?.balance)}</div>
        <Link to="/scan" className="btn" style={{ marginTop: 10, background: "#fff", color: "var(--primary)", borderColor: "#fff" }}>پرداخت ویزیت با اسکن QR</Link>
      </Card>
      <Tabs value={tab} onChange={setTab} items={[["report", "گزارش پرداخت‌ها"], ["txns", "تراکنش‌های کیف پول"]]} />

      {tab === "report" && (
        <>
          <div className="row gap wrap">
            {PERIODS.map(([label, d]) => (
              <button key={d} className={`btn small ${days === d ? "primary" : ""}`} onClick={() => setDays(d)}>{label}</button>
            ))}
          </div>
          {rep.loading && <Spinner />}
          {rep.data && (
            <>
              <div className="grid2">
                <Card><div className="muted small">تعداد ویزیت‌ها</div><div className="big">{num(rep.data.count)}</div></Card>
                <Card><div className="muted small">جمع پرداخت‌ها</div><div className="big" style={{ fontSize: "1.3rem" }}>{toman(rep.data.total)}</div></Card>
              </div>
              {rep.data.by_doctor.length > 0 && (
                <Card title="به تفکیک پزشک">
                  <ul className="list">
                    {rep.data.by_doctor.map((d) => (
                      <li key={d.doctor}>
                        <span className="grow">{d.doctor}<div className="muted small">{d.specialty} · {num(d.count)} ویزیت</div></span>
                        <b>{toman(d.total)}</b>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              <Card title="پرداخت‌ها">
                {rep.data.items.length === 0 && <Empty>در این بازه پرداختی ثبت نشده است.</Empty>}
                <ul className="list">
                  {rep.data.items.map((p) => (
                    <li key={p.id}>
                      <Link to={`/pay/result/${p.id}`} className="grow" style={{ color: "inherit" }}>
                        {p.doctor} {STATUS_FA[p.status] && <span className={`badge ${STATUS_FA[p.status][1]}`}>{STATUS_FA[p.status][0]}</span>}
                        <div className="muted small">{dateTime(p.created_at)} · {p.method === "ipg" ? "درگاه بانکی" : "کیف پول"} · <span className="ltr">{p.ref}</span></div>
                      </Link>
                      <b>{toman(p.amount)}</b>
                    </li>
                  ))}
                </ul>
              </Card>
            </>
          )}
        </>
      )}

      {tab === "txns" && (
        <Card>
          {wallet.loading && <Spinner />}
          <ul className="list">
            {wallet.data?.transactions.map((t) => (
              <li key={t.id}>
                <span className="grow">
                  {KIND[t.kind] ?? t.kind}{t.note && t.kind !== "initial" ? ` — ${t.note}` : ""}
                  <div className="muted small">{dateTime(t.created_at)} · مانده {toman(t.balance_after)}</div>
                </span>
                <b style={{ color: t.amount < 0 ? "var(--danger)" : "var(--ok)" }} className="ltr">{t.amount > 0 ? "+" : "−"}{num(Math.abs(t.amount))}</b>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Page>
  );
}
