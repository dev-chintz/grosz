#!/bin/sh
# Wydanie nowej wersji na NAS. Uruchom na QNAP: sh deploy/deploy.sh
# Kolejność: kod → obraz → kopia bazy → migracje → aplikacja → test zdrowia.
# Gdy coś się nie uda, skrypt staje (set -e) i dotychczasowa wersja działa dalej.
set -eu
cd "$(dirname "$0")/.."

echo "== Pobieram kod z GitHuba"
docker run --rm -v "$PWD":/git -v "$PWD/.deploy":/k:ro -w /git \
  -e GIT_SSH_COMMAND='ssh -i /k/id_ed25519 -o UserKnownHostsFile=/k/known_hosts' \
  alpine/git pull --ff-only

echo "== Buduję obraz"
docker compose build

echo "== Kopia bazy przed migracją"
sh deploy/backup.sh pre-deploy

echo "== Migracje"
docker compose run --rm migrate

echo "== Uruchamiam aplikację"
docker compose up -d app

echo "== Sprawdzam, czy wstała"
for i in 1 2 3 4 5 6 7 8 9 10; do
  if docker compose exec -T app wget -qO- http://localhost:3000/api/health; then
    echo; echo "== Gotowe: http://DOMOWY:8090"
    exit 0
  fi
  sleep 3
done
echo "!! Aplikacja nie odpowiada — sprawdź: docker compose logs app" >&2
exit 1
