#!/usr/bin/env bash
# Daily PostgreSQL backup for Salamat AI. Keeps the last 14 dumps.
#   crontab:  30 3 * * * /opt/salamat/deploy/backup.sh >> /var/log/salamat-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
POSTGRES_USER="${POSTGRES_USER:-salamat}"
POSTGRES_DB="${POSTGRES_DB:-salamat}"
DEST="${BACKUP_DIR:-/var/backups/salamat}"
mkdir -p "$DEST"
FILE="$DEST/salamat-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner | gzip > "$FILE"
ls -1t "$DEST"/salamat-*.sql.gz | tail -n +15 | xargs -r rm --
echo "$(date -Is) backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
