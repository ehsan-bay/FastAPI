import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Camera, Flame, Mic, Search, Sparkles, Trash2, UtensilsCrossed } from "lucide-react";
import { Card, Disclaimer, Empty, ErrorBox, ImagePicker, Page, Ring, Spinner } from "../components/ui";
import { api, shrinkImage, upload } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateTime, num } from "../lib/format";
import { useApi } from "../lib/useApi";

type Food = { key: string; fa: string; en: string; serving_g: number; kcal: number; protein: number; carbs: number; fat: number; score?: number };
type Meal = { id: number; name: string; servings: number; kcal: number; protein: number; carbs: number; fat: number; created_at: string; source: string };

export default function FoodPage() {
  const { user } = useAuth();
  const meals = useApi<Meal[]>("/api/meals", { days: 1 });
  const [preview, setPreview] = useState<string>();
  const [result, setResult] = useState<{ is_food: boolean; candidates: Food[]; engine?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Food | null>(null);
  const [servings, setServings] = useState(1);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState<Food[]>([]);

  useEffect(() => {
    const t = setTimeout(() => api<Food[]>("/api/food/search", { query: { q, limit: 30 } }).then(setSearch).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const analyze = async (file: File) => {
    setPreview(URL.createObjectURL(file));
    setResult(null);
    setSelected(null);
    setError("");
    setBusy(true);
    try {
      const r = await upload<{ is_food: boolean; candidates: Food[]; engine?: string }>("/api/food/analyze", await shrinkImage(file, 800));
      setResult(r);
      if (r.candidates[0]) setSelected(r.candidates[0]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await api("/api/meals", { body: { food_key: selected.key, servings, source: result ? "ai" : "manual" } });
      setSelected(null);
      setResult(null);
      setPreview(undefined);
      setServings(1);
      meals.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    await api(`/api/meals/${id}`, { method: "DELETE" });
    meals.reload();
  };

  const total = (meals.data ?? []).reduce((s, m) => s + m.kcal, 0);
  const goal = user?.calorie_goal ?? 2000;

  return (
    <Page title="تغذیه" subtitle="عکس بگیرید، کالری را بدانید" action={<Link to="/voice" className="icon-btn" aria-label="ثبت صوتی"><Mic size={20} /></Link>}>
      <Card title="تشخیص غذا از روی عکس" icon={Camera} tone="orange">
        <p className="muted small" style={{ marginBottom: 10 }}>غذاهای ایرانی مثل قورمه‌سبزی، کباب، تهچین و آش هم شناخته می‌شوند.</p>
        <ImagePicker onPick={analyze} disabled={busy} label="عکس غذا" />
        {preview && <img src={preview} alt="عکس غذا" className="preview" style={{ marginTop: 12 }} />}
        {busy && <Spinner text="هوش مصنوعی در حال بررسی…" />}
        <ErrorBox error={error} />
        {result && (
          <div className="col" style={{ marginTop: 10 }}>
            {!result.is_food && <div className="alert warn">مطمئن نیستم این غذا چیست. از پیشنهادها انتخاب کن یا پایین جستجو کن (غذاهای ایرانی هم هست).</div>}
            <div className="row gap wrap">
              {result.candidates.map((c) => (
                <button key={c.key} className={`btn small ${selected?.key === c.key ? "primary" : ""}`} onClick={() => setSelected(c)}>
                  {c.fa} {c.score !== undefined && c.score >= 0.01 && <span className="small">({num(Math.round(c.score * 100))}٪)</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      {selected && (
        <Card title={`ثبت: ${selected.fa}`}>
          <p className="muted small">هر وعده ≈ {num(selected.serving_g)} گرم · {num(selected.kcal)} کیلوکالری</p>
          <label className="field">
            تعداد وعده: {num(servings)}
            <input type="range" min={0.25} max={4} step={0.25} value={servings} onChange={(e) => setServings(+e.target.value)} />
          </label>
          <div className="grid2 small" style={{ margin: "8px 0" }}>
            <span className="row gap-s"><Flame size={14} color="var(--orange)" /> {num(selected.kcal * servings)} کیلوکالری</span>
            <span>پروتئین {num(selected.protein * servings)} گرم</span>
            <span>کربوهیدرات {num(selected.carbs * servings)} گرم</span>
            <span>چربی {num(selected.fat * servings)} گرم</span>
          </div>
          <div className="row gap">
            <button className="btn primary grow" onClick={save} disabled={busy}>ثبت در وعده‌های امروز</button>
            <button className="btn" onClick={() => setSelected(null)}>انصراف</button>
          </div>
          {result && <Disclaimer>کالری تقریبی است و به اندازه واقعی بشقاب بستگی دارد.</Disclaimer>}
        </Card>
      )}

      <Card title="جستجوی غذا" icon={Search} tone="slate">
        <input placeholder="مثلاً قورمه‌سبزی، نان سنگک، موز…" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="list" style={{ maxHeight: 260, overflow: "auto", marginTop: 8 }}>
          {search.map((f) => (
            <li key={f.key} onClick={() => { setSelected(f); setResult(null); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ cursor: "pointer" }}>
              <span className="grow">{f.fa}</span>
              <span className="muted small">{num(f.kcal)} kcal</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="وعده‌های امروز" icon={UtensilsCrossed} tone="teal">
        <div className="row gap">
          <Ring value={total} max={goal} size={92} stroke={10} tone={total > goal ? "var(--warn)" : "var(--primary)"}>
            <div><b>{num(Math.round(total))}</b><div className="tiny muted">kcal</div></div>
          </Ring>
          <div className="grow small">
            <div>هدف روزانه: <b>{num(goal)}</b> کیلوکالری</div>
            <div className="muted">{total > goal ? `${num(Math.round(total - goal))} بیشتر از هدف` : `${num(Math.round(goal - total))} باقی‌مانده`}</div>
          </div>
        </div>
        {meals.loading && <Spinner />}
        {meals.data?.length === 0 && <Empty icon={UtensilsCrossed}>هنوز وعده‌ای ثبت نشده.</Empty>}
        <ul className="list">
          {meals.data?.map((m) => (
            <li key={m.id}>
              <span className="grow">
                {m.source === "ai" && <Sparkles size={13} color="var(--violet)" style={{ marginInlineEnd: 4 }} />}{m.name} {m.servings !== 1 && <span className="muted small">×{num(m.servings)}</span>}
                <div className="muted small">{dateTime(m.created_at)}</div>
              </span>
              <span>{num(m.kcal)}</span>
              <button className="btn ghost small" aria-label="حذف" onClick={() => remove(m.id)}><Trash2 size={16} /></button>
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}
