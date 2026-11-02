# سلامت‌یار هوشمند (Salamat AI)

اپ سلامت چندسکویی با مدل‌های هوش مصنوعی کوچک. یک کد مشترک برای **وب، PWA، اندروید و iOS**،
و یک سرور FastAPI که با یک Docker روی هر هاستی (Render، Railway، Fly، VPS) اجرا می‌شود.

## امکانات

| بخش | کار | مدل هوش مصنوعی | محل اجرا |
|---|---|---|---|
| 🍽️ تغذیه | تشخیص غذا از عکس + کالری و درشت‌مغذی‌ها، جدول غذاهای ایرانی | EfficientNet-Lite2 (TFLite) | سرور |
| 🩺 پوست | غربالگری خال و ضایعه پوستی (۹ کلاس ISIC) با سطح ریسک | EfficientNet-B3 (ONNX) | سرور |
| 🧪 آزمایش | خواندن برگه آزمایش با OCR و تفسیر به فارسی | RapidOCR (ONNX) + قواعد | سرور |
| 🏋️ مربی ورزش | شمارش تکرار و اصلاح فرم (اسکوات، شنا، لانج، …) | MediaPipe Pose Landmarker | **روی گوشی** |
| 😴 خواب | تشخیص خروپف، سرفه و رویدادهای تنفسی + امتیاز خواب | YAMNet (MediaPipe Audio) | **روی گوشی** |
| 🧠 سلامت روان | ژورنال احساسات، تحلیل حس، تشخیص بحران، گفتگو، تمرین تنفس | واژه‌نامه فارسی/انگلیسی + LLM اختیاری (Qwen2.5-0.5B) | سرور |
| ❤️ علائم حیاتی | فشار، قند، وزن، ضربان، اکسیژن؛ هشدار و تحلیل روند | تشخیص ناهنجاری (median/MAD) + رگرسیون | سرور |
| 💊 داروها | یادآور مصرف دارو و درصد مصرف به‌موقع | — | گوشی + سرور |

مدل‌های «روی گوشی» تصویر و صدا را از دستگاه خارج نمی‌کنند. عکس پوست و غذا هم روی سرور ذخیره نمی‌شود؛ فقط نتیجه ذخیره می‌شود.

> ⚕️ این اپ ابزار کمکی و غربالگری است و جایگزین تشخیص پزشک نیست.

## ساختار

```
server/   FastAPI + SQLModel (SQLite یا Postgres) + مدل‌ها
  app/ai/        food, skin, lab (OCR), mood, llm, insights
  app/routers/   API ها
  scripts/download_models.py   دانلود همه مدل‌ها
app/      React + Vite + TypeScript + Capacitor + PWA (فارسی، راست‌به‌چپ، حالت تیره)
  android/ ios/  پروژه‌های بومی Capacitor
Dockerfile        یک کانتینر: API + PWA + مدل‌ها
render.yaml       دیپلوی یک‌کلیکی روی Render
```

## اجرای محلی

```bash
# سرور
cd server
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
python scripts/download_models.py          # حدود ۸۰ مگابایت
uvicorn app.main:app --reload              # http://localhost:8000/docs
pytest -q

# کلاینت (در ترمینال دیگر)
cd app
npm install
npm run dev                                # http://localhost:5173
```

## دیپلوی (هاست)

📘 **راهنمای کامل سرور لینوکس:** [`docs/DEPLOY_LINUX.md`](docs/DEPLOY_LINUX.md)
(Docker + PostgreSQL + HTTPS خودکار، یا بدون Docker با systemd، به‌همراه بکاپ و به‌روزرسانی)

**Docker Compose (اپ + PostgreSQL + HTTPS):**
```bash
cp .env.example .env && nano .env          # SECRET_KEY، POSTGRES_PASSWORD، DOMAIN
docker compose --profile https up -d --build
```

**Render:** ریپو را در Render به‌عنوان Blueprint وصل کنید. `render.yaml` سرویس وب و یک دیتابیس
PostgreSQL را با هم می‌سازد و به هم وصل می‌کند. Postgres رایگان Render بعد از ۳۰ روز منقضی می‌شود.

متغیرهای محیطی:

| نام | توضیح |
|---|---|
| `SECRET_KEY` | کلید امضای توکن (حتماً طولانی و تصادفی) |
| `DATABASE_URL` | پیش‌فرض SQLite. برای PostgreSQL: `postgresql://user:pass@host:5432/db` (در Docker Compose خودکار تنظیم می‌شود) |
| `CORS_ORIGINS` | پیش‌فرض `*` |
| `LLM_MODEL_PATH` | مسیر فایل GGUF برای گفتگوی هوشمندتر (اختیاری) |

**مدل زبانی اختیاری:** با `docker build --build-arg WITH_LLM=1 .` مدل Qwen2.5-0.5B (حدود ۴۰۰ مگابایت)
هم نصب می‌شود و دستیار گفتگو با LLM جواب می‌دهد. به حدود ۱ گیگابایت RAM نیاز دارد. بدون آن، دستیار
با پاسخ‌های قاعده‌محور کار می‌کند.

## نسخه PWA

همان سایتی که سرور سرو می‌کند PWA است: در Chrome اندروید «Add to Home screen» و در Safari آیفون
«Add to Home Screen» را بزنید. پس از اولین استفاده، مدل‌های روی گوشی هم آفلاین در دسترس‌اند.

## اپ اندروید و iOS

```bash
cd app
VITE_API_URL=https://your-server.example.com npm run build
npx cap sync
npx cap open android      # Android Studio → Run / Build APK
npx cap open ios          # Xcode (روی macOS)
```

اگر `VITE_API_URL` را ندهید، اپ در اولین اجرا آدرس سرور را می‌پرسد.
GitHub Actions (`.github/workflows/ci.yml`) با هر push یک **APK** می‌سازد (بخش Artifacts).
اگر متغیر `SERVER_URL` را در تنظیمات ریپو (Variables) بگذارید، APK مستقیم به سرور شما وصل می‌شود.

## مدل‌ها و مجوزها

- EfficientNet-Lite2، Pose Landmarker، YAMNet: Google MediaPipe، Apache-2.0
- Skin classifier: [vin0san/skin-lesion-onnx-api](https://github.com/vin0san/skin-lesion-onnx-api)، MIT (دقت متوسط، Balanced Accuracy ≈ ۰٫۶۸)
- RapidOCR: Apache-2.0 · Qwen2.5-0.5B-Instruct: Apache-2.0

برای بهبود: مدل تشخیص غذا روی دیتاست Food-101 + عکس غذاهای ایرانی fine-tune شود (فایل
`server/app/ai/food.py` و `server/app/data/foods.json`).
