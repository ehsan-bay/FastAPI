# راهنمای کامل دیپلوی سلامت‌یار روی سرور لینوکس

این راهنما برای **Ubuntu 22.04 / 24.04** و **Debian 12** نوشته شده است (روی بقیه توزیع‌ها هم با تغییرات جزئی کار می‌کند).
نتیجه نهایی: اپ روی `https://دامنه‌شما` با PostgreSQL، HTTPS خودکار، بکاپ روزانه و نسخه PWA قابل نصب.

دو روش داریم:

| روش | مناسب برای | سختی |
|---|---|---|
| **الف) Docker Compose** (پیشنهادی) | بیشتر سرورها، به‌روزرسانی ساده | آسان |
| **ب) بدون Docker** (systemd + Postgres محلی) | سرورهایی که Docker ندارند یا Docker Hub در دسترس نیست | متوسط |

---

## ⚡ نصب سریع با یک دستور

روی یک سرور تازه Ubuntu/Debian (با دسترسی root یا sudo):

```bash
curl -fsSL https://raw.githubusercontent.com/ehsan-bay/FastAPI/claude/health-ai-app/deploy/install.sh \
  | sudo bash -s -- --domain demo.example.com --email you@example.com
```

این اسکریپت (`deploy/install.sh`) همه کارها را انجام می‌دهد: نصب Docker، دریافت کد در `/opt/salamat`،
ساخت `.env` با رمزهای تصادفی، باز کردن پورت‌ها، اجرای اپ + PostgreSQL + HTTPS خودکار، بررسی سلامت و بکاپ شبانه.
- بدون `--domain` اپ روی `http://IP:8000` بالا می‌آید (برای تست؛ دوربین و PWA به HTTPS نیاز دارند).
- اگر ریپو خصوصی است: `GIT_TOKEN=توکن_فقط_خواندنی` را قبل از `bash` بگذارید (`sudo GIT_TOKEN=... bash -s -- ...`).
- اجرای دوباره همان دستور، نسخه را به‌روز می‌کند و داده‌ها و رمزها را نگه می‌دارد.

ادامه این راهنما همین مراحل را دستی و با جزئیات توضیح می‌دهد.

## ۰. پیش‌نیازها

- **سرور:** حداقل ۱ هسته و ۱ گیگابایت RAM (پیشنهادی ۲ هسته و ۲ گیگابایت). با مدل زبانی اختیاری حداقل ۲ گیگابایت.
- **دیسک:** حداقل ۱۰ گیگابایت.
- **دامنه:** یک رکورد `A` (مثلاً `health.example.com`) که به IP سرور اشاره کند. برای PWA، دوربین و میکروفون **HTTPS الزامی است**، پس دامنه لازم است.
- دسترسی SSH با کاربر دارای `sudo`.

بررسی رکورد DNS از روی کامپیوتر خودتان:
```bash
dig +short health.example.com     # باید IP سرور را نشان دهد
```

---

## ۱. آماده‌سازی اولیه سرور

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ufw openssl ca-certificates

# دیوار آتش: فقط SSH و وب
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

> اگر RAM سرور ۱ گیگابایت است، یک swap بسازید تا ساخت ایمیج و OCR خطای کمبود حافظه ندهند:
> ```bash
> sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
> sudo mkswap /swapfile && sudo swapon /swapfile
> echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
> ```

---

## ۲. روش الف: Docker Compose (پیشنهادی)

### ۲.۱ نصب Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker            # یا یک بار خروج و ورود دوباره
docker --version && docker compose version
```

> **سرورهای داخل ایران:** اگر دانلود از Docker Hub خطای 403 یا timeout داد، در فایل
> `/etc/docker/daemon.json` یک **registry mirror** که در دسترس شماست تنظیم کنید و Docker را ری‌استارت کنید:
> ```json
> { "registry-mirrors": ["https://YOUR-MIRROR-ADDRESS"] }
> ```
> ```bash
> sudo systemctl restart docker
> ```
> هنگام ساخت ایمیج، پکیج‌های npm و PyPI و فایل‌های مدل هم دانلود می‌شوند. اگر این‌ها هم بسته بودند، از **روش ب** استفاده کنید یا ایمیج را جای دیگری بسازید (بخش ۲.۹).

### ۲.۲ دریافت کد

```bash
sudo mkdir -p /opt/salamat && sudo chown $USER:$USER /opt/salamat
git clone https://github.com/ehsan-bay/FastAPI.git /opt/salamat
cd /opt/salamat
git checkout claude/health-ai-app      # یا main بعد از ادغام
```

> اگر ریپو خصوصی است، یک [Personal Access Token](https://github.com/settings/tokens) (دسترسی فقط-خواندنی به ریپو) بسازید
> و هنگام `git clone` به‌جای رمز وارد کنید، یا یک Deploy Key روی سرور تنظیم کنید.

### ۲.۳ تنظیم متغیرها

```bash
cp .env.example .env
# ساخت کلید و رمز تصادفی:
sed -i "s|^SECRET_KEY=.*|SECRET_KEY=$(openssl rand -hex 32)|" .env
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env
nano .env        # DOMAIN و ACME_EMAIL را تنظیم کنید
chmod 600 .env
```

| متغیر | توضیح |
|---|---|
| `SECRET_KEY` | کلید امضای توکن ورود. **هرگز تغییرش ندهید** وگرنه همه کاربران خارج می‌شوند. |
| `POSTGRES_PASSWORD` | رمز دیتابیس. بعد از اولین اجرا تغییرش ندهید (رمز داخل دیتابیس ذخیره شده است). |
| `DOMAIN` | دامنه شما، مثلاً `health.example.com` |
| `ACME_EMAIL` | ایمیل برای گواهی SSL (Let's Encrypt) |
| `APP_BIND` | `127.0.0.1` یعنی اپ فقط از طریق Caddy/Nginx در دسترس است (امن‌تر). |
| `WITH_LLM` | `1` = نصب مدل زبانی گفتگو (حدود ۴۰۰ مگابایت، ۱ گیگابایت RAM بیشتر). |

### ۲.۴ اجرا با HTTPS خودکار (Caddy)

```bash
docker compose --profile https up -d --build
```

اولین ساخت ۵ تا ۱۵ دقیقه طول می‌کشد (ساخت PWA، نصب پکیج‌ها و دانلود حدود ۸۰ مگابایت مدل).
Caddy خودش گواهی SSL را از Let's Encrypt می‌گیرد و تمدید می‌کند.

بررسی:
```bash
docker compose ps                       # همه باید Up و healthy باشند
curl -s https://$(grep ^DOMAIN .env | cut -d= -f2)/api/health
# {"status":"ok","database":"postgresql","database_ok":true}
```

حالا `https://health.example.com` را در موبایل باز کنید.
- **اندروید (Chrome):** منوی ⋮ و بعد Add to Home screen
- **آیفون (Safari):** دکمه Share و بعد Add to Home Screen

### ۲.۵ اگر از قبل Nginx دارید (به‌جای Caddy)

پروفایل `https` را اجرا نکنید و فقط اپ و دیتابیس را بالا بیاورید:
```bash
docker compose up -d --build
sudo apt install -y nginx certbot python3-certbot-nginx
sudo cp deploy/nginx.conf /etc/nginx/sites-available/salamat
sudo nano /etc/nginx/sites-available/salamat          # server_name را عوض کنید
sudo ln -s /etc/nginx/sites-available/salamat /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d health.example.com             # HTTPS
```

### ۲.۶ به‌روزرسانی نسخه

```bash
cd /opt/salamat
./deploy/backup.sh                       # اول بکاپ
git pull
docker compose --profile https up -d --build
docker image prune -f                    # پاک کردن ایمیج‌های قدیمی
```
جدول‌های جدید دیتابیس هنگام اجرا خودکار ساخته می‌شوند و داده‌ها در volume `pgdata` می‌مانند.

### ۲.۷ بکاپ و بازیابی

```bash
./deploy/backup.sh                       # در /var/backups/salamat ذخیره می‌شود (۱۴ نسخه آخر)
```
بکاپ خودکار هر شب ساعت ۳:۳۰:
```bash
sudo mkdir -p /var/backups/salamat && sudo chown $USER /var/backups/salamat
(crontab -l 2>/dev/null; echo "30 3 * * * /opt/salamat/deploy/backup.sh >> /var/log/salamat-backup.log 2>&1") | crontab -
```
بازیابی (همه داده‌های فعلی جایگزین می‌شود):
```bash
./deploy/restore.sh /var/backups/salamat/salamat-YYYYMMDD-HHMMSS.sql.gz
```
> بکاپ‌ها را مرتب به جای دیگری هم کپی کنید (مثلاً با `rsync` یا `rclone` به یک فضای ابری). بکاپی که فقط روی همان سرور باشد، با خرابی دیسک از بین می‌رود.

### ۲.۸ دستورهای کاربردی

```bash
docker compose logs -f app               # لاگ زنده اپ
docker compose logs --tail 100 db        # لاگ دیتابیس
docker compose restart app               # ری‌استارت اپ
docker compose exec db psql -U salamat salamat   # ورود به دیتابیس
docker stats                             # مصرف RAM و CPU
```

### ۲.۹ ساخت ایمیج در جای دیگر (وقتی سرور به اینترنت آزاد دسترسی ندارد)

روی کامپیوتری که اینترنت آزاد دارد:
```bash
docker compose build
docker save salamat-ai:latest postgres:17-alpine caddy:2-alpine | gzip > salamat-images.tar.gz
scp salamat-images.tar.gz user@SERVER:/opt/salamat/
```
روی سرور:
```bash
gunzip -c salamat-images.tar.gz | docker load
docker compose --profile https up -d --no-build
```

---

## ۳. روش ب: بدون Docker (systemd + PostgreSQL محلی)

### ۳.۱ نصب پیش‌نیازها

```bash
sudo apt install -y python3 python3-venv python3-pip postgresql nginx certbot python3-certbot-nginx
# Node.js 22 برای ساخت PWA (یا dist را جای دیگری بسازید و کپی کنید)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

### ۳.۲ دیتابیس

```bash
DBPASS=$(openssl rand -hex 24); echo "DB password: $DBPASS"
sudo -u postgres psql -c "CREATE USER salamat WITH PASSWORD '$DBPASS';"
sudo -u postgres psql -c "CREATE DATABASE salamat OWNER salamat;"
```

### ۳.۳ کد، پکیج‌ها و مدل‌ها

```bash
sudo useradd --system --home-dir /opt/salamat --shell /usr/sbin/nologin salamat
sudo git clone -b claude/health-ai-app https://github.com/ehsan-bay/FastAPI.git /opt/salamat
sudo chown -R salamat:salamat /opt/salamat

cd /opt/salamat/server
sudo -u salamat python3 -m venv .venv
sudo -u salamat .venv/bin/pip install -r requirements.txt
sudo -u salamat .venv/bin/python scripts/download_models.py

cd /opt/salamat/app
sudo -u salamat npm ci
sudo -u salamat npm run build
```

### ۳.۴ فایل تنظیمات

```bash
sudo tee /opt/salamat/.env > /dev/null <<EOF
SECRET_KEY=$(openssl rand -hex 32)
DATABASE_URL=postgresql+psycopg://salamat:$DBPASS@127.0.0.1:5432/salamat
CORS_ORIGINS=*
EOF
sudo chown salamat:salamat /opt/salamat/.env && sudo chmod 600 /opt/salamat/.env
```

### ۳.۵ سرویس systemd

```bash
sudo cp /opt/salamat/deploy/salamat.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now salamat
systemctl status salamat
curl -s 127.0.0.1:8000/api/health
```
> هر worker مدل‌ها را جدا در RAM بارگذاری می‌کند. روی سرور ۱ گیگابایتی در فایل سرویس `--workers 1` بگذارید.

### ۳.۶ Nginx و HTTPS

مثل بخش ۲.۵: فایل `deploy/nginx.conf` را کپی کنید، `server_name` را عوض کنید و `certbot --nginx` را اجرا کنید.

### ۳.۷ به‌روزرسانی و بکاپ (بدون Docker)

```bash
cd /opt/salamat && sudo -u salamat git pull
sudo -u salamat server/.venv/bin/pip install -r server/requirements.txt
(cd app && sudo -u salamat npm ci && sudo -u salamat npm run build)
sudo systemctl restart salamat

# بکاپ
sudo -u postgres pg_dump salamat | gzip > /var/backups/salamat-$(date +%F).sql.gz
```

---

## ۴. اتصال اپ اندروید و iOS به سرور

- **APK آماده:** در GitHub به **Settings → Secrets and variables → Actions → Variables** بروید، متغیر
  `SERVER_URL=https://health.example.com` را بسازید و workflow را دوباره اجرا کنید. فایل APK در بخش **Artifacts** همان اجرا قرار می‌گیرد.
- **ساخت دستی:**
  ```bash
  cd app
  VITE_API_URL=https://health.example.com npm run build
  npx cap sync
  npx cap open android     # یا ios
  ```
- اگر آدرس را موقع ساخت ندهید، اپ در اولین اجرا آدرس سرور را می‌پرسد.

---

## ۵. فعال‌کردن مدل زبانی گفتگو (اختیاری)

- **Docker:** در `.env` مقدار `WITH_LLM=1` را بگذارید و دستور `docker compose --profile https up -d --build` را اجرا کنید.
- **بدون Docker:**
  ```bash
  sudo -u salamat /opt/salamat/server/.venv/bin/pip install llama-cpp-python
  sudo -u salamat /opt/salamat/server/.venv/bin/python /opt/salamat/server/scripts/download_models.py --llm
  sudo systemctl restart salamat
  ```

در صفحه تنظیمات اپ، وضعیت «مدل زبانی گفتگو» باید «فعال» شود. برای مدل قوی‌تر (مثلاً Qwen2.5-1.5B)
آدرس فایل GGUF را در متغیر `LLM_URL` بدهید و دوباره دانلود کنید.

---

## ۶. چک‌لیست امنیت

- [ ] `SECRET_KEY` و `POSTGRES_PASSWORD` تصادفی و طولانی باشند و فایل `.env` مجوز `600` داشته باشد.
- [ ] پورت‌های `8000` و `5432` از بیرون بسته باشند (`APP_BIND=127.0.0.1` و ufw).
- [ ] اپ فقط با HTTPS در دسترس باشد.
- [ ] بکاپ خودکار فعال باشد و بکاپ‌ها به جای دیگری هم کپی شوند.
- [ ] به‌روزرسانی امنیتی خودکار سیستم‌عامل فعال باشد: `sudo apt install unattended-upgrades`
- [ ] اگر `CORS_ORIGINS` را محدود می‌کنید، برای اپ‌های موبایل این مبدأها را هم نگه دارید: `https://localhost` (اندروید) و `capacitor://localhost` (iOS).

---

## ۷. رفع مشکلات رایج

| مشکل | علت و راه‌حل |
|---|---|
| `/api/health` خطای 503 و `database_ok: false` می‌دهد | دیتابیس بالا نیست یا رمز اشتباه است: `docker compose logs db`. اگر رمز `.env` را بعد از اولین اجرا عوض کرده‌اید، رمز قبلی را برگردانید. |
| گواهی SSL صادر نمی‌شود | رکورد DNS هنوز به سرور اشاره نمی‌کند یا پورت 80/443 بسته است: `docker compose logs caddy` |
| بخش‌های غذا، پوست یا آزمایش خطای «مدل نصب نشده» می‌دهند | دانلود مدل‌ها شکست خورده است: `docker compose exec app python scripts/download_models.py` |
| دوربین یا میکروفون کار نمی‌کند | سایت باید HTTPS باشد و مجوز دوربین/میکروفون در مرورگر داده شده باشد. |
| ساخت ایمیج با خطای حافظه متوقف می‌شود | swap اضافه کنید (بخش ۱) یا ایمیج را جای دیگری بسازید (بخش ۲.۹). |
| گزینه نصب PWA نمایش داده نمی‌شود | سایت باید HTTPS باشد. یک بار صفحه را کامل بارگذاری کنید و در آیفون فقط از Safari استفاده کنید. |
| خطای 413 هنگام آپلود عکس | محدودیت حجم در Nginx: `client_max_body_size 12m` |
