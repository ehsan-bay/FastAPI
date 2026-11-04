const { chromium } = require('playwright');
const QR = require('/home/user/FastAPI/app/node_modules/qrcode');
(async () => {
  const img = await QR.toDataURL('https://salamatyar.tosantechno.ir', { width: 512, margin: 1, color: { dark: '#052e25', light: '#ffffff' } });
  const b = await chromium.launch(); const p = await b.newPage({ deviceScaleFactor: 2 });
  await p.setContent(`<html dir="rtl"><head><style>
    @font-face{font-family:V;src:url(file://${process.argv[2]}/fonts/vazirmatn-arabic-800-normal.woff2);font-weight:800}
    @font-face{font-family:V;src:url(file://${process.argv[2]}/fonts/vazirmatn-arabic-400-normal.woff2);font-weight:400}
    body{margin:0;font-family:V}.c{width:360px;padding:22px;border-radius:16px;background:#fff;text-align:center;border:1px solid #dbe4e0}
    .s{color:#0f9d76;font-weight:800;font-size:15px}h2{margin:8px 0 2px;font-size:26px;font-weight:800;color:#13221d}p{margin:0;color:#5f716b}img{width:260px;margin:14px auto 4px;display:block}
    </style></head><body><div class="c"><div class="s">پرداخت ویزیت با سلامت‌یار</div><h2>دکتر سارا محمدی</h2><p>متخصص قلب و عروق</p><img src="${img}"></div></body></html>`);
  await p.evaluate(() => document.fonts.ready);
  await p.locator('.c').screenshot({ path: process.argv[2] + '/shots/qr-card.png' }); await b.close(); console.log('ok');
})();
