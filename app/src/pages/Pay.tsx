import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, CreditCard, Stethoscope, Wallet as WalletIcon } from "lucide-react";
import { Card, ErrorBox, IconChip, Page, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateTime, groupDigits, parseAmount, toman } from "../lib/format";
import { useApi } from "../lib/useApi";

type Info = { name: string; specialty: string; fee: number; wallet_balance: number; ipg_enabled: boolean; max_payment: number };
type Receipt = { id: number; ref: string; amount: number; doctor: string; specialty: string; created_at: string; wallet_balance: number };

/** Posts the gateway form (MID, resNum, Amount, redirectURL, …) by a normal page navigation. */
function submitToGateway(action: string, fields: Record<string, string>) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = action;
  form.style.display = "none";
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

export default function Pay() {
  const { token = "" } = useParams();
  const nav = useNavigate();
  const { refresh } = useAuth();
  const info = useApi<Info>(`/api/pay/doctors/${encodeURIComponent(token)}`);
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);
  const [method, setMethod] = useState<"wallet" | "ipg">("wallet");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const fee = info.data?.fee ?? 0;
  useEffect(() => {
    if (info.data && !touched) setText(groupDigits(info.data.fee));
  }, [info.data, touched]);

  // The default fee stays unless the user types; the first keystroke replaces it entirely.
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value;
    if (!touched) {
      const def = groupDigits(fee);
      raw = raw.startsWith(def) ? raw.slice(def.length) : raw.endsWith(def) ? raw.slice(0, -def.length) : raw.replace(def, "");
      setTouched(true);
    }
    setText(groupDigits(parseAmount(raw)));
  };

  const amount = touched ? parseAmount(text) : fee;
  const balance = info.data?.wallet_balance ?? 0;
  const tooLow = amount < 1000;
  const noMoney = method === "wallet" && amount > balance;
  const payLabel = busy ? (method === "ipg" ? "در حال انتقال به درگاه…" : "در حال پرداخت…") : method === "ipg" ? `پرداخت ${toman(amount)} با کارت بانکی` : `پرداخت ${toman(amount)}`;

  const pay = async () => {
    setBusy(true);
    setError("");
    try {
      if (method === "ipg") {
        // The server creates a pending payment and returns the form for the bank gateway page.
        const g = await api<{ action: string; fields: Record<string, string> }>("/api/pay", { body: { token, amount, method } });
        submitToGateway(g.action, g.fields);
        return; // the page now leaves for the gateway
      }
      const r = await api<Receipt>("/api/pay", { body: { token, amount, method } });
      setReceipt(r);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (receipt) {
    return (
      <Page title="رسید پرداخت">
        <Card className="center">
          <div style={{ display: "grid", placeItems: "center", marginBottom: 6 }}><IconChip icon={CheckCircle2} tone="green" size="lg" /></div>
          <h2>پرداخت موفق</h2>
          <div className="big" style={{ margin: "8px 0" }}>{toman(receipt.amount)}</div>
          <table style={{ marginTop: 10 }}>
            <tbody>
              <tr><td className="muted">پزشک</td><td>{receipt.doctor}</td></tr>
              <tr><td className="muted">تخصص</td><td>{receipt.specialty}</td></tr>
              <tr><td className="muted">کد پیگیری</td><td className="ltr">{receipt.ref}</td></tr>
              <tr><td className="muted">زمان</td><td>{dateTime(receipt.created_at)}</td></tr>
              <tr><td className="muted">روش</td><td>کیف پول</td></tr>
              <tr><td className="muted">موجودی باقی‌مانده</td><td>{toman(receipt.wallet_balance)}</td></tr>
            </tbody>
          </table>
          <div className="row gap" style={{ marginTop: 14 }}>
            <Link to="/wallet" className="btn grow">گزارش پرداخت‌ها</Link>
            <button className="btn primary grow" onClick={() => nav("/", { replace: true })}>بازگشت به خانه</button>
          </div>
        </Card>
      </Page>
    );
  }

  return (
    <Page title="پرداخت ویزیت" back>
      {info.loading && <Spinner />}
      <ErrorBox error={info.error} />
      {info.data && (
        <>
          <Card className="center">
            <div className="doc-avatar"><Stethoscope size={36} /></div>
            <h2 style={{ fontSize: "1.3rem" }}>{info.data.name}</h2>
            <p className="muted" style={{ margin: 0 }}>{info.data.specialty}</p>
          </Card>

          <Card title="مبلغ ویزیت (تومان)">
            <input
              ref={input}
              className="amount-input"
              inputMode="numeric"
              autoComplete="off"
              value={text}
              onChange={onChange}
              onFocus={(e) => { if (!touched) e.target.select(); }}
              aria-label="مبلغ به تومان"
            />
            <p className="muted small" style={{ margin: "6px 0 0" }}>
              {touched ? `${toman(amount)}` : "برای مبلغ دیگر، عدد جدید را تایپ کنید."}
            </p>
          </Card>

          <Card title="روش پرداخت">
            <label className={`pay-method ${method === "wallet" ? "active" : ""}`}>
              <input type="radio" name="m" checked={method === "wallet"} onChange={() => setMethod("wallet")} />
              <span className="grow">
                <b className="row gap-s"><WalletIcon size={18} /> کیف پول</b>
                <div className="small muted">موجودی: {toman(balance)}</div>
              </span>
            </label>
            <label className={`pay-method ${info.data.ipg_enabled ? "" : "disabled"}`}>
              <input type="radio" name="m" disabled={!info.data.ipg_enabled} checked={method === "ipg"} onChange={() => setMethod("ipg")} />
              <span className="grow">
                <b className="row gap-s"><CreditCard size={18} /> درگاه بانکی</b>
                <div className="small muted">پرداخت با کارت بانکی</div>
              </span>
              {!info.data.ipg_enabled && <span className="badge medium">به‌زودی</span>}
            </label>
          </Card>

          <ErrorBox error={error} />
          {noMoney && <div className="alert warn small">موجودی کیف پول برای این مبلغ کافی نیست.</div>}
          <button className="btn primary" style={{ minHeight: 54, fontSize: "1.05rem" }} disabled={busy || tooLow || noMoney} onClick={pay}>
            {payLabel}
          </button>
        </>
      )}
    </Page>
  );
}
