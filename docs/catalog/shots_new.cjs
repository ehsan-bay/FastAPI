// New-feature screenshots: voice logging, chest X-ray, read-aloud, elder mode, redesigned home.
// node shots_new.cjs <out-dir> <voice.wav>   (server on :8000 with seed.py data)
const { chromium, devices } = require('playwright');
const B = 'http://localhost:8000', OUT = process.argv[2], WAV = process.argv[3];
const FX = '/home/user/FastAPI/server/tests/fixtures/';
const css = `::-webkit-scrollbar{display:none} *{scrollbar-width:none}`;
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}%noloop`] });
  const ctx = await b.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 2, locale: 'fa-IR', permissions: ['microphone'] });
  const r = await (await ctx.request.post(B + '/api/auth/login', { data: { email: 'demo@salamatyar.ir', password: 'demo1234' } })).json();
  const open = async (path, prefs) => {
    const p = await ctx.newPage();
    await p.addInitScript(([t, pr]) => { localStorage.setItem('salamat.token', t); if (pr) localStorage.setItem('salamat.prefs', pr); else localStorage.removeItem('salamat.prefs'); }, [r.token, prefs]);
    await p.goto(B + path); await p.addStyleTag({ content: css }); await p.waitForLoadState('networkidle'); await p.waitForTimeout(800);
    return p;
  };
  const snap = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png` }); console.log('ok', n); };
  const scrollTo = (p, text) => p.evaluate((t) => { const el = [...document.querySelectorAll('.card-title,.section-title h2')].find((e) => e.textContent.includes(t)); el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -80); }, text);

  let p = await open('/voice'); await snap(p, 'voice');
  await p.getByRole('button', { name: 'شروع ضبط' }).click(); await p.waitForTimeout(4000); await snap(p, 'voice-rec');
  await p.waitForTimeout(5500);
  await p.getByRole('button', { name: 'پایان ضبط' }).click();
  await p.getByText('چه چیزی ثبت شود؟').waitFor({ timeout: 90000 });
  // Synthetic speech is not word-perfect; show what a clear speaker gets.
  await p.getByLabel('متن').fill('فشار خونم ۱۳۰ روی ۸۵ بود، ناهار قورمه سبزی و ماست خوردم');
  await p.getByRole('button', { name: 'بررسی دوباره' }).click(); await p.getByText('وعده: ماست').waitFor(); await p.waitForTimeout(400);
  await snap(p, 'voice-review');

  p = await open('/xray');
  await p.locator('input[type=file]:not([capture])').setInputFiles(FX + 'chest_xray_nih_00000001_000.png');
  await p.getByText('نتیجه', { exact: true }).waitFor({ timeout: 60000 }); await p.waitForTimeout(500);
  await snap(p, 'xray-upload');
  await scrollTo(p, 'نتیجه'); await p.waitForTimeout(300); await snap(p, 'xray');

  p = await open('/'); await snap(p, 'home');
  await scrollTo(p, 'وضعیت من'); await p.waitForTimeout(300); await snap(p, 'home-tools');
  p = await open('/', JSON.stringify({ elder: true, speechRate: 0.9 })); await snap(p, 'home-elder');
  p = await open('/settings'); await snap(p, 'settings-access');
  p = await open('/meds'); await snap(p, 'meds');
  p = await open('/more'); await snap(p, 'more');
  const dctx = await b.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 2, locale: 'fa-IR', colorScheme: 'dark' });
  const dp = await dctx.newPage(); await dp.addInitScript((t) => localStorage.setItem('salamat.token', t), r.token);
  await dp.goto(B + '/'); await dp.addStyleTag({ content: css }); await dp.waitForLoadState('networkidle'); await dp.waitForTimeout(800); await snap(dp, 'home-dark');
  await b.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
