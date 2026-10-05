#!/bin/sh
# Kopia bazy: sh deploy/backup.sh [etykieta]. Zostawia 30 najnowszych plików w backups/.
set -eu
cd "$(dirname "$0")/.."

# Wczytaj DATABASE_URL i PG_IMAGE z .env.
set -a
. ./.env
set +a

label="${1:-manual}"
mkdir -p backups
file="backups/grosz-$(date +%Y%m%d-%H%M%S)-$label.sql.gz"

# pg_dump musi być w wersji ≥ serwera — dlatego obraz z PG_IMAGE, nie stały.
docker run --rm --add-host=host.docker.internal:host-gateway "${PG_IMAGE:-postgres:17-alpine}" \
  pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip > "$file"

echo "Kopia: $file ($(du -h "$file" | cut -f1))"
ls -1t backups/grosz-*.sql.gz | tail -n +31 | xargs -r rm --
