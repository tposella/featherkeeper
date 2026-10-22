#!/usr/bin/env bash
# Back up Featherkeeper's database and photos into one dated folder.
#   ./deploy/backup.sh /path/to/backups        (run from the repo folder)
# Schedule it with cron, e.g. nightly at 03:15:
#   15 3 * * * cd /opt/featherkeeper && ./deploy/backup.sh /mnt/backups/featherkeeper >> /var/log/featherkeeper-backup.log 2>&1
set -euo pipefail

DEST="${1:?Usage: backup.sh <backup folder>}"
STAMP="$(date +%Y-%m-%d_%H%M)"
OUT="$DEST/$STAMP"
mkdir -p "$OUT"

# Database: a consistent dump taken while the app keeps running.
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$OUT/database.dump"

# Photos: copied straight out of the API container's /data.
docker compose exec -T api tar -C /data -cf - photos > "$OUT/photos.tar"

echo "Backed up to $OUT ($(du -sh "$OUT" | cut -f1))"

# Keep the 14 most recent backups.
ls -1d "$DEST"/*/ 2>/dev/null | sort | head -n -14 | xargs -r rm -rf
