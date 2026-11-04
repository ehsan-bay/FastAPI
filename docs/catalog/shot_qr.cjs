const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2 });
  const r = await (await ctx.request.post('http://localhost:8000/api/auth/login', { data: { email: 'admin@salamatyar.ir', password: 'Admin12345' } })).json();
  const p = await ctx.newPage(); await p.addInitScript((t) => localStorage.setItem('salamat.token', t), r.token);
  await p.goto('http://localhost:8000/admin'); await p.getByRole('tab', { name: /پزشکان/ }).click();
  await p.getByRole('button', { name: 'QR' }).first().click(); await p.locator('.modal img').waitFor();
  await p.addStyleTag({ content: '.modal .ltr{display:none} .modal .row{display:none}' }); await p.waitForTimeout(300);
  await p.locator('.modal .card').screenshot({ path: process.argv[2] + '/qr-card.png' }); await b.close(); console.log('ok');
})();
