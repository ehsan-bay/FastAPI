import { useEffect, useState } from "react";
import { Card, Empty, ErrorBox, Page, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { num } from "../lib/format";
import { requestPermission, scheduleReminders, type Med } from "../lib/reminders";
import { useApi } from "../lib/useApi";

type MedRow = Med & { notes: string; today: { status: string; at: string }[] };

export default function Meds() {
  const meds = useApi<MedRow[]>("/api/meds");
  const adherence = useApi<{ percent: number | null; taken: number; expected: number }>("/api/meds/adherence", { days: 7 });
  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const [times, setTimes] = useState<string[]>(["08:00"]);
  const [error, setError] = useState("");
  const [notif, setNotif] = useState<string>("");

  useEffect(() => {
    if (meds.data) scheduleReminders(meds.data).catch(() => {});
  }, [meds.data]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api("/api/meds", { body: { name, dose, times } });
      setName("");
      setDose("");
      setTimes(["08:00"]);
      meds.reload();
      if (await requestPermission()) setNotif("یادآورها فعال شد ✅");
      else setNotif("اجازه اعلان داده نشد؛ یادآورها نمایش داده نمی‌شوند.");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const log = async (id: number, status: "taken" | "skipped") => {
    await api(`/api/meds/${id}/log`, { body: { status } });
    meds.reload();
    adherence.reload();
  };

  const remove = async (id: number) => {
    if (!confirm("این دارو حذف شود؟")) return;
    await api(`/api/meds/${id}`, { method: "DELETE" });
    meds.reload();
  };

  return (
    <Page title="داروها و یادآور" back>
      {adherence.data?.percent !== null && adherence.data && (
        <Card>
          <div className="row between">
            <span>مصرف به‌موقع در ۷ روز اخیر</span>
            <span className="big">{num(adherence.data.percent)}٪</span>
          </div>
        </Card>
      )}
      <Card title="داروهای من">
        {meds.loading && <Spinner />}
        {meds.data?.length === 0 && <Empty>هنوز دارویی اضافه نکرده‌ای.</Empty>}
        <ul className="list">
          {meds.data?.map((m) => {
            const takenToday = m.today.filter((t) => t.status === "taken").length;
            return (
              <li key={m.id} style={{ flexWrap: "wrap" }}>
                <span className="grow">
                  💊 <b>{m.name}</b> {m.dose && <span className="muted">— {m.dose}</span>}
                  <div className="muted small ltr" style={{ textAlign: "right" }}>⏰ {m.times.join(" · ")}</div>
                  <div className="small">امروز: {num(takenToday)} از {num(m.times.length)}</div>
                </span>
                <button className="btn small primary" onClick={() => log(m.id, "taken")}>مصرف کردم</button>
                <button className="btn small" onClick={() => log(m.id, "skipped")}>جا ماند</button>
                <button className="btn ghost small" aria-label="حذف" onClick={() => remove(m.id)}>🗑️</button>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card title="➕ افزودن دارو">
        <form className="col" onSubmit={add}>
          <input required placeholder="نام دارو" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="دوز (مثلاً ۵۰۰ میلی‌گرم)" value={dose} onChange={(e) => setDose(e.target.value)} />
          <div className="col">
            {times.map((t, i) => (
              <div className="row gap" key={i}>
                <input type="time" dir="ltr" required value={t} onChange={(e) => setTimes(times.map((x, j) => (j === i ? e.target.value : x)))} />
                {times.length > 1 && <button type="button" className="btn small" onClick={() => setTimes(times.filter((_, j) => j !== i))}>✕</button>}
              </div>
            ))}
            <button type="button" className="btn small" onClick={() => setTimes([...times, "20:00"])}>+ زمان دیگر</button>
          </div>
          <ErrorBox error={error} />
          <button className="btn primary">ذخیره و فعال‌سازی یادآور</button>
          {notif && <p className="small muted">{notif}</p>}
        </form>
      </Card>
      <p className="disclaimer">در نسخه وب، یادآورها فقط وقتی اپ باز است نمایش داده می‌شوند. در اپ اندروید/iOS حتی با اپ بسته هم اعلان می‌آید.</p>
    </Page>
  );
}
