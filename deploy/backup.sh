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
dump="backups/grosz-$(date +%Y%m%d-%H%M%S)-$label.sql"

# Najpierw zrzut do pliku, potem kompresja. Przy `pg_dump | gzip` błąd pg_dump by zginął
# (sh na NAS nie ma pipefail) i powstałaby pusta „kopia”, a deploy.sh poszedłby dalej do migracji.
# pg_dump musi być w wersji ≥ serwera — dlatego obraz z PG_IMAGE, nie stały.
if ! docker run --rm --network "${PG_NETWORK:-anvero-db_default}" "${PG_IMAGE:-postgres:17-alpine}" \
  pg_dump --no-owner --no-privileges "$DATABASE_URL" > "$dump"; then
  rm -f "$dump"
  echo "!! Kopia bazy NIE powstała — przerywam." >&2
  exit 1
fi
gzip "$dump"

echo "Kopia: $dump.gz ($(du -h "$dump.gz" | cut -f1))"
ls -1t backups/grosz-*.sql.gz | tail -n +31 | xargs -r rm --
