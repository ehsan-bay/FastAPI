# Product catalog (PDF)

`Salamatyar-Catalog.pdf` is a 17-page Persian sales catalog built from `catalog.html` with real app screenshots in `shots/`.

To change the text (e.g. the contact details on the last page) and rebuild:

```bash
cd docs/catalog
mkdir -p fonts && cp ../../app/node_modules/@fontsource/vazirmatn/files/vazirmatn-{arabic-{400,500,600,700,800,900},latin-{400,700,800}}-normal.woff2 fonts/
cp ../../app/public/icon-512.png icon.png
node render.cjs "$PWD"          # needs Playwright (Chromium)
```

To retake the screenshots: start the server with an empty `DATA_DIR`, run `seed.py` (demo user `demo@salamatyar.ir` / `demo1234`),
then `node shots.cjs <out-dir> <mole-image.jpg>`.
