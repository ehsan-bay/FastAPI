const { chromium, devices } = require('playwright');
const B = 'http://localhost:8000', OUT = process.argv[2];
const css = `::-webkit-scrollbar{display:none} *{scrollbar-width:none}`;
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream'] });
  const mk = async (scheme = 'light') => {
    const ctx = await browser.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 2, colorScheme: scheme, locale: 'fa-IR' });
    return ctx;
  };
  const tokenRes = await (await (await mk()).request.post(B + '/api/auth/login', { data: { email: 'demo@salamatyar.ir', password: 'demo1234' } })).json();
  const token = tokenRes.token;
  const open = async (ctx, path) => {
    const p = await ctx.newPage();
    await p.addInitScript((t) => localStorage.setItem('salamat.token', t), token);
    await p.goto(B + path); await p.addStyleTag({ content: css });
    await p.waitForLoadState('networkidle'); await p.waitForTimeout(700);
    return p;
  };
  const snap = async (p, name) => { await p.screenshot({ path: `${OUT}/${name}.png` }); console.log('ok', name); };

  // login (logged out)
  { const ctx = await mk(); const p = await ctx.newPage(); await p.goto(B); await p.addStyleTag({ content: css }); await p.waitForTimeout(600); await snap(p, 'login'); }
  const ctx = await mk();
  let p = await open(ctx, '/'); await snap(p, 'home');
  { const dctx = await mk('dark'); const dp = await open(dctx, '/'); await snap(dp, 'home-dark'); }

  p = await open(ctx, '/food');
  await p.locator('input[type=file]').nth(1).setInputFiles('/home/user/FastAPI/server/tests/fixtures/burger.jpg');
  await p.getByText('ثبت: همبرگر با پنیر').waitFor({ timeout: 30000 });
  await p.waitForTimeout(500); await snap(p, 'food-ai');
  await p.getByRole('button', { name: 'انصراف' }).click();
  await p.evaluate(() => { const el = [...document.querySelectorAll('.card-title')].find(e => e.textContent.includes('وعده‌های امروز')); el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); });
  await p.waitForTimeout(400); await snap(p, 'food-log');

  p = await open(ctx, '/skin');
  await p.locator('input[type=file]').nth(1).setInputFiles(process.argv[3]);
  await p.getByText('نتیجه:').waitFor({ timeout: 30000 });
  await p.evaluate(() => { const el = [...document.querySelectorAll('.card-title')].find(e => e.textContent.includes('نتیجه')); el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); });
  await p.waitForTimeout(400); await snap(p, 'skin');

  p = await open(ctx, '/lab');
  await p.getByRole('tab', { name: /تایپ/ }).click();
  await p.locator('textarea').fill('FBS 112\nHbA1c 5.9\nCholesterol 214\nHDL 38\nLDL 138\nTG 165\nHb 13.2\nTSH 2.1\nVitamin D 18\nFerritin 22');
  await p.getByRole('button', { name: 'تحلیل', exact: true }).click();
  await p.getByText('خارج از محدوده').first().waitFor();
  await p.evaluate(() => { const el = [...document.querySelectorAll('.card-title')].find(e => e.textContent.trim() === 'نتیجه'); el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); });
  await p.waitForTimeout(400); await snap(p, 'lab');

  p = await open(ctx, '/mind');
  await p.locator('.moods button').nth(1).click();
  await p.locator('textarea').fill('این هفته خیلی کار داشتم، خسته‌ام و نگران پروژه هستم');
  await p.getByRole('button', { name: 'ثبت و تحلیل' }).click();
  await p.getByText('بازخورد').waitFor();
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(400); await snap(p, 'mind-journal');
  await p.getByRole('tab', { name: /گفتگو/ }).click();
  for (const q of ['شب‌ها دیر خوابم می‌بره، چکار کنم؟']) {
    await p.getByPlaceholder('پیامت را بنویس').fill(q); await p.getByRole('button', { name: 'ارسال' }).click();
    await p.locator('.msg.assistant').nth(1).waitFor();
  }
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(400); await snap(p, 'mind-chat');

  p = await open(ctx, '/vitals'); await snap(p, 'vitals-bp');
  await p.getByRole('button', { name: /قند خون/ }).click(); await p.waitForTimeout(900);
  await p.evaluate(() => { const el = [...document.querySelectorAll('.card-title')].find(e => e.textContent.includes('تحلیل روند')); el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -140); });
  await p.waitForTimeout(300); await snap(p, 'vitals-glucose');

  p = await open(ctx, '/sleep'); await snap(p, 'sleep');
  p = await open(ctx, '/coach'); await snap(p, 'coach');
  p = await open(ctx, '/meds'); await snap(p, 'meds');
  p = await open(ctx, '/settings');
  await p.evaluate(() => { const el = [...document.querySelectorAll('.card-title')].find(e => e.textContent.includes('مدل‌های')); el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); });
  await p.waitForTimeout(300); await snap(p, 'models');
  p = await open(ctx, '/more'); await snap(p, 'more');
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
