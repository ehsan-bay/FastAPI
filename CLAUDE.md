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
- The Android APK can't be built in the sandbox; the GitHub Actions `android` job builds it (artifact `salamat-ai-debug-apk`).
- The GitHub MCP connector has failed to connect in past sessions; plain `git push` works.

## Open items / ideas

- Branch `claude/health-ai-app` is pushed but **not merged** into `main`, and no PR has been opened.
- `render.yaml` now describes service `salamat-ai` + database `salamat-db`. It replaced the old `smartpos-nlp` service, which the user has not confirmed is unused.
- No public test server yet: the user will deploy on Render or their own Linux server (`docs/DEPLOY_LINUX.md`).
- The LLM path (`llama-cpp-python` + Qwen GGUF) has never been run because Hugging Face is blocked here.
- Ideas: fine-tune the food model on Food-101 + Iranian food photos; add DB migrations (Alembic) before schema changes on real data; web push for reminders.

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
