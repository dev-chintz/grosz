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
GitHub — publiczne repozytorium https://github.com/dev-chintz/grosz
   │  git pull przez https (repo publiczne — bez kluczy i haseł)
   ▼
QNAP „DOMOWY” (w sieci Tailscale: 100.112.158.37), Container Station
   ├─ katalog /share/Container/grosz z kopią repo + .env (poza gitem)
   ├─ docker compose: usługa `migrate` (jednorazowa) → usługa `app` na porcie 8090
   └─ PostgreSQL w osobnym kontenerze anvero-db-db-1, port 5432 wystawiony na NAS; baza `grosz`, użytkownik `grosz`
```

Aplikacja: `http://100.112.158.37:8090` (albo `http://DOMOWY:8090`) — działa w sieci domowej i z każdego urządzenia w tej samej sieci Tailscale.

Dlaczego obraz budujemy na NAS, a nie na PC: QNAP może mieć procesor ARM albo x86, a obraz zbudowany na miejscu zawsze pasuje do jego architektury. Poza tym na dysku C: w PC jest mało miejsca, a Docker Desktop trzyma obrazy właśnie tam.

Kopia robocza projektu zostaje na C: — nie na `H:` (`\\DOMOWY\Kopie`). To udział sieciowy: `node_modules` (dziesiątki tysięcy plików) instaluje się przez SMB bardzo wolno, a podgląd na żywo Vite często nie widzi zmian.

## 2. Do potwierdzenia

Gdy trafisz na wartość ⟨…⟩, zapytaj użytkownika i wpisz odpowiedź tutaj, żeby nie pytać drugi raz.

| Wartość | Ustalenie | Status |
|---|---|---|
| Repozytorium | **publiczne** `https://github.com/dev-chintz/grosz` (bez deploy key; NAS pobiera zwykłym https) | ustalone 2026-10-06 |
| Katalog aplikacji na NAS | `/share/Container/grosz` | ustalone 2026-10-06 |
| Adres NAS | `100.112.158.37` (Tailscale); SSH: `ssh admin@100.112.158.37` | ustalone 2026-10-06 |
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
- `compose.yaml`: usługa `migrate` (profil `tools`, nie startuje przy zwykłym `up`) i `app` na porcie **8090** z healthcheckiem `/api/health`; obie w zewnętrznej sieci `db` = `${PG_NETWORK}` (sieć kontenera Postgresa), `app` dodatkowo w `default` dla portu.
- `.dockerignore`: bez `node_modules`, `.data`, `.git`, `.claude`, testów.
- `.gitattributes`: końce linii LF — skrypty `.sh` z CRLF nie uruchomią się na NAS.

`.env` na NAS (nigdy w gicie; wzór w `.env.example`):
```
DATABASE_URL=postgres://grosz:<hasło>@anvero-db-db-1:5432/grosz
PG_NETWORK=anvero-db_default
PG_IMAGE=postgres:17-alpine
```

**Dlaczego wspólna sieć, a nie port NAS-a** (sprawdzone 2026-10-07 przy pierwszym wdrożeniu): QNAP blokuje kontenerom połączenia do samego NAS-a. `host.docker.internal` (→ 10.0.3.1) i adres w sieci lokalnej `192.168.1.9:5432` dawały timeout, mimo że port 5432 jest wystawiony. Działa dołączenie do sieci Dockera kontenera Postgresa (`anvero-db_default`) i łączenie się po nazwie kontenera — to samo robi `backup.sh` (`docker run --network $PG_NETWORK`). Test połączenia:
```sh
docker run --rm --network anvero-db_default postgres:17-alpine pg_isready -h anvero-db-db-1 -p 5432 -t 5
```
Jeśli stos Anvero zostanie przebudowany pod inną nazwą, sieć może się zmienić — sprawdź `docker inspect anvero-db-db-1 --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}'` i popraw `PG_NETWORK` w `.env`.

Baza i użytkownik dla aplikacji (jednorazowo, hasło wygeneruj losowo i wpisz tylko do `.env` na NAS):
```sh
# administrator w tym kontenerze nie musi nazywać się „postgres” — sprawdź:
docker exec anvero-db-db-1 printenv POSTGRES_USER
docker exec -it anvero-db-db-1 psql -U <POSTGRES_USER> -d postgres -c "CREATE ROLE grosz LOGIN PASSWORD '<hasło>';" -c "CREATE DATABASE grosz OWNER grosz;"
```
Aplikacja łączy się jako `grosz`, nie jako `postgres` — błąd w aplikacji nie może wtedy ruszyć innych baz na tym serwerze.

Aplikacja ma endpoint `GET /api/health`, który sprawdza połączenie z bazą — healthcheck i skrypt wdrożenia na nim polegają.

## 5. Wydanie nowej wersji na NAS

Na QNAP domyślnie nie ma gita, więc używamy go z jednorazowego kontenera `alpine/git` — nic nie instalujemy na samym NAS. Repo jest publiczne, więc NAS pobiera je zwykłym https, bez kluczy i haseł.

**Pierwsze wdrożenie (jednorazowo, po SSH na NAS):**
1. Baza i rola `grosz` w kontenerze Postgresa (sekcja 4); hasło trafia tylko do `.env`.
2. Klon do **pustego** katalogu (git odmawia klonowania do niepustego, więc `.env` tworzysz dopiero po klonie):
```sh
mkdir -p /share/Container/grosz && cd /share/Container/grosz
docker run --rm -v "$PWD":/git -w /git alpine/git clone https://github.com/dev-chintz/grosz.git .
cp .env.example .env     # uzupełnij hasło do bazy; plik nie trafia do gita
```
3. `sh deploy/deploy.sh` — przy pierwszym uruchomieniu zakłada też pusty budżet (gospodarstwo, osoba „Ja”, konto „Konto główne” z saldem 0 i domyślne kategorie). Na pustej bazie bez tego kroku każdy ekran zwraca 409.

Kolejne wydania: `ssh admin@100.112.158.37 'sh /share/Container/grosz/deploy/deploy.sh'`.

Skrypt `deploy/deploy.sh` robi kolejno: `git pull --ff-only` (https) → `docker compose build` → `deploy/backup.sh pre-deploy` → `docker compose run --rm migrate` → `docker compose run --rm migrate node server/src/bootstrap.ts` (pusty budżet, tylko gdy nie ma jeszcze gospodarstwa; idempotentne) → `docker compose up -d app` → do 30 s sprawdzania `/api/health`.

Kolejność ma znaczenie: kopia → migracja → nowa aplikacja. Jeśli migracja się nie uda, skrypt zatrzymuje się (`set -e`) przed podmianą aplikacji, a kopia pozwala wrócić do stanu sprzed wydania.

Przed wdrożeniem upewnij się, że zmiany są wypchnięte (`git status`, `git push`), i powiedz użytkownikowi, co wchodzi w wydanie (lista commitów od ostatniego wdrożenia). Wdrożenie dotyka danych finansowych — uruchamiaj je tylko na wyraźną prośbę.

## 6. Kopie zapasowe i przywracanie

`deploy/backup.sh` robi `pg_dump` z kontenera `postgres:<ta sama lub nowsza wersja niż serwer>-alpine` do `/share/Container/grosz/backups/grosz-<data>-<etykieta>.sql.gz` i zostawia 30 ostatnich plików. Wołany przed każdym wdrożeniem i raz na dobę (harmonogram w panelu QNAP: Panel sterowania → System → Harmonogram zadań lub crontab).

`pg_dump` musi być w wersji ≥ wersji serwera, inaczej odmówi działania — stąd potrzeba ustalenia wersji PostgreSQL (sekcja 2).

Przywrócenie: zatrzymaj `app`, `gunzip -c <plik> | psql "$DATABASE_URL"` na pustej bazie, uruchom `app`. Przywracanie nadpisuje dane — rób je wyłącznie na prośbę użytkownika i po potwierdzeniu, który plik.

## 7. Praca lokalna

- Baza do developmentu: **PGlite** (bez `DATABASE_URL`), dane w `.data/pglite`. Nie potrzeba Dockera Desktop, którego obrazy zajmowałyby miejsce na C:. Nigdy nie podłączaj lokalnego developmentu do bazy na NAS — testowe dane i eksperymenty z migracjami trafiłyby do prawdziwego budżetu; `seed.ts` odmawia pracy na prawdziwym PostgreSQL bez `ALLOW_SEED=1`.
- `npm run dev` w katalogu głównym uruchamia Vite (5173) i Fastify (3000) z proxy `/api`.
- Testy przeglądarkowe: skill `webapp-testing`. Przeglądarki Playwright zajmują kilkaset MB; na C: jest ok. 340 GB wolnego (2026-10-06), więc domyślna instalacja wystarczy.

## 8. Typowe problemy

- **`docker: command not found` po SSH na QNAP** — Container Station musi być uruchomiony; sprawdź `docker compose version`. Na starszych wersjach binarka leży w katalogu pakietu Container Station.
- **Aplikacja albo kopia nie łączy się z bazą (timeout)** — sprawdź, czy `PG_NETWORK` w `.env` to nadal sieć kontenera Postgresa (sekcja 4). Na tym QNAP-ie nie działają ani `host.docker.internal`, ani adres NAS-a — firewall blokuje kontenerom połączenia do hosta.
- **`Could not resolve host: github.com` przy pobieraniu kodu** — chwilowy problem DNS-u Container Station; `deploy.sh` pobiera kod przez sieć NAS-a (`--network host`) i ponawia 3 razy. Jeśli dalej nie działa, sprawdź `ping github.com` na samym NAS-ie.
- **Daty przesunięte o dzień** — „dziś” zawsze bierz z `today()` z `@grosz/shared/dates` (liczy w `Europe/Warsaw` przez Intl, niezależnie od strefy kontenera, który działa w UTC), a daty płatności trzymaj jako `date`, nie `timestamp`. Winowajcą jest zwykle `new Date().toISOString().slice(0, 10)` — to data w UTC.
- **`git pull` odmawia (`--ff-only`)** — ktoś zmienił pliki bezpośrednio na NAS. Nie nadpisuj na ślepo: pokaż użytkownikowi `git status` z NAS i ustal, co z tym zrobić.
