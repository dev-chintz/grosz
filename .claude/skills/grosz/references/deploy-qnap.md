# grosz — baza danych, migracje i wdrożenie na QNAP

## Spis treści
1. Jak to jest poukładane
2. Do potwierdzenia (wartości oznaczone ⟨…⟩)
3. Migracje bazy (Drizzle)
4. Docker: obraz i compose
5. Wydanie nowej wersji na NAS
6. Kopie zapasowe i przywracanie
7. Praca lokalna
8. Typowe problemy

## 1. Jak to jest poukładane

```
PC (Windows, C:\Users\Chintz\projects\budzet)
   │  git push
   ▼
GitHub — prywatne repozytorium ⟨REPO⟩
   │  git pull przez SSH z kluczem tylko do odczytu (deploy key)
   ▼
QNAP „DOMOWY” (w sieci Tailscale: 100.112.158.37), Container Station
   ├─ katalog ⟨APP_DIR⟩ z kopią repo + .env + .deploy/id_ed25519 (poza gitem)
   ├─ docker compose: usługa `migrate` (jednorazowa) → usługa `app` na porcie 8090
   └─ PostgreSQL w osobnym kontenerze anvero-db-db-1, port 5432 wystawiony na NAS; baza `grosz`, użytkownik `grosz`
```

Aplikacja: `http://DOMOWY:8090` — działa w sieci domowej i z każdego urządzenia w tej samej sieci Tailscale.

Dlaczego obraz budujemy na NAS, a nie na PC: QNAP może mieć procesor ARM albo x86, a obraz zbudowany na miejscu zawsze pasuje do jego architektury. Poza tym na dysku C: w PC jest mało miejsca, a Docker Desktop trzyma obrazy właśnie tam.

Kopia robocza projektu zostaje na C: — nie na `H:` (`\\DOMOWY\Kopie`). To udział sieciowy: `node_modules` (dziesiątki tysięcy plików) instaluje się przez SMB bardzo wolno, a podgląd na żywo Vite często nie widzi zmian.

## 2. Do potwierdzenia

Gdy trafisz na wartość ⟨…⟩, zapytaj użytkownika i wpisz odpowiedź tutaj, żeby nie pytać drugi raz.

| Wartość | Ustalenie | Status |
|---|---|---|
| Repozytorium | prywatne repo na GitHubie; NAS pobiera przez SSH z deploy key (tylko odczyt) | ustalone 2026-10-06 |
| ⟨REPO⟩ — adres repo | `git@github.com:<konto>/grosz.git` | do uzupełnienia |
| ⟨APP_DIR⟩ — katalog aplikacji na NAS | `/share/Container/grosz` | do potwierdzenia |
| PostgreSQL | w kontenerze w Container Station, port 5432 wystawiony na NAS | ustalone 2026-10-06 |
| anvero-db-db-1 — nazwa kontenera Postgresa | `anvero-db-db-1` (należy do stosu innego projektu użytkownika, Anvero; grosz ma w nim osobną bazę i osobnego użytkownika, nie dotykaj bazy Anvero) | ustalone 2026-10-06 |
| Wersja PostgreSQL | **17** (obraz `postgres:17`) → `PG_IMAGE=postgres:17-alpine` do kopii zapasowych | ustalone 2026-10-06 |
| Port aplikacji | **8090** (8080, 8081 i 3000 są na NAS zajęte — sprawdzone 2026-10-06; wolne były też 8088, 8180, 8484, 8765, 9080) | ustalone 2026-10-06 |

## 3. Migracje bazy (Drizzle)

Schemat żyje w `server/src/db/schema.ts`, migracje SQL w `server/drizzle/`.

Przepływ przy każdej zmianie schematu:
1. Zmień `schema.ts`.
2. Wygeneruj migrację: `npm run db:generate -- --name <krótki_opis_po_angielsku>` (bez `--name` drizzle nada losową nazwę typu `majestic_loners` — wtedy zmień nazwę pliku i `tag` w `drizzle/meta/_journal.json`).
3. **Przeczytaj wygenerowany SQL.** drizzle-kit przy zmianie nazwy kolumny potrafi wygenerować `DROP` + `ADD`, co kasuje dane. Jeśli widzisz `DROP COLUMN`/`DROP TABLE`, upewnij się, że to zamierzone, i powiedz o tym użytkownikowi.
4. Zastosuj lokalnie (`npm run db:migrate` w `server/`), uruchom testy.
5. Commit razem ze zmianą kodu, który z niej korzysta.

Zasady i powody:
- Nie używaj `drizzle-kit push` wobec bazy na NAS — omija pliki migracji, więc baza produkcyjna przestaje odpowiadać historii w repozytorium.
- Nie edytuj migracji, która trafiła już na NAS — Drizzle zapisuje, które pliki zastosował, i zmienionego nie uruchomi ponownie. Popraw błąd nową migracją.
- Zmiany niszczące rób w dwóch wydaniach: najpierw dodaj nową kolumnę i przepisz dane, dopiero w kolejnym wydaniu usuń starą. Dzięki temu cofnięcie aplikacji o jedną wersję nie zostawia jej bez kolumny.
- Kwoty jako `integer` w groszach (lub `bigint` dla sum), daty płatności jako `date`, każda tabela budżetu z `household_id` + indeks na nim.

Migracje uruchamia osobny, jednorazowy skrypt `server/src/migrate.ts` (migrator Drizzle dla node-postgres albo PGlite), a nie start aplikacji. Jeśli migracja się wywali, stara wersja aplikacji dalej działa, zamiast restartować się w kółko.

## 4. Docker: obraz i compose

Jeden obraz, dwa tryby uruchomienia (migracja / aplikacja). Fastify serwuje API pod `/api` i zbudowany frontend (`@fastify/static`) — jeden kontener, jeden port. Ścieżki ekranów (np. `/cykliczne`) dostają `index.html`, ale brakujące pliki z rozszerzeniem — 404, żeby stary `.js` po wdrożeniu nie dostawał HTML-a.

Pliki w repo — to one są źródłem prawdy, nie kopiuj ich treści tutaj:
- `Dockerfile`: etap `build` buduje tylko frontend (Vite); obraz końcowy to `node:24-alpine` z zależnościami produkcyjnymi serwera i źródłami `shared/src` + `server/src` (Node 24 uruchamia TS bez kompilacji), `server/drizzle` i `web/dist`. Działa jako użytkownik `node`.
- `compose.yaml`: usługa `migrate` (profil `tools`, nie startuje przy zwykłym `up`) i `app` na porcie **8090**, obie z `extra_hosts: host.docker.internal:host-gateway` i healthcheckiem `/api/health`.
- `.dockerignore`: bez `node_modules`, `.data`, `.git`, `.claude`, testów.
- `.gitattributes`: końce linii LF — skrypty `.sh` z CRLF nie uruchomią się na NAS.

`.env` na NAS (nigdy w gicie; wzór w `.env.example`):
```
DATABASE_URL=postgres://grosz:<hasło>@host.docker.internal:5432/grosz
PG_IMAGE=postgres:<wersja serwera>-alpine
```

Dlaczego `host.docker.internal`: Postgres działa w innym kontenerze i ma port 5432 wystawiony na NAS. `localhost` wewnątrz kontenera `app` wskazuje na sam kontener, nie na NAS; wpis `extra_hosts: host-gateway` w compose daje nazwę, która zawsze prowadzi do NAS. Gdyby to nie działało na danej wersji Container Station, alternatywą jest dołączenie `app` do sieci dockerowej Postgresa (`networks: external`) i użycie nazwy anvero-db-db-1 jako hosta.

Baza i użytkownik dla aplikacji (jednorazowo, hasło wygeneruj losowo i wpisz tylko do `.env` na NAS):
```sh
# administrator w tym kontenerze nie musi nazywać się „postgres” — sprawdź:
docker exec anvero-db-db-1 printenv POSTGRES_USER
docker exec -it anvero-db-db-1 psql -U <POSTGRES_USER> -d postgres -c "CREATE ROLE grosz LOGIN PASSWORD '<hasło>';" -c "CREATE DATABASE grosz OWNER grosz;"
```
Aplikacja łączy się jako `grosz`, nie jako `postgres` — błąd w aplikacji nie może wtedy ruszyć innych baz na tym serwerze.

Aplikacja ma endpoint `GET /api/health`, który sprawdza połączenie z bazą — healthcheck i skrypt wdrożenia na nim polegają.

## 5. Wydanie nowej wersji na NAS

Na QNAP domyślnie nie ma gita, więc używamy go z jednorazowego kontenera `alpine/git` — nic nie instalujemy na samym NAS.

**Dostęp NAS do prywatnego repo (jednorazowo):** klucz SSH tylko do odczytu, dodany w GitHubie jako *Deploy key* repozytorium (Settings → Deploy keys, bez „Allow write access”). Działa wyłącznie dla tego jednego repo, więc wyciek klucza nie daje dostępu do reszty konta.
```sh
mkdir -p ⟨APP_DIR⟩/.deploy && cd ⟨APP_DIR⟩
docker run --rm -v "$PWD/.deploy":/k --entrypoint ssh-keygen alpine/git -t ed25519 -N "" -C "grosz-nas-deploy" -f /k/id_ed25519
cat .deploy/id_ed25519.pub     # tę linię wkleja użytkownik w GitHubie jako Deploy key
GIT_SSH='ssh -i /k/id_ed25519 -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/k/known_hosts'
docker run --rm -v "$PWD":/git -v "$PWD/.deploy":/k -e GIT_SSH_COMMAND="$GIT_SSH" -w /git alpine/git clone ⟨REPO⟩ .
```
Klucz prywatny nie opuszcza NAS. Katalog `.deploy/` jest w `.gitignore`.

Skrypt `deploy/deploy.sh` (w repo; na NAS: `ssh admin@DOMOWY 'sh ⟨APP_DIR⟩/deploy/deploy.sh'`) robi kolejno: `git pull --ff-only` kluczem deploy → `docker compose build` → `deploy/backup.sh pre-deploy` → `docker compose run --rm migrate` → `docker compose up -d app` → do 30 s sprawdzania `/api/health`.

Kolejność ma znaczenie: kopia → migracja → nowa aplikacja. Jeśli migracja się nie uda, skrypt zatrzymuje się (`set -e`) przed podmianą aplikacji, a kopia pozwala wrócić do stanu sprzed wydania.

Przed wdrożeniem upewnij się, że zmiany są wypchnięte (`git status`, `git push`), i powiedz użytkownikowi, co wchodzi w wydanie (lista commitów od ostatniego wdrożenia). Wdrożenie dotyka danych finansowych — uruchamiaj je tylko na wyraźną prośbę.

## 6. Kopie zapasowe i przywracanie

`deploy/backup.sh` robi `pg_dump` z kontenera `postgres:<ta sama lub nowsza wersja niż serwer>-alpine` do `⟨APP_DIR⟩/backups/grosz-<data>-<etykieta>.sql.gz` i zostawia 30 ostatnich plików. Wołany przed każdym wdrożeniem i raz na dobę (harmonogram w panelu QNAP: Panel sterowania → System → Harmonogram zadań lub crontab).

`pg_dump` musi być w wersji ≥ wersji serwera, inaczej odmówi działania — stąd potrzeba ustalenia wersji PostgreSQL (sekcja 2).

Przywrócenie: zatrzymaj `app`, `gunzip -c <plik> | psql "$DATABASE_URL"` na pustej bazie, uruchom `app`. Przywracanie nadpisuje dane — rób je wyłącznie na prośbę użytkownika i po potwierdzeniu, który plik.

## 7. Praca lokalna

- Baza do developmentu: **PGlite** (bez `DATABASE_URL`), dane w `.data/pglite`. Nie potrzeba Dockera Desktop, którego obrazy zajmowałyby miejsce na C:. Nigdy nie podłączaj lokalnego developmentu do bazy na NAS — testowe dane i eksperymenty z migracjami trafiłyby do prawdziwego budżetu; `seed.ts` odmawia pracy na prawdziwym PostgreSQL bez `ALLOW_SEED=1`.
- `npm run dev` w katalogu głównym uruchamia Vite (5173) i Fastify (3000) z proxy `/api`.
- Testy przeglądarkowe: skill `webapp-testing`. Przeglądarki Playwright zajmują kilkaset MB; na C: jest ok. 340 GB wolnego (2026-10-06), więc domyślna instalacja wystarczy.

## 8. Typowe problemy

- **`docker: command not found` po SSH na QNAP** — Container Station musi być uruchomiony; sprawdź `docker compose version`. Na starszych wersjach binarka leży w katalogu pakietu Container Station.
- **Aplikacja nie łączy się z bazą** — jeśli Postgres jest w kontenerze, `localhost` z wnętrza kontenera `app` to nie NAS. Użyj adresu IP NAS albo wspólnej sieci dockerowej i nazwy kontenera.
- **Daty przesunięte o dzień** — „dziś” zawsze bierz z `today()` z `@grosz/shared/dates` (liczy w `Europe/Warsaw` przez Intl, niezależnie od strefy kontenera, który działa w UTC), a daty płatności trzymaj jako `date`, nie `timestamp`. Winowajcą jest zwykle `new Date().toISOString().slice(0, 10)` — to data w UTC.
- **`git pull` odmawia (`--ff-only`)** — ktoś zmienił pliki bezpośrednio na NAS. Nie nadpisuj na ślepo: pokaż użytkownikowi `git status` z NAS i ustal, co z tym zrobić.
