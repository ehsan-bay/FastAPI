#!/usr/bin/env bash
# One-command installer for Salamat AI on a fresh Ubuntu/Debian server.
#
#   curl -fsSL https://raw.githubusercontent.com/ehsan-bay/FastAPI/claude/health-ai-app/deploy/install.sh | sudo bash -s -- --domain demo.example.com --email you@example.com
#
# Options:
#   --domain NAME   public domain (DNS A record must point here) -> automatic HTTPS with Caddy
#                   without it the app runs on http://SERVER_IP:8000 (camera/mic/PWA need HTTPS)
#   --email ADDR    email for the Let's Encrypt certificate (optional)
#   --branch NAME   git branch (default: claude/health-ai-app)
#   --dir PATH      install directory (default: /opt/salamat)
#   --llm           also install the optional chat LLM (needs ~8 GB RAM)
#   --no-backup     do not add the nightly database backup
#   --build         build the image on this server instead of pulling the prebuilt one
#                   (needs PyPI, npm and Google storage; see --pip-mirror)
#   --image REF     prebuilt image to pull (default: ghcr.io/ehsan-bay/salamat-ai:latest)
#   --pip-mirror URL  PyPI mirror for --build, e.g. https://mirror.example/simple
# Env: GIT_TOKEN=...  GitHub token for a private repository; also used to pull the private image
#      (classic token with "repo" and "read:packages")
# Re-running the script updates an existing install and keeps its data and secrets.
set -euo pipefail

REPO="github.com/ehsan-bay/FastAPI.git"
BRANCH="claude/health-ai-app"
DIR="/opt/salamat"
DOMAIN=""
EMAIL=""
WITH_LLM=0
BUILD=0
IMAGE="ghcr.io/ehsan-bay/salamat-ai:latest"
PIP_MIRROR=""
BACKUP=1

log() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --dir) DIR="${2:-}"; shift 2 ;;
    --llm) WITH_LLM=1; shift ;;
    --no-backup) BACKUP=0; shift ;;
    --build) BUILD=1; shift ;;
    --image) IMAGE="${2:-}"; shift 2 ;;
    --pip-mirror) PIP_MIRROR="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "run as root (use sudo)"
command -v apt-get >/dev/null || die "this script supports Ubuntu/Debian (apt) only"

# --- checks -------------------------------------------------------------
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
disk_gb=$(df -Pk / | awk 'NR==2 {print int($4/1024/1024)}')
log "server: $(nproc) CPU, ${mem_mb} MB RAM, ${disk_gb} GB free disk"
[ "$mem_mb" -ge 1800 ] || warn "less than 2 GB RAM; adding swap is recommended"
[ "$disk_gb" -ge 10 ] || die "need at least 10 GB free disk"
if [ "$WITH_LLM" = 1 ] && [ "$mem_mb" -lt 7000 ]; then warn "--llm needs ~8 GB RAM; continuing anyway"; fi

if [ "$mem_mb" -lt 3000 ] && ! swapon --show | grep -q .; then
  log "adding 2 GB swap"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --- packages -----------------------------------------------------------
log "installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates openssl >/dev/null

if ! command -v docker >/dev/null; then
  log "installing Docker"
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker compose version >/dev/null 2>&1 || die "docker compose v2 is missing (install docker-compose-plugin)"

# --- code ---------------------------------------------------------------
url="https://${REPO}"
[ -n "${GIT_TOKEN:-}" ] && url="https://x-access-token:${GIT_TOKEN}@${REPO}"
if [ -d "$DIR/.git" ]; then
  log "updating code in $DIR"
  git -C "$DIR" fetch -q origin "$BRANCH"
  git -C "$DIR" checkout -q "$BRANCH"
  git -C "$DIR" reset -q --hard "origin/$BRANCH"
else
  log "downloading code to $DIR"
  mkdir -p "$(dirname "$DIR")"
  git clone -q --depth 1 -b "$BRANCH" "$url" "$DIR" || die "git clone failed (private repo? set GIT_TOKEN)"
fi
# never keep the token in the saved remote URL
git -C "$DIR" remote set-url origin "https://${REPO}"
cd "$DIR"

# --- configuration ------------------------------------------------------
set_env() {  # set_env KEY VALUE  (adds or replaces a line in .env)
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}
if [ ! -f .env ]; then
  log "creating .env with random secrets"
  cp .env.example .env
  set_env SECRET_KEY "$(openssl rand -hex 32)"
  set_env POSTGRES_PASSWORD "$(openssl rand -hex 24)"
fi
chmod 600 .env
set_env WITH_LLM "$WITH_LLM"
if [ "$WITH_LLM" = 1 ] && [ "$BUILD" = 0 ]; then
  warn "--llm needs a local build; switching to --build"; BUILD=1
fi
if [ "$BUILD" = 1 ]; then
  set_env APP_IMAGE "salamat-ai:latest"
else
  set_env APP_IMAGE "$IMAGE"
fi
# Re-running without --domain keeps the domain from an earlier install.
if [ -z "$DOMAIN" ]; then
  prev=$(grep -E '^DOMAIN=' .env | cut -d= -f2- || true)
  case "$prev" in ""|localhost|health.example.com) ;; *) DOMAIN="$prev"; log "using existing domain $DOMAIN" ;; esac
fi
if [ -n "$DOMAIN" ]; then
  set_env DOMAIN "$DOMAIN"
  [ -n "$EMAIL" ] && set_env ACME_EMAIL "$EMAIL"
  set_env APP_BIND 127.0.0.1
  PROFILE=(--profile https)
  URL="https://$DOMAIN"
else
  set_env APP_BIND 0.0.0.0
  PROFILE=()
  URL="http://$(curl -fsS4 --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}'):8000"
  warn "no --domain given: running on plain HTTP; camera, microphone and PWA install need HTTPS"
fi

# --- firewall -----------------------------------------------------------
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  log "opening firewall ports"
  ufw allow OpenSSH >/dev/null
  if [ -n "$DOMAIN" ]; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; else ufw allow 8000/tcp >/dev/null; fi
fi

# --- start --------------------------------------------------------------
if [ "$BUILD" = 1 ]; then
  log "building the image on this server (5-15 minutes)"
  BUILD_ARGS=()
  [ -n "$PIP_MIRROR" ] && BUILD_ARGS=(--build-arg "PIP_INDEX_URL=$PIP_MIRROR")
  docker compose build "${BUILD_ARGS[@]}" app
else
  log "downloading the prebuilt image $IMAGE"
  token="${GHCR_TOKEN:-${GIT_TOKEN:-}}"
  if [ -n "$token" ]; then
    echo "$token" | docker login ghcr.io -u "${GHCR_USER:-token}" --password-stdin >/dev/null \
      || die "login to ghcr.io failed (token needs read:packages)"
  fi
  docker compose pull app || die "could not pull $IMAGE.
  - private image? run with GIT_TOKEN=<token with read:packages>
  - ghcr.io blocked? use --build (with --pip-mirror if pypi.org is blocked)"
fi
log "starting"
docker compose "${PROFILE[@]}" up -d --no-build

log "waiting for the app to become healthy"
ok=0
for _ in $(seq 1 90); do
  if docker compose exec -T app python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health').status==200 else 1)" >/dev/null 2>&1; then
    ok=1; break
  fi
  sleep 5
done
[ "$ok" = 1 ] || { docker compose logs --tail 50 app; die "app did not become healthy; see logs above"; }

# --- nightly backup -----------------------------------------------------
if [ "$BACKUP" = 1 ]; then
  mkdir -p /var/backups/salamat
  line="30 3 * * * BACKUP_DIR=/var/backups/salamat $DIR/deploy/backup.sh >> /var/log/salamat-backup.log 2>&1"
  { crontab -l 2>/dev/null | grep -v 'deploy/backup.sh' || true; echo "$line"; } | crontab -
  log "nightly backup scheduled (03:30) -> /var/backups/salamat"
fi

models=$(docker compose exec -T app python -c "import urllib.request,json; print(json.load(urllib.request.urlopen('http://127.0.0.1:8000/api/models'))['server'])" 2>/dev/null || echo "?")
echo
log "Salamat AI is running: $URL"
log "AI models on the server: $models"
[ -n "$DOMAIN" ] && log "if HTTPS does not work yet: check the DNS A record and that ports 80/443 are open (docker compose logs caddy)"
log "update later by running this script again; logs: cd $DIR && docker compose logs -f app"
