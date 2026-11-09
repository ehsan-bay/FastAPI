# Technical document (PDF)

`Salamatyar-Technical.pdf` is a 17-page Persian technical/architecture document (A4 landscape, for presentations)
built from `technical.html`. Like the catalog, it names no AI models (only the general platform stack) and the PDF is
locked against copying (view and print only).

Rebuild:

```bash
cd docs/tech
mkdir -p fonts && cp ../../app/node_modules/@fontsource/vazirmatn/files/vazirmatn-{arabic-{400,500,700,800,900},latin-{400,700,800}}-normal.woff2 fonts/
cp ../../app/public/icon-512.png icon.png
node render.cjs "$PWD"      # then lock it with pypdf as for the catalog (docs/catalog/README.md)
```

Performance numbers on page 15 were measured on a 4-core sandbox server without GPU (median of several runs, network excluded).
Update the counts (endpoints, tables, tests) when the code changes.
