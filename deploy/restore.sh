#!/usr/bin/env bash
# Restore a backup made by backup.sh:  deploy/restore.sh /var/backups/salamat/salamat-XXXX.sql.gz
set -euo pipefail
[ $# -eq 1 ] || { echo "usage: $0 BACKUP.sql.gz"; exit 1; }
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
POSTGRES_USER="${POSTGRES_USER:-salamat}"
POSTGRES_DB="${POSTGRES_DB:-salamat}"
read -rp "This replaces ALL data in database '$POSTGRES_DB'. Type yes to continue: " ok
[ "$ok" = "yes" ] || exit 1
docker compose stop app
docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\";" -c "CREATE DATABASE \"$POSTGRES_DB\" OWNER \"$POSTGRES_USER\";"
gunzip -c "$1" | docker compose exec -T db psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"
docker compose start app
echo "restored $1"
