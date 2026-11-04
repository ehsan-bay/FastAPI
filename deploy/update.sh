#!/usr/bin/env bash
# Light update for an installed Salamat AI: replaces only the code and web app inside the
# current Docker image (no internet, no package or model downloads). Keeps data and .env.
# Rolls back automatically if the new version does not start.
#
#   sudo bash update.sh [salamat-update.tar.gz | salamat-update/] [--dir /opt/salamat]
set -euo pipefail

SRC=""
DIR="/opt/salamat"
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) SRC="$1"; shift ;;
  esac
done

log() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root (use sudo)"
[ -n "$SRC" ] || SRC="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SRC" ]; then
  tmp="$(mktemp -d)"
  tar -xzf "$SRC" -C "$tmp"
  SRC="$tmp/salamat-update"
fi
SRC="$(cd "$SRC" && pwd)"
for f in source.tar.gz web.tar.gz VERSION DEPS; do [ -f "$SRC/$f" ] || die "update bundle is incomplete: $f missing"; done
[ -f "$DIR/docker-compose.yml" ] || die "no installation found in $DIR (use the full bundle first)"
cd "$DIR"

IMAGE="salamat-ai:latest"
docker image inspect "$IMAGE" >/dev/null 2>&1 || die "image $IMAGE not found; install with the full offline bundle first"

# Packages and models must be the same as in the current image.
have=$(docker run --rm --entrypoint sh -w /srv/server "$IMAGE" -c \
  "echo \$(cat requirements.txt scripts/download_models.py | sha256sum | cut -c1-16) \$(cd /srv/web/mediapipe && find . -type f -printf '%p %s\\n' | sort | sha256sum | cut -c1-16)")
want=$(cat "$SRC/DEPS")
if [ "$have" != "$want" ]; then
  die "this version changes Python packages or AI models, so the light update is not enough.
Run the full bundle once instead:
  cd ~ && rm -rf salamat-bundle && git clone --depth 1 -b offline-bundle https://github.com/ehsan-bay/FastAPI.git salamat-bundle && cd salamat-bundle && sudo bash run.sh"
fi

new_version=$(cut -c1-7 "$SRC/VERSION")
old_version=$(docker run --rm --entrypoint sh "$IMAGE" -c 'cat /srv/VERSION 2>/dev/null || echo unknown' | cut -c1-7)
log "updating $old_version -> $new_version"

# 1) code and deploy files (.env and data are not in the archive, so they are kept)
tar -xzf "$SRC/source.tar.gz" -C "$DIR"

# 2) new image = current image + new code and web app (built locally, nothing is downloaded)
ctx="$(mktemp -d)"
cp -a "$DIR/server" "$ctx/server"
mkdir -p "$ctx/web" && tar -xzf "$SRC/web.tar.gz" -C "$ctx/web"
cp "$SRC/VERSION" "$ctx/VERSION"
cat > "$ctx/Dockerfile" <<'EOF'
FROM salamat-ai:latest
RUN rm -rf /srv/server/app && find /srv/web -mindepth 1 -maxdepth 1 ! -name mediapipe -exec rm -rf {} +
COPY server/ /srv/server/
COPY web/ /srv/web/
COPY VERSION /srv/VERSION
EOF
docker tag "$IMAGE" salamat-ai:previous
log "building the updated image (seconds)"
DOCKER_BUILDKIT=0 docker build -q -t "$IMAGE" "$ctx" >/dev/null 2>&1 || docker build -q -t "$IMAGE" "$ctx" >/dev/null
rm -rf "$ctx"

# 3) restart and check; roll back on failure
grep -q '^APP_IMAGE=' .env && sed -i 's|^APP_IMAGE=.*|APP_IMAGE=salamat-ai:latest|' .env
profile=()
if grep -qE '^DOMAIN=.+' .env && ! grep -qE '^DOMAIN=(localhost|health\.example\.com)$' .env && docker compose ps --services 2>/dev/null | grep -q caddy; then
  profile=(--profile https)
fi
docker compose "${profile[@]}" up -d --no-build app >/dev/null 2>&1 || docker compose "${profile[@]}" up -d --no-build
log "waiting for the app"
ok=0
for _ in $(seq 1 60); do
  if docker compose exec -T app python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health').status==200 else 1)" >/dev/null 2>&1; then
    ok=1; break
  fi
  sleep 3
done
if [ "$ok" != 1 ]; then
  docker compose logs --tail 40 app || true
  log "new version did not start: rolling back to $old_version"
  docker tag salamat-ai:previous "$IMAGE"
  docker compose "${profile[@]}" up -d --no-build app >/dev/null 2>&1 || true
  die "update failed; the previous version is running again"
fi
docker image prune -f >/dev/null 2>&1 || true
log "updated to $new_version"
