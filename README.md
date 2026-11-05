# Salamat AI — offline install bundle

All Docker images (app with every AI model, PostgreSQL, Caddy), the source code and the installer,
split into parts under 100 MB. The server needs only GitHub access to fetch this branch (or a copy of these files).

```bash
git clone --depth 1 -b offline-bundle https://github.com/ehsan-bay/FastAPI.git salamat-bundle
cd salamat-bundle && sudo bash run.sh
```
Add `--domain your.domain` for automatic HTTPS. Re-running updates the app and keeps data and secrets.
