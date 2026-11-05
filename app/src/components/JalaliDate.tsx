import { MONTHS, isoDay, isoToJalali, jalaliToIso, monthLength } from "../lib/jalali";

const fa = new Intl.NumberFormat("fa-IR", { useGrouping: false });

/** Date picker in the Persian calendar (day / month / year). Value is an ISO day (YYYY-MM-DD) or "". */
export default function JalaliDate({ value, onChange, allowEmpty, label, maxIso }: { value: string; onChange: (iso: string) => void; allowEmpty?: boolean; label?: string; maxIso?: string }) {
  const todayIso = isoDay(new Date());
  const [ty] = isoToJalali(todayIso);
  const [y, m, d] = value ? isoToJalali(value) : [0, 0, 0];
  const set = (ny: number, nm: number, nd: number) => {
    if (!ny || !nm || !nd) return allowEmpty ? onChange("") : undefined;
    let iso = jalaliToIso(ny, nm, Math.min(nd, monthLength(ny, nm)));
    if (maxIso && iso > maxIso) iso = maxIso;
    onChange(iso);
  };
  const base = value ? [y, m, d] : isoToJalali(todayIso);
  const years = Array.from({ length: 6 }, (_, i) => ty - 4 + i);
  return (
    <div className="jdate" role="group" aria-label={label}>
      <select aria-label="روز" value={d || ""} onChange={(e) => set(base[0], base[1], +e.target.value)}>
        {!value && <option value="">روز</option>}
        {Array.from({ length: value ? monthLength(y, m) : 31 }, (_, i) => <option key={i} value={i + 1}>{fa.format(i + 1)}</option>)}
      </select>
      <select aria-label="ماه" value={m || ""} onChange={(e) => set(base[0], +e.target.value, base[2])}>
        {!value && <option value="">ماه</option>}
        {MONTHS.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
      </select>
      <select aria-label="سال" value={y || ""} onChange={(e) => set(+e.target.value, base[1], base[2])}>
        {!value && <option value="">سال</option>}
        {years.map((yy) => <option key={yy} value={yy}>{fa.format(yy)}</option>)}
      </select>
      {allowEmpty && value && <button type="button" className="btn small ghost" onClick={() => onChange("")}>پاک</button>}
    </div>
  );
}
