#!/bin/sh
# Wydanie nowej wersji na NAS. Uruchom na QNAP: sh deploy/deploy.sh
# Kolejność: kod → obraz → kopia bazy → migracje → pusty budżet (1. raz) → aplikacja → test zdrowia.
# Gdy coś się nie uda, skrypt staje (set -e) i dotychczasowa wersja działa dalej.
set -eu
cd "$(dirname "$0")/.."

# Kod pobieramy z publicznymi DNS-ami: zarówno DNS Container Station (10.0.3.1), jak i resolver NAS-a
# bywa chwilowo zawodny („Could not resolve host: github.com”). Do tego trzy próby.
pull() {
  for attempt in 1 2 3; do
    # Publiczne DNS-y: lokalny resolver NAS-a i Container Station zwracają czasem pustą odpowiedź dla github.com.
    if docker run --rm --dns 1.1.1.1 --dns 8.8.8.8 -v "$PWD":/git -w /git alpine/git pull --ff-only; then
      return 0
    fi
    echo "   (próba $attempt nieudana)"
    [ "$attempt" -lt 3 ] && sleep 5
  done
  return 1
}

# Całość w funkcji: sh wczytuje ją w całości przed startem, więc `git pull` podmieniający
# ten plik w trakcie działania nie zmieni kroków, które właśnie się wykonują.
main() {
  echo "== Pobieram kod z GitHuba (repo publiczne, bez kluczy)"
  pull

  echo "== Buduję obraz"
  docker compose build

  echo "== Kopia bazy przed migracją"
  sh deploy/backup.sh pre-deploy

  echo "== Migracje"
  docker compose run --rm migrate

  echo "== Pusty budżet (tylko na świeżej bazie; potem nic nie robi)"
  docker compose run --rm migrate node server/src/bootstrap.ts

  echo "== Uruchamiam aplikację"
  docker compose up -d app

  echo "== Sprawdzam, czy wstała"
  # Pierwszy start na NAS trwa ponad 30 s — czekamy do 2 minut.
  for i in $(seq 1 40); do
    if docker compose exec -T app wget -qO- http://localhost:3000/api/health; then
      echo
      echo "== Gotowe: http://192.168.1.9:8090 (w domu) · http://100.112.158.37:8090 (Tailscale)"
      return 0
    fi
    sleep 3
  done
  echo "!! Aplikacja nie odpowiada — sprawdź: docker compose logs app" >&2
  return 1
}

main "$@"
exit $?
