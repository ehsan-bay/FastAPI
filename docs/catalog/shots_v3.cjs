// Screenshots for family/caregiver, refill, doctor report, HbA1c, women's health and camera heart rate.
// node shots_v3.cjs <out-dir> <finger.y4m>   (server on :8000 with seed.py data)
const { chromium, devices } = require('playwright');
const B = 'http://localhost:8000', OUT = process.argv[2], Y4M = process.argv[3];
const css = `::-webkit-scrollbar{display:none} *{scrollbar-width:none}`;
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${Y4M}`] });
  const mk = (o = {}) => b.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 2, locale: 'fa-IR', timezoneId: 'Asia/Tehran', permissions: ['camera'], ...o });
  const login = async (ctx, email, pw) => (await (await ctx.request.post(B + '/api/auth/login', { data: { email, password: pw } })).json()).token;
  const api = (ctx, t, path, data, method = 'post') => ctx.request[method](B + path, { data, headers: { Authorization: 'Bearer ' + t } }).then((r) => r.json());
  const open = async (ctx, t, path, wait = 900) => {
    const p = await ctx.newPage(); await p.addInitScript((tk) => localStorage.setItem('salamat.token', tk), t);
    await p.goto(B + path); await p.addStyleTag({ content: css }); await p.waitForLoadState('networkidle'); await p.waitForTimeout(wait); return p;
  };
  const snap = async (p, n, opts = {}) => { await p.screenshot({ path: `${OUT}/${n}.png`, ...opts }); console.log('ok', n); };
  const scrollTo = (p, text) => p.evaluate((t) => { const el = [...document.querySelectorAll('.card-title,.section-title h2')].find((e) => e.textContent.includes(t)); el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -80); }, text);

  const pc = await mk(); const pt = await login(pc, 'demo@salamatyar.ir', 'demo1234');
  // medicine stock: one running low; one dose two hours ago not taken yet
  const meds = await api(pc, pt, '/api/meds', undefined, 'get');
  for (const m of meds) {
    const stock = m.name === 'آملودیپین' ? 4 : m.name === 'متفورمین' ? 46 : 25;
    await api(pc, pt, `/api/meds/${m.id}`, { name: m.name, dose: m.dose, times: m.times, notes: m.notes, active: true, stock, per_dose: 1 }, 'put');
  }
  const tehran = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tehran' }));
  const past = `${String(Math.max(0, tehran.getHours() - 2)).padStart(2, '0')}:00`;
  await api(pc, pt, '/api/meds', { name: 'لوزارتان', dose: '۵۰ میلی‌گرم', times: [past], stock: 28, per_dose: 1 });

  let p = await open(pc, pt, '/meds'); await scrollTo(p, 'داروهای من'); await p.waitForTimeout(300); await snap(p, 'meds-refill');
  // invite + caregiver
  const inv = await api(pc, pt, '/api/care/invite', { label: 'پسرم' });
  const cc = await mk(); await cc.request.post(B + '/api/auth/register', { data: { email: 'reza@salamatyar.ir', password: 'demo1234', name: 'رضا' } });
  const ct = await login(cc, 'reza@salamatyar.ir', 'demo1234');
  await api(cc, ct, '/api/care/join', { code: inv.code });
  await api(pc, pt, '/api/care/invite', { label: 'خواهرم' }); // a pending invite to show the code
  p = await open(pc, pt, '/family'); await scrollTo(p, 'همراهان من'); await p.waitForTimeout(300); await snap(p, 'family-patient');
  let c = await open(cc, ct, '/', 1500); await snap(c, 'family-caregiver-home');
  c = await open(cc, ct, '/family'); await snap(c, 'family-caregiver');
  await c.locator('a.card', { hasText: 'سارا' }).click(); await c.getByText('داروهای امروز').waitFor(); await c.waitForTimeout(600); await snap(c, 'family-detail');

  // report
  p = await open(pc, pt, '/report'); await snap(p, 'report-page');
  const link = await api(pc, pt, '/api/report/link', { days: 30, tz_offset: -210 });
  const dctx = await b.newContext({ viewport: { width: 900, height: 1270 }, deviceScaleFactor: 2, locale: 'fa-IR' });
  const rp = await dctx.newPage(); await rp.goto(B + link.path); await rp.waitForTimeout(900);
  await rp.addStyleTag({ content: '.bar{display:none}' }); await snap(rp, 'report-view');
  // HbA1c
  p = await open(pc, pt, '/vitals'); await p.getByRole('button', { name: 'قند خون', exact: true }).click(); await p.getByText('HbA1c تخمینی').waitFor(); await p.waitForTimeout(500);
  await scrollTo(p, 'ثبت قند خون'); await p.waitForTimeout(300); await snap(p, 'a1c');

  // cycle
  const iso = (d) => d.toISOString().slice(0, 10); const day = (n) => new Date(Date.now() - n * 864e5);
  for (const [s, e, sy] of [[101, 96, ['cramps']], [72, 67, ['cramps', 'fatigue']], [43, 38, ['headache']], [14, 9, ['cramps', 'bloating']]])
    await api(pc, pt, '/api/cycle', { start: iso(day(s)), end: iso(day(e)), flow: 'medium', symptoms: sy });
  p = await open(pc, pt, '/cycle', 1200); await snap(p, 'cycle');

  // heart rate
  p = await open(pc, pt, '/heart'); await p.getByRole('button', { name: 'شروع اندازه‌گیری' }).click();
  await p.waitForTimeout(13000); await snap(p, 'heart-measure');
  await p.getByText('ضربه در دقیقه').waitFor({ timeout: 40000 }); await p.waitForTimeout(400); await snap(p, 'heart-result');
  await b.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
