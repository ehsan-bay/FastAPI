// node render.cjs <dir>  →  <dir>/Salamatyar-Technical.pdf  (A4 landscape)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + process.argv[2] + '/technical.html', { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.pdf({ path: process.argv[2] + '/Salamatyar-Technical.pdf', printBackground: true, preferCSSPageSize: true });
  const over = await p.evaluate(() => [...document.querySelectorAll('.page')].map((s, i) => [i + 1, s.scrollHeight - s.clientHeight]).filter((x) => x[1] > 2));
  console.log('overflow pages:', JSON.stringify(over));
  await b.close();
})();
