/** Jalali (Persian) calendar helpers. Same algorithm as the server (server/app/jalali.py). */
export const MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
export const WEEKDAYS = ["ش", "ی", "د", "س", "چ", "پ", "ج"]; // Saturday first

const div = (a: number, b: number) => Math.floor(a / b);

export function toJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 355666 + 365 * gy + div(gy2 + 3, 4) - div(gy2 + 99, 100) + div(gy2 + 399, 400) + gd + gdm[gm - 1];
  let jy = -1595 + 33 * div(days, 12053);
  days %= 12053;
  jy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    jy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  return days < 186 ? [jy, 1 + div(days, 31), 1 + (days % 31)] : [jy, 7 + div(days - 186, 30), 1 + ((days - 186) % 30)];
}

export function toGregorian(jy: number, jm: number, jd: number): [number, number, number] {
  jy += 1595;
  let days = -355668 + 365 * jy + div(jy, 33) * 8 + div((jy % 33) + 3, 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * div(days, 146097);
  days %= 146097;
  if (days > 36524) {
    days--;
    gy += 100 * div(days, 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    gy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  const sal = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  while (gm < 13 && gd > sal[gm]) gd -= sal[gm++];
  return [gy, gm, gd];
}

export const monthLength = (jy: number, jm: number) => {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  const [gy, gm, gd] = toGregorian(jy + 1, 1, 1); // day before 1 Farvardin of next year
  const prev = new Date(Date.UTC(gy, gm - 1, gd - 1));
  return toJalali(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate())[2];
};

const pad = (n: number) => String(n).padStart(2, "0");
/** ISO day (YYYY-MM-DD) of a local Date. */
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromIso = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const isoToJalali = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return toJalali(y, m, d);
};
export const jalaliToIso = (jy: number, jm: number, jd: number) => {
  const [y, m, d] = toGregorian(jy, jm, jd);
  return `${y}-${pad(m)}-${pad(d)}`;
};
export const addDays = (iso: string, n: number) => {
  const d = fromIso(iso);
  d.setDate(d.getDate() + n);
  return isoDay(d);
};
export const diffDays = (a: string, b: string) => Math.round((fromIso(a).getTime() - fromIso(b).getTime()) / 86_400_000);

const fa = new Intl.NumberFormat("fa-IR", { useGrouping: false });
/** "۱۴ آبان ۱۴۰۵" */
export const jalaliLabel = (iso: string, withYear = true) => {
  const [y, m, d] = isoToJalali(iso);
  return `${fa.format(d)} ${MONTHS[m - 1]}${withYear ? " " + fa.format(y) : ""}`;
};
/** Saturday = 0 */
export const weekdayIndex = (iso: string) => (fromIso(iso).getDay() + 1) % 7;
