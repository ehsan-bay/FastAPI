# CLAUDE.md — project context and work history

> **For Claude (every new session):** read this whole file before doing anything.
> When you finish a piece of work, add an entry to the **Work history** below (newest first) and update
> the other sections if they changed. Keep it short and factual. Never put secrets here.

## The user

- Owner: GitHub `ehsan-bay` (repo `ehsan-bay/FastAPI`). Writes in **Persian**; answer in Persian unless asked otherwise.
- Usually on a phone: keep replies short, outcome first.
- Wants complete, working deliverables (server + web + PWA + mobile apps), tested end to end.

## Project: Salamat AI (سلامت‌یار هوشمند)

A multi-platform health app that uses small AI models. Persian UI, RTL.

| Part | Path | Tech |
|---|---|---|
| Server / API | `server/` | Python 3.12+, FastAPI, SQLModel (SQLite default, **PostgreSQL** via `DATABASE_URL`), JWT auth |
| Client | `app/` | React 19 + Vite + TypeScript, `vite-plugin-pwa`, Capacitor 8 (`app/android`, `app/ios`) |
| Deploy | `Dockerfile`, `docker-compose.yml`, `deploy/`, `render.yaml` | one container serves API + built PWA + model files |
| Docs | `README.md`, `docs/DEPLOY_LINUX.md` | Persian |

### Features and models

| Feature | Model | Runs on | Code |
|---|---|---|---|
| Food photo → calories | MediaPipe EfficientNet-Lite2 (ImageNet) mapped to `server/app/data/foods.json` (includes Iranian dishes) | server (`ai-edge-litert`) | `server/app/ai/food.py` |
| Skin lesion screening | EfficientNet-B3 ONNX, 9 ISIC classes (vin0san/skin-lesion-onnx-api, MIT) | server (onnxruntime) | `server/app/ai/skin.py` |
| Lab report OCR | RapidOCR (ONNX) + regex parser + reference ranges | server | `server/app/ai/lab.py` |
| Mood journal / crisis detection | Persian+English lexicon | server | `server/app/ai/mood.py` |
| Chat assistant | optional Qwen2.5-0.5B GGUF via llama-cpp; falls back to rule-based replies | server | `server/app/ai/llm.py` |
| Vitals insights | thresholds + median/MAD anomalies + linear trend | server | `server/app/ai/insights.py` |
| Exercise coach (rep counting, form) | MediaPipe Pose Landmarker lite | **device** | `app/src/lib/pose.ts` |
| Sleep sounds (snore/cough) | YAMNet via MediaPipe Audio | **device** | `app/src/lib/sleep.ts` |
| Medication reminders | Capacitor LocalNotifications / web Notification API | device | `app/src/lib/reminders.ts` |

- Models are **not in git**. `server/scripts/download_models.py` fetches them into `server/models/`
  (on-device ones into `server/models/device/`, served at `/models/`). The LLM is only fetched with `--llm`.
- MediaPipe WASM is copied from npm into `app/public/mediapipe/` by `app/scripts/copy-wasm.mjs` (postinstall; gitignored).

### How to run / test

```bash
# server
cd server && python -m venv ../.venv && ../.venv/bin/pip install -r requirements.txt -r requirements-dev.txt
../.venv/bin/python scripts/download_models.py
../.venv/bin/python -m pytest -q                                  # SQLite
TEST_DATABASE_URL=postgresql://u:pw@127.0.0.1:5432/db ../.venv/bin/python -m pytest -q   # Postgres
../.venv/bin/uvicorn app.main:app --reload
# client
cd app && npm install && npx tsc -b && npm run build                # dist/ is served by the server
```

Full stack: `cp .env.example .env` (set secrets), then `docker compose up -d --build`
(add `--profile https` for Caddy and automatic HTTPS).

### Conventions

- API under `/api/*`; every user-data route requires `current_user`, and each row has a `user_id`.
  Return 404 for other users' rows.
- Datetimes are UTC and timezone-aware (`db.now()`, `db.as_utc()`). The client sends `tz_offset` (JS `getTimezoneOffset`) when it needs the local day.
- User-facing strings are in Persian. Medical outputs always carry a disclaimer and never give a diagnosis.
- Images are never stored; only results are.
- Avoid `useEffect(() => expr)` shorthand in React: newer Chrome `scrollIntoView` returns a Promise and React treats it as a cleanup function, which crashes the app. Always use braces.

### Environment notes (Claude cloud sandbox)

- Blocked from the sandbox: huggingface.co, tunnels (ngrok, cloudflared, localtunnel, …), dl.google.com (Android SDK), Debian apt mirrors.
  Docker Hub is sometimes rate-limited (429); use `mirror.gcr.io/library/<image>` for local tests.
- Reachable: PyPI, npm, `storage.googleapis.com` (MediaPipe models), `raw.githubusercontent.com`, `media.githubusercontent.com` (LFS).
- `docker build` in the sandbox needs the proxy CA. Test with a temporary Dockerfile that copies `/root/.ccr/ca-bundle.crt`
  and sets `PIP_CERT`/`SSL_CERT_FILE`/`NODE_EXTRA_CA_CERTS`. **Never commit that.** Start the daemon with `dockerd &`.
- The Android APK can't be built in the sandbox; the GitHub Actions `android` job builds it (artifact `salamat-ai-apk`, release build signed with the test key, see item 21).
- The GitHub MCP connector has failed to connect in past sessions; plain `git push` works.

## Open items / ideas

- IPG (bank gateway) for visit payments: UI and API placeholders exist (`ipg_enabled` setting, `method: "ipg"`); waiting for the provider details.

- Branch `claude/health-ai-app` is pushed but **not merged** into `main`, and no PR has been opened.
- `render.yaml` now describes service `salamat-ai` + database `salamat-db`. It replaced the old `smartpos-nlp` service, which the user has not confirmed is unused.
- No public test server yet: the user will deploy on Render or their own Linux server (`docs/DEPLOY_LINUX.md`).
- The LLM path (`llama-cpp-python` + Qwen GGUF) has never been run because Hugging Face is blocked here.
- Schema changes: new **nullable** columns are added automatically by `add_missing_columns()`. Anything else (NOT NULL, renames, type changes) needs Alembic, which is not set up yet.
- Sleep recording still stops if the phone kills the app or (on web) the screen turns off; an Android foreground service would fix that.
- Ideas: fine-tune the food model on Food-101 + Iranian food photos; web push for reminders.

## Work history (newest first)

### 2026-11-02 — Session 1
1. Brainstormed health-app ideas with small AI models; the user asked to build **all of them in one app**.
2. Built the server (`server/`): auth, nutrition, skin, lab OCR, mood journal + chat, vitals, meds, sleep, workouts, dashboard, model status. 14 pytest tests.
3. Built the client (`app/`): 12 screens, Persian RTL, dark mode, PWA (service worker + manifest), Capacitor Android/iOS projects with camera/mic/notification permissions and app icons.
4. Verified end to end with Playwright on a mobile viewport: every flow passed, and the on-device pose and audio models loaded.
   Fixed a crash in the chat screen (`useEffect` shorthand).
5. Added the Dockerfile (headless OpenCV, no apt), Render blueprint, and CI (server tests, web build, Android APK). Docker image tested (~120 MB RAM at idle).
6. The user asked for a public test URL. Not possible from the sandbox (tunnels blocked); gave Render steps instead.
7. Added **PostgreSQL**: engine pool + `pool_pre_ping`, `init_db` waits for the DB, `/api/health` reports DB status (503 when down),
   `postgres://` URLs normalized to `postgresql+psycopg://`. Tests pass on SQLite and Postgres 17. Docker Compose now has `db` (postgres:17-alpine) + `app` + optional `caddy` (HTTPS).
   Added `deploy/backup.sh` / `deploy/restore.sh` (tested), `deploy/nginx.conf`, `deploy/salamat.service`, `.env.example`, and a Postgres database in `render.yaml`.
8. Wrote `docs/DEPLOY_LINUX.md` (Docker + Caddy, Nginx + certbot, no-Docker systemd, backups, updates, offline image transfer, security checklist, troubleshooting).
9. Created this `CLAUDE.md` as persistent context.
10. Reviewed popular health apps and suggested next features. Top picks: barcode scan (Open Food Facts), Health Connect/HealthKit sync,
    cycle tracking, weekly report + PDF, then Jalali calendar, Persian voice logging, camera heart rate, symptom checker. The user hasn't chosen yet.
    VPS advice: 2 vCPU / 4 GB / 40 GB, Ubuntu 24.04. An Iranian cloud (Arvan, ParsPack) if users are in Iran; Hetzner for testing or users abroad.
11. Explained the app architecture to the user (no code changes).
12. **Sleep data no longer lost when the app closes.** `app/src/lib/sleepStore.ts`: the monitor checkpoints stats to localStorage
    every 60 s, on `visibilitychange`, and on `pagehide` (pagehide fires *before* visibilitychange, so the "interrupted" mark is kept on the instance).
    Unsent nights are uploaded on app start, every 5 min, on `online`, and on foreground. A failed "wake up" upload stays on the phone.
    Server: `SleepSession.client_id` (idempotent POST) + `recovered` flag + tip. Added `db.add_missing_columns()`, a mini migration that adds new
    nullable columns to existing tables on startup (tested on SQLite and Postgres). Browser tests passed for app closed, offline at wake-up, OS-killed app,
    and a duplicate resend. 16 pytest tests.
    Note: `pkill -f "<pattern>"` / `pgrep -f "<pattern>"` inside a Bash call can match the calling shell itself and kill it (exit 144);
    use a bracket pattern like `pgrep -f "[u]vicorn app[.]main"`.
13. Answered: why some models run on the phone (real-time video/audio, privacy, offline, zero server cost), how on-device inference works
    (model file + WASM/native runtime such as MediaPipe/LiteRT, no API), and why Python for the server (AI ecosystem). No code changes.
14. Built a **17-page Persian sales catalog PDF** (`docs/catalog/Salamatyar-Catalog.pdf`): cover, executive summary, problem/opportunity,
    8 modules, real screenshots (seeded demo data), architecture, trust & safety, comparison, business model & packages (prices left
    "by agreement"), 6-month launch plan, roadmap, buyer FAQ, back cover. Contact fields on the last page are placeholders. How to rebuild: `docs/catalog/README.md`.
15. Explained the models used; made a 2-page demo-server spec PDF for the user's DevOps team (scratchpad only, product name removed on request).
16. The user wants Claude to deploy on their own server. **This cloud sandbox cannot SSH out** (port 22 blocked, no ssh client).
    Added `deploy/install.sh`: a one-command installer (Docker, clone to /opt/salamat, .env with random secrets, ufw, compose up with optional
    Caddy HTTPS via `--domain`, health wait, nightly backup cron; re-run = update, keeps secrets and domain; `GIT_TOKEN` for a private repo).
    Tested here end to end with stubs for apt/crontab and `--no-build`. Two ways forward: the user/DevOps runs the one-liner, or the user runs
    `claude remote-control` on the server (in e.g. /opt) so this session can attach via `request_computer_folder` and run it.
17. The user's demo server is `192.168.8.190` (private LAN, Ubuntu 24.04, user `techno`, 37 GB disk). The first install run failed in
    `docker build`: **pip cannot reach PyPI from that server** (npm and Docker Hub worked). Google storage is probably blocked too.
    Fixes: CI publishes the image to GHCR (`.github/workflows/image.yml`, installer pulls it by default; `--build` and `--pip-mirror` remain),
    and an **offline bundle** (`deploy/make-offline-bundle.sh` → `salamat-offline.tar` ≈ 460 MB: images for app + postgres + caddy,
    source, installer). `.github/workflows/offline-bundle.yml` smoke-tests the image and uploads the bundle to release tag `offline`.
    `install.sh --offline <tar|dir>` was tested here with all images removed first: it loaded everything from the bundle and came up healthy.
    The CI workflows have not been seen running yet (no GitHub API access from this sandbox).
    Computer use / VNC control is not available in this session; the user runs commands in MobaXterm and pastes the output.
18. The `offline` release never appeared (GitHub Actions apparently not running; can't check from here). Built a fresh image in the sandbox
    instead (CA only bind-mounted during RUN, verified nothing left in the image) and pushed the bundle as **orphan branch `offline-bundle`**
    (6 parts < 100 MB + `SHA256SUMS` + `run.sh`). Server install: `git clone --depth 1 -b offline-bundle https://github.com/ehsan-bay/FastAPI.git salamat-bundle && cd salamat-bundle && sudo bash run.sh`.
    Tested from a fresh clone with all images deleted first: healthy, all models on. To refresh it: rebuild image, `deploy/make-offline-bundle.sh`,
    split -b 90m, force-push the orphan branch (force push keeps the repo from growing with each version).
19. GitHub Actions do run: "Docker image" is green (image on GHCR), but "CI" and "Offline bundle" fail in under a minute; cause unknown
    (logs not reachable from here; server tests and web build pass on a clean clone with Python 3.12 / Node 22). Waiting for a screenshot of the error.
    **Production URL: `https://salamatyar.tosantechno.ir`** (blocked by this sandbox's network policy, so untested from here).
    Set it as the default server for native apps only (`app/.env.production` + `serverUrl()` ignores it on web); the CI android job uses
    `vars.SERVER_URL` or that default. APK is still not built.
20. CI android job failed in `android-actions/setup-android@v3` (SDK re-download/licenses). Replaced it with the runner's preinstalled SDK
    (`$ANDROID_HOME`, accept licenses, write `local.properties`). **The APK now builds** and the user downloaded it. On the phone,
    Google Play Protect blocks it ("hasn't seen an app from this developer"), because it is a debug build from an unknown developer.
    Next: release signing (keystore in GitHub secrets) + publishing in Cafe Bazaar/Myket or Play to avoid the warning.
21. "App not installed" on the phone: each CI run signed with a fresh random debug key, so an APK could not update another. Now
    `app/android/app/signing/test.keystore` (committed, password `android`, alias `salamatyar`, **test only, not secret**) signs every build;
    CI builds **assembleRelease**, versionCode = `GITHUB_RUN_NUMBER`, artifact `salamat-ai-apk` (`Salamatyar-1.0.<run>.apk`).
    Optional real key via secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
    Gradle can't run in the sandbox (dl.google.com blocked), so this was reviewed but only CI can prove it.
22. **Doctor visit payments (QR + wallet) and admin panel.** Server: tables `Doctor` (fee, `qr_token`, `balance` = owed to doctor),
    `Payment` (ref `SY…`), `WalletTxn` (ledger), `DoctorSettlement`, `AppSetting`; `User.is_admin`, `User.wallet_balance` (nullable → auto-migrated).
    `app/wallet.py` does every balance change as one conditional UPDATE (no double spend; tested with 6 parallel payments).
    `app/bootstrap.py` on startup: 5 sample doctors, admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD` (env is authoritative; without a password a random one
    is printed and written to `DATA_DIR/admin-credentials.txt`), initial credit for users without a wallet (default 5,000,000 toman).
    API: `/api/pay/doctors/{token}`, `POST /api/pay` (wallet; `ipg` returns 400 until a gateway is configured), `/api/wallet`, `/api/payments`,
    `/api/admin/*` (overview, doctors CRUD + new-qr + settle, payments, users + wallet adjust + role, settings). 25 pytest (SQLite + Postgres).
    Client: `/scan` (camera, BarcodeDetector or jsQR), `/pay/:token` (shows only name + specialty, default fee clears on first keystroke,
    IPG shown disabled), `/wallet` (balance, reports, ledger), `/admin` (reports chart, doctors + printable QR cards, payments + CSV, users, settings).
    QR encodes `<site>/pay/<token>`. Browser test passed end to end, including scanning a QR through a fake camera (`--use-file-for-fake-video-capture`).
    IPG details still to come from the user.
23. **The native app now loads the live site** (`capacitor.config.ts` → `server.url` from `VITE_API_URL` / `app/.env.production`), so web
    changes reach the app without a new APK; only native changes (permissions, plugins, icon) need one. Offline → `public/offline.html`
    (`server.errorPath`; the site URL is hardcoded there too). `CAP_BUNDLED=1` restores bundled files. `serverUrl()` returns "" (same origin)
    unless `isBundledApp()` (native on `localhost`); the server form is shown only then. Note: Apple may reject "website wrapper" apps.
