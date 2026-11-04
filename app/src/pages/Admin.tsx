import { useEffect, useState } from "react";
import { Bar, Card, Empty, ErrorBox, Page, Spinner, Tabs } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateTime, groupDigits, num, parseAmount, toman } from "../lib/format";
import { payLink, qrDataUrl } from "../lib/qr";
import { useApi } from "../lib/useApi";

type Doctor = { id: number; name: string; specialty: string; fee: number; active: boolean; balance: number; qr_token: string; payments_count: number; payments_total: number };
type Overview = {
  users: number; wallets_total: number; doctors: number; doctors_active: number; owed_to_doctors: number;
  payments: { count: number; total: number }; today: { count: number; total: number };
  series: { date: string; count: number; total: number }[]; top_doctors: { doctor: string; count: number; total: number }[];
};
type PayRow = { id: number; ref: string; amount: number; method: string; status: string; created_at: string; doctor: string; specialty: string; user: string; email: string;
  gateway_ref: string | null; gateway_rrn: string | null; message: string | null; verified: boolean | null };
type UserRow = { id: number; email: string; name: string; is_admin: boolean; wallet_balance: number; payments: number; created_at: string };
type Settings = { default_fee: number; initial_wallet: number; max_payment: number; ipg_enabled: boolean;
  ipg_payment_url: string; ipg_mid: string; ipg_rest_url: string; ipg_username: string; ipg_has_password: boolean;
  ipg_allow_unverified: boolean; ipg_amount_multiplier: number; ipg_language: string; public_url: string; ipg_can_verify: boolean };

type Tab = "report" | "doctors" | "payments" | "users" | "settings";

export default function Admin() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("report");
  if (!user?.is_admin) {
    return <Page title="پنل مدیریت" back><div className="alert danger">این بخش فقط برای مدیر سامانه است.</div></Page>;
  }
  return (
    <Page title="پنل مدیریت" wide>
      <Tabs value={tab} onChange={setTab} items={[["report", "📊 گزارش"], ["doctors", "🩺 پزشکان"], ["payments", "💳 پرداخت‌ها"], ["users", "👥 کاربران"], ["settings", "⚙️ تنظیمات"]]} />
      {tab === "report" && <Report />}
      {tab === "doctors" && <Doctors />}
      {tab === "payments" && <Payments />}
      {tab === "users" && <Users />}
      {tab === "settings" && <SettingsTab />}
    </Page>
  );
}

function Report() {
  const [days, setDays] = useState(30);
  const ov = useApi<Overview>("/api/admin/overview", { days, tz_offset: new Date().getTimezoneOffset() });
  if (ov.loading && !ov.data) return <Spinner />;
  if (!ov.data) return <ErrorBox error={ov.error} />;
  const d = ov.data;
  const max = Math.max(1, ...d.series.map((s) => s.total));
  return (
    <>
      <div className="row gap wrap">
        {[7, 30, 90, 365].map((n) => <button key={n} className={`btn small ${days === n ? "primary" : ""}`} onClick={() => setDays(n)}>{num(n)} روز</button>)}
      </div>
      <div className="stats">
        <Card><div className="muted small">پرداخت‌های امروز</div><div className="big">{toman(d.today.total)}</div><div className="small muted">{num(d.today.count)} ویزیت</div></Card>
        <Card><div className="muted small">پرداخت‌های {num(days)} روز</div><div className="big">{toman(d.payments.total)}</div><div className="small muted">{num(d.payments.count)} ویزیت</div></Card>
        <Card><div className="muted small">طلب پزشکان (تسویه‌نشده)</div><div className="big">{toman(d.owed_to_doctors)}</div><div className="small muted">{num(d.doctors_active)} پزشک فعال</div></Card>
        <Card><div className="muted small">کاربران</div><div className="big">{num(d.users)}</div><div className="small muted">موجودی کیف پول‌ها {toman(d.wallets_total)}</div></Card>
      </div>
      <Card title="مبلغ پرداخت‌ها در ۳۰ روز اخیر">
        <div className="bars" role="img" aria-label="نمودار پرداخت روزانه">
          {d.series.map((s) => (
            <div key={s.date} className="bar-col" title={`${s.date}: ${toman(s.total)} (${s.count})`}>
              <div className="bar-v" style={{ height: `${(100 * s.total) / max}%` }} />
            </div>
          ))}
        </div>
      </Card>
      <Card title="پزشکان برتر">
        {d.top_doctors.length === 0 && <Empty>هنوز پرداختی ثبت نشده است.</Empty>}
        <table>
          <tbody>
            {d.top_doctors.map((t) => (
              <tr key={t.doctor}><td>{t.doctor}</td><td>{num(t.count)} ویزیت</td><td style={{ width: "30%" }}><Bar value={t.total} max={d.top_doctors[0].total} /></td><td><b>{toman(t.total)}</b></td></tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function QrCard({ doctor, onClose }: { doctor: Doctor; onClose: () => void }) {
  const [img, setImg] = useState("");
  const link = payLink(doctor.qr_token);
  useEffect(() => {
    qrDataUrl(link).then(setImg);
  }, [link]);
  const print = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><title>${doctor.name}</title>
      <style>body{font-family:Vazirmatn,Tahoma,sans-serif;display:grid;place-items:center;min-height:95vh;margin:0}
      .c{border:3px solid #0f9d76;border-radius:24px;padding:28px 36px;text-align:center;width:320px}
      h1{margin:8px 0 2px;font-size:24px}p{margin:0;color:#555}img{width:260px;margin:18px 0 8px}.s{font-size:14px;color:#0f9d76;font-weight:bold}</style>
      </head><body><div class="c"><div class="s">پرداخت ویزیت با سلامت‌یار</div><h1>${doctor.name}</h1><p>${doctor.specialty}</p>
      <img src="${img}" alt=""><p>QR را با دوربین گوشی یا اپ سلامت‌یار اسکن کنید</p></div>
      <script>window.onload=()=>{window.print()}</script></body></html>`);
    w.document.close();
  };
  return (
    <div className="modal" onClick={onClose}>
      <div className="card center" style={{ maxWidth: 360, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="small" style={{ color: "var(--primary)", fontWeight: 800 }}>پرداخت ویزیت با سلامت‌یار</div>
        <h2 style={{ margin: "6px 0 0" }}>{doctor.name}</h2>
        <p className="muted" style={{ margin: 0 }}>{doctor.specialty}</p>
        {img ? <img src={img} alt="QR" style={{ width: "100%", maxWidth: 260, margin: "12px auto", display: "block" }} /> : <Spinner />}
        <div className="row gap">
          <button className="btn primary grow" onClick={print} disabled={!img}>🖨️ چاپ کارت</button>
          <a className="btn grow" href={img} download={`QR-${doctor.name}.png`}>⬇️ دانلود</a>
          <button className="btn" onClick={onClose}>بستن</button>
        </div>
      </div>
    </div>
  );
}

function Doctors() {
  const list = useApi<Doctor[]>("/api/admin/doctors");
  const [qr, setQr] = useState<Doctor | null>(null);
  const [edit, setEdit] = useState<Doctor | null>(null);
  const [form, setForm] = useState({ name: "", specialty: "", fee: "" });
  const [error, setError] = useState("");

  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
      list.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const body = { name: form.name, specialty: form.specialty, fee: form.fee ? parseAmount(form.fee) : undefined };
    run(async () => {
      if (edit) await api(`/api/admin/doctors/${edit.id}`, { method: "PATCH", body });
      else await api("/api/admin/doctors", { body });
      setEdit(null);
      setForm({ name: "", specialty: "", fee: "" });
    });
  };

  const startEdit = (d: Doctor) => {
    setEdit(d);
    setForm({ name: d.name, specialty: d.specialty, fee: groupDigits(d.fee) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const settle = (d: Doctor) => {
    const v = window.prompt(`مبلغ تسویه با ${d.name} (تومان). طلب فعلی: ${d.balance.toLocaleString("fa-IR")}`, String(d.balance));
    if (v === null) return;
    const amount = parseAmount(v);
    const note = window.prompt("توضیح (مثلاً شماره واریز):", "") ?? "";
    run(() => api(`/api/admin/doctors/${d.id}/settle`, { body: { amount, note } }));
  };

  return (
    <>
      <Card title={edit ? `ویرایش ${edit.name}` : "➕ افزودن پزشک"}>
        <form className="grid3 form-grid" onSubmit={save}>
          <input required placeholder="نام (مثلاً دکتر ...)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input placeholder="تخصص" value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} />
          <input inputMode="numeric" placeholder="مبلغ پیش‌فرض ویزیت (تومان)" value={form.fee} onChange={(e) => setForm({ ...form, fee: groupDigits(parseAmount(e.target.value)) })} />
          <div className="row gap">
            <button className="btn primary grow">{edit ? "ذخیره" : "افزودن"}</button>
            {edit && <button type="button" className="btn" onClick={() => { setEdit(null); setForm({ name: "", specialty: "", fee: "" }); }}>انصراف</button>}
          </div>
        </form>
        <ErrorBox error={error} />
      </Card>
      {list.loading && <Spinner />}
      <div className="doc-grid">
        {list.data?.map((d) => (
          <Card key={d.id} className={d.active ? "" : "inactive"}>
            <div className="row between">
              <div>
                <b>{d.name}</b> {!d.active && <span className="badge medium">غیرفعال</span>}
                <div className="muted small">{d.specialty}</div>
              </div>
              <button className="btn small primary" onClick={() => setQr(d)}>QR</button>
            </div>
            <table className="small" style={{ margin: "8px 0" }}>
              <tbody>
                <tr><td className="muted">مبلغ پیش‌فرض</td><td>{toman(d.fee)}</td></tr>
                <tr><td className="muted">پرداخت‌ها</td><td>{num(d.payments_count)} · {toman(d.payments_total)}</td></tr>
                <tr><td className="muted">طلب (تسویه‌نشده)</td><td><b>{toman(d.balance)}</b></td></tr>
              </tbody>
            </table>
            <div className="row gap wrap">
              <button className="btn small" onClick={() => startEdit(d)}>✏️ ویرایش</button>
              <button className="btn small" disabled={d.balance <= 0} onClick={() => settle(d)}>💰 تسویه</button>
              <button className="btn small" onClick={() => run(() => api(`/api/admin/doctors/${d.id}`, { method: "PATCH", body: { active: !d.active } }))}>
                {d.active ? "غیرفعال کردن" : "فعال کردن"}
              </button>
              <button className="btn small ghost" onClick={() => window.confirm("QR فعلی باطل و QR جدید ساخته شود؟ کارت‌های چاپ‌شده قبلی دیگر کار نمی‌کنند.") && run(() => api(`/api/admin/doctors/${d.id}/new-qr`, { body: {} }))}>
                🔄 QR جدید
              </button>
            </div>
          </Card>
        ))}
      </div>
      {qr && <QrCard doctor={qr} onClose={() => setQr(null)} />}
    </>
  );
}

function toCsv(rows: PayRow[]) {
  const head = ["کد پیگیری", "تاریخ", "پزشک", "تخصص", "بیمار", "ایمیل", "مبلغ (تومان)", "روش", "وضعیت", "کد پیگیری بانک", "RRN"];
  const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [r.ref, new Date(r.created_at.endsWith("Z") ? r.created_at : r.created_at + "Z").toLocaleString("fa-IR"), r.doctor, r.specialty, r.user, r.email, r.amount, r.method === "wallet" ? "کیف پول" : "درگاه", r.status, r.gateway_ref ?? "", r.gateway_rrn ?? ""].map(esc).join(","));
  return "﻿" + [head.map(esc).join(","), ...lines].join("\n");
}

function Payments() {
  const doctors = useApi<Doctor[]>("/api/admin/doctors");
  const [doctorId, setDoctorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query: Record<string, string> = {};
  if (doctorId) query.doctor_id = doctorId;
  if (from) query.from = new Date(from + "T00:00:00").toISOString();
  if (to) query.to = new Date(to + "T23:59:59").toISOString();
  const pays = useApi<{ items: PayRow[]; count: number; total: number }>("/api/admin/payments", query);

  const exportCsv = () => {
    if (!pays.data) return;
    const url = URL.createObjectURL(new Blob([toCsv(pays.data.items)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `payments-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Card>
        <div className="grid3 form-grid">
          <label className="field">پزشک
            <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">همه پزشکان</option>
              {doctors.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label className="field">از تاریخ<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="field">تا تاریخ<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
      </Card>
      {pays.data && (
        <div className="row between wrap gap">
          <span><b>{num(pays.data.count)}</b> پرداخت · جمع <b>{toman(pays.data.total)}</b></span>
          <button className="btn small" onClick={exportCsv} disabled={!pays.data.items.length}>⬇️ خروجی Excel (CSV)</button>
        </div>
      )}
      {pays.loading && <Spinner />}
      <Card>
        {pays.data?.items.length === 0 && <Empty>پرداختی پیدا نشد.</Empty>}
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>زمان</th><th>پزشک</th><th>بیمار</th><th>مبلغ</th><th>روش</th><th>وضعیت</th><th>کد پیگیری</th></tr></thead>
            <tbody>
              {pays.data?.items.map((p) => (
                <tr key={p.id}>
                  <td className="small">{dateTime(p.created_at)}</td>
                  <td>{p.doctor}</td>
                  <td>{p.user}<div className="muted small ltr">{p.email}</div></td>
                  <td><b>{toman(p.amount)}</b></td>
                  <td>{p.method === "wallet" ? "کیف پول" : "درگاه"}</td>
                  <td>
                    <span className={`badge ${p.status === "paid" ? "ok" : p.status === "pending" ? "medium" : "high"}`}>
                      {p.status === "paid" ? "موفق" : p.status === "pending" ? "در انتظار" : "ناموفق"}
                    </span>
                    {p.method === "ipg" && p.status === "paid" && p.verified === false && <span className="badge medium" title="بدون Verify سمت سرور">تأییدنشده</span>}
                    {p.message && p.status !== "paid" && <div className="muted small">{p.message}</div>}
                    {p.method === "ipg" && p.status === "pending" && p.gateway_ref && (
                      <button className="btn small ghost" onClick={() => api(`/api/admin/payments/${p.id}/recheck`, { body: {} }).then(() => pays.reload())}>🔄 استعلام مجدد</button>
                    )}
                  </td>
                  <td className="ltr small">{p.ref}{p.gateway_ref && <div className="muted">{p.gateway_ref}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function Users() {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const users = useApi<UserRow[]>("/api/admin/users", { q: search });
  const [error, setError] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
      users.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const adjust = (u: UserRow) => {
    const v = window.prompt(`تغییر موجودی ${u.email} (تومان). برای کسر، منفی وارد کنید. موجودی فعلی: ${u.wallet_balance.toLocaleString("fa-IR")}`, "");
    if (!v) return;
    const neg = /^\s*[-−]/.test(v);
    const amount = parseAmount(v) * (neg ? -1 : 1);
    if (!amount) return;
    const note = window.prompt("توضیح:", "") ?? "";
    run(() => api(`/api/admin/users/${u.id}/wallet`, { body: { amount, note } }));
  };

  return (
    <>
      <input placeholder="جستجوی ایمیل یا نام…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorBox error={error} />
      {users.loading && <Spinner />}
      <Card>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>کاربر</th><th>موجودی کیف پول</th><th>پرداخت‌ها</th><th>عضویت</th><th></th></tr></thead>
            <tbody>
              {users.data?.map((u) => (
                <tr key={u.id}>
                  <td>{u.name || "—"} {u.is_admin && <span className="badge ok">مدیر</span>}<div className="muted small ltr">{u.email}</div></td>
                  <td><b>{toman(u.wallet_balance)}</b></td>
                  <td>{num(u.payments)}</td>
                  <td className="small">{dateTime(u.created_at)}</td>
                  <td>
                    <div className="row gap wrap">
                      <button className="btn small" onClick={() => adjust(u)}>👛 شارژ / کسر</button>
                      <button className="btn small ghost" onClick={() => window.confirm(u.is_admin ? "دسترسی مدیریت برداشته شود؟" : "این کاربر مدیر شود؟") && run(() => api(`/api/admin/users/${u.id}/role`, { body: { is_admin: !u.is_admin } }))}>
                        {u.is_admin ? "حذف مدیر" : "مدیر کردن"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function SettingsTab() {
  const s = useApi<Settings>("/api/admin/settings");
  const [form, setForm] = useState({ default_fee: "", initial_wallet: "", max_payment: "" });
  const [applyAll, setApplyAll] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (s.data) setForm({ default_fee: groupDigits(s.data.default_fee), initial_wallet: groupDigits(s.data.initial_wallet), max_payment: groupDigits(s.data.max_payment) });
  }, [s.data]);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: groupDigits(parseAmount(e.target.value)) });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMsg("");
    try {
      await api("/api/admin/settings", { method: "PUT", body: {
        default_fee: parseAmount(form.default_fee), initial_wallet: parseAmount(form.initial_wallet),
        max_payment: parseAmount(form.max_payment), apply_fee_to_all: applyAll } });
      setMsg("ذخیره شد ✅");
      s.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <Card title="پرداخت و کیف پول">
        <form className="col" onSubmit={save}>
          <label className="field">مبلغ پیش‌فرض ویزیت برای پزشکان جدید (تومان)<input inputMode="numeric" value={form.default_fee} onChange={set("default_fee")} /></label>
          <label className="row gap small"><input type="checkbox" style={{ width: "auto", minHeight: 0 }} checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} /> این مبلغ برای همه پزشکان فعلی هم اعمال شود</label>
          <label className="field">شارژ اولیه کیف پول کاربران جدید (تومان)<input inputMode="numeric" value={form.initial_wallet} onChange={set("initial_wallet")} /></label>
          <label className="field">سقف هر پرداخت (تومان)<input inputMode="numeric" value={form.max_payment} onChange={set("max_payment")} /></label>
          <ErrorBox error={error} />
          <button className="btn primary">ذخیره تنظیمات</button>
          {msg && <p className="small">{msg}</p>}
        </form>
      </Card>
      <IpgSettings data={s.data} onSaved={s.reload} />
    </>
  );
}

function IpgSettings({ data, onSaved }: { data: Settings | null; onSaved: () => void }) {
  const [f, setF] = useState({ ipg_enabled: false, ipg_payment_url: "", ipg_mid: "", ipg_rest_url: "", ipg_username: "", ipg_password: "",
    ipg_allow_unverified: true, ipg_amount_multiplier: "10", ipg_language: "fa", public_url: "" });
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (data) setF({ ipg_enabled: data.ipg_enabled, ipg_payment_url: data.ipg_payment_url, ipg_mid: data.ipg_mid, ipg_rest_url: data.ipg_rest_url,
      ipg_username: data.ipg_username, ipg_password: "", ipg_allow_unverified: data.ipg_allow_unverified,
      ipg_amount_multiplier: String(data.ipg_amount_multiplier), ipg_language: data.ipg_language, public_url: data.public_url });
  }, [data]);
  const text = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const check = (k: "ipg_enabled" | "ipg_allow_unverified") => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.checked });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg("");
    setError("");
    try {
      await api("/api/admin/settings", { method: "PUT", body: { ...f, ipg_amount_multiplier: Number(f.ipg_amount_multiplier) || 10 } });
      setMsg("ذخیره شد ✅");
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const cb = { width: "auto", minHeight: 0 } as const;
  return (
    <Card title="💳 درگاه پرداخت بانکی (IPG)">
      <form className="col" onSubmit={save}>
        <label className="row gap"><input type="checkbox" style={cb} checked={f.ipg_enabled} onChange={check("ipg_enabled")} /> <b>درگاه بانکی فعال باشد</b></label>
        <div className="grid2 form-grid">
          <label className="field">آدرس صفحه پرداخت درگاه<input dir="ltr" value={f.ipg_payment_url} onChange={text("ipg_payment_url")} placeholder="http://…/_ipgw_//payment/simple/" /></label>
          <label className="field">کد پذیرنده (MID)<input dir="ltr" value={f.ipg_mid} onChange={text("ipg_mid")} /></label>
          <label className="field">آدرس سرویس‌های REST (Verify)<input dir="ltr" value={f.ipg_rest_url} onChange={text("ipg_rest_url")} placeholder="http://…/RestServices/mts" /></label>
          <label className="field">نام کاربری پذیرنده<input dir="ltr" value={f.ipg_username} onChange={text("ipg_username")} autoComplete="off" /></label>
          <label className="field">رمز پذیرنده<input dir="ltr" type="password" value={f.ipg_password} onChange={text("ipg_password")} autoComplete="new-password"
            placeholder={data?.ipg_has_password ? "•••••• (برای تغییر وارد کنید)" : ""} /></label>
          <label className="field">ضریب مبلغ (تومان ← ریال)<input dir="ltr" inputMode="numeric" value={f.ipg_amount_multiplier} onChange={text("ipg_amount_multiplier")} /></label>
          <label className="field">زبان صفحه درگاه
            <select value={f.ipg_language} onChange={text("ipg_language")}><option value="fa">فارسی</option><option value="en">English</option></select>
          </label>
          <label className="field">آدرس عمومی سایت (برای بازگشت از درگاه)<input dir="ltr" value={f.public_url} onChange={text("public_url")} placeholder="خالی = خودکار" /></label>
        </div>
        <label className="row gap small"><input type="checkbox" style={cb} checked={f.ipg_allow_unverified} onChange={check("ipg_allow_unverified")} />
          اگر سرویس Verify تنظیم نشده، پاسخ «OK» درگاه پذیرفته شود (فقط برای تست)</label>
        {data && !data.ipg_can_verify && (
          <div className="alert warn small">تأیید سمت سرور (MerchantLogin + VerifyMerchantTrans) تنظیم نشده است. برای استفاده واقعی آدرس REST، نام کاربری و رمز را وارد کنید.</div>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          آدرس بازگشت برای درگاه: <span className="ltr">{(f.public_url || window.location.origin) + "/api/ipg/callback"}</span>
        </p>
        <ErrorBox error={error} />
        <button className="btn primary">ذخیره تنظیمات درگاه</button>
        {msg && <p className="small">{msg}</p>}
      </form>
    </Card>
  );
}
