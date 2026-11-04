#!/usr/bin/env bash
# Build an offline install bundle: every Docker image + source code + installer in one file.
# The target server then needs no internet at all.
#
#   docker build -t salamat-ai:latest .        # app image (includes web app and AI models)
#   deploy/make-offline-bundle.sh [OUT_FILE]   # default: salamat-offline.tar
#
# On the server:  tar -xf salamat-offline.tar && sudo bash salamat-offline/install.sh --offline salamat-offline
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="${1:-salamat-offline.tar}"
APP_IMAGE="${APP_IMAGE:-salamat-ai:latest}"
EXTRA_IMAGES=(postgres:17-alpine caddy:2-alpine)
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
B="$WORK/salamat-offline"
mkdir -p "$B"

docker image inspect "$APP_IMAGE" >/dev/null 2>&1 || { echo "missing image $APP_IMAGE (build it first)" >&2; exit 1; }
for img in "${EXTRA_IMAGES[@]}"; do
  docker image inspect "$img" >/dev/null 2>&1 || docker pull "$img"
done
# Always ship the app under the name docker-compose uses for local images.
[ "$APP_IMAGE" = "salamat-ai:latest" ] || docker tag "$APP_IMAGE" salamat-ai:latest

echo "saving images (this takes a few minutes)"
docker save salamat-ai:latest "${EXTRA_IMAGES[@]}" | gzip -1 > "$B/images.tar.gz"

echo "packing source"
if git rev-parse --git-dir >/dev/null 2>&1; then
  git archive --format=tar.gz -o "$B/source.tar.gz" HEAD
  git rev-parse HEAD > "$B/VERSION"
else
  tar --exclude=.git --exclude=node_modules --exclude=.venv -czf "$B/source.tar.gz" .
  date -u +%Y%m%d%H%M > "$B/VERSION"
fi
cp deploy/install.sh "$B/install.sh"
chmod +x "$B/install.sh"
cat > "$B/README.txt" <<'EOF'
Salamat AI - offline install bundle (no internet needed on the server)

1) Copy salamat-offline.tar to the server (e.g. with MobaXterm SFTP or scp).
2) On the server:
     tar -xf salamat-offline.tar
     sudo bash salamat-offline/install.sh --offline salamat-offline
   With a domain and HTTPS:
     sudo bash salamat-offline/install.sh --offline salamat-offline --domain demo.example.com
3) Open the address printed at the end.
Docker must already be installed, or available from the server's apt mirror (docker.io).
EOF

tar -C "$WORK" -cf "$OUT" salamat-offline
echo "bundle ready: $OUT ($(du -h "$OUT" | cut -f1)), version $(cat "$B/VERSION")"
