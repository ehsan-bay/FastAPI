const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + process.argv[2] + '/catalog.html', { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.pdf({ path: process.argv[2] + '/Salamatyar-Catalog.pdf', format: 'A4', printBackground: true, preferCSSPageSize: true });
  // overflow check: any page whose content is taller than the page
  const over = await p.evaluate(() => [...document.querySelectorAll('.page')].map((s, i) => [i + 1, s.scrollHeight - s.clientHeight]).filter(x => x[1] > 2));
  console.log('overflow pages:', JSON.stringify(over));
  await b.close();
})();
