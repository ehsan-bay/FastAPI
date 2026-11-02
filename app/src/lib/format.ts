const fa = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 });
export const num = (n: number | null | undefined) => (n === null || n === undefined || Number.isNaN(n) ? "—" : fa.format(n));
export const pct = (n: number) => `${fa.format(Math.round(n * 100))}٪`;

const dt = new Intl.DateTimeFormat("fa-IR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const d = new Intl.DateTimeFormat("fa-IR", { weekday: "short", month: "short", day: "numeric" });

/** Server returns UTC; naive strings are UTC too. */
export function parseDate(s: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z");
}
export const dateTime = (s: string) => dt.format(parseDate(s));
export const dateOnly = (s: string) => d.format(parseDate(s));

export function duration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const two = (n: number) => fa.format(n).padStart(2, "۰");
  return h ? `${fa.format(h)}:${two(m)}:${two(s)}` : `${fa.format(m)}:${two(s)}`;
}

/** Accept Persian/Arabic digits in number inputs. */
export const toLatinDigits = (s: string) =>
  s.replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace("٫", ".");
