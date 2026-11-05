#!/usr/bin/env bash
# Join the parts, verify, unpack and install Salamat AI fully offline.
#   sudo bash run.sh                         # http://SERVER_IP:8000
#   sudo bash run.sh --domain demo.example.com   # with HTTPS
set -euo pipefail
cd "$(dirname "$0")"
echo "==> joining parts"
cat salamat-offline.tar.part-* > salamat-offline.tar
echo "==> verifying checksum"
sha256sum -c SHA256SUMS
echo "==> unpacking"
tar -xf salamat-offline.tar
rm -f salamat-offline.tar
exec bash salamat-offline/install.sh --offline salamat-offline "$@"
