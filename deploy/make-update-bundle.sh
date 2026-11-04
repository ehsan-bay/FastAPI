#!/usr/bin/env bash
# Build a small update bundle (a few MB): only server code + built web app.
# It is applied on top of the image already on the server, so Python packages and
# AI models are not downloaded again. If those changed, the full offline bundle is needed.
#
#   deploy/make-update-bundle.sh [OUT_FILE]     # default: salamat-update.tar.gz
# On the server:  sudo bash update.sh salamat-update.tar.gz
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="${1:-salamat-update.tar.gz}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
U="$WORK/salamat-update"
mkdir -p "$U"

echo "building web app"
(cd app && npm run build >/dev/null)

echo "packing"
# Server code and deploy files (no docs, no native projects: not needed on the server).
git archive --format=tar.gz -o "$U/source.tar.gz" HEAD -- . ':!docs' ':!app/android' ':!app/ios'
tar -C app/dist -czf "$U/web.tar.gz" .
git rev-parse HEAD > "$U/VERSION"
# Fingerprint of what lives in the base image (packages + models). Must match the server's image.
cat server/requirements.txt server/scripts/download_models.py | sha256sum | cut -c1-16 > "$U/DEPS"
cp deploy/update.sh "$U/update.sh"
chmod +x "$U/update.sh"

tar -C "$WORK" -czf "$OUT" salamat-update
echo "update bundle ready: $OUT ($(du -h "$OUT" | cut -f1)), version $(cut -c1-7 "$U/VERSION"), deps $(cat "$U/DEPS")"
