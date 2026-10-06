# grosz — kontynuacja pracy na innym komputerze

Stan z 2026-10-06. Historia czatu i lokalna pamięć Claude'a **nie przenoszą się** między komputerami — wszystko, co potrzebne, jest w repo: ten plik, `README.md` i skille w `.claude/skills/` (skill `grosz` ładuje się sam przy pracy w tym repo).

## Co jest gotowe

- Siedem ekranów: Pulpit, Transakcje, Cykliczne, Kalendarz, Kategorie, Raporty, Ustawienia.
- Domownicy (pole „Kto” w operacjach i płatnościach, filtr w Transakcjach), konta z archiwizacją, eksport danych (kopia JSON i CSV do Excela).
- Księgowanie automatyczne płatności cyklicznych i przypomnienia (wyróżnienie na Pulpicie, bez powiadomień push). Migracje: 0000–0004.
- 85 testów, `npm run typecheck` i `npm run build` przechodzą.
- Przygotowane wdrożenie na NAS: `deploy/deploy.sh`, `compose.yaml`, `Dockerfile`, bootstrap pustego budżetu (`npm run db:bootstrap`).

**Nie jest zrobione:** samo wdrożenie na NAS (poniżej), import z kopii, logowanie. Obrazu Dockera nie testowano na żadnym komputerze — pierwszy build na NAS to pierwszy prawdziwy test.

## 1. Uruchomienie lokalne (PowerShell, Node 24+)

Najpierw wejdź do folderu projektu (podaj swoją ścieżkę):

```powershell
cd C:\Users\<ty>\Documents\projekt\grosz
```

```powershell
git pull
```

```powershell
npm.cmd install
```

```powershell
npm.cmd run db:migrate
```

```powershell
npm.cmd run db:seed
```

```powershell
npm.cmd run dev
```

Potem `http://localhost:5173`. Lokalnie baza to PGlite w `.data/` (poza gitem), więc nie trzeba Dockera ani Postgresa. W PowerShellu używaj `npm.cmd`, bo `npm` bywa blokowany przez politykę wykonywania skryptów.

## 2. Wdrożenie na NAS (do zrobienia)

Dane: repo publiczne `https://github.com/dev-chintz/grosz`, NAS `100.112.158.37` (Tailscale, komputer musi być w tej samej sieci Tailscale), katalog `/share/Container/grosz`, aplikacja na porcie **8090**. Pełny opis: `.claude/skills/grosz/references/deploy-qnap.md`.

Zasady: wykonuj kroki po kolei i sprawdzaj wynik każdego. Baza `anvero-db-db-1` należy też do projektu Anvero — **dotykamy tylko roli i bazy `grosz`**. Hasło wpisujesz tylko do `.env` na NAS, nigdy do czatu ani do gita.

**Krok 1. SSH na NAS**

```powershell
ssh admin@100.112.158.37
```

**Krok 2. Użytkownik administracyjny Postgresa** (może nie nazywać się `postgres`)

```sh
docker exec anvero-db-db-1 printenv POSTGRES_USER
```

**Krok 3. Rola i baza `grosz`.** Wymyśl hasło z samych liter i cyfr (np. wynik `openssl rand -hex 16`, jeśli jest na NAS) — znaki specjalne trzeba by kodować w adresie bazy. Podstaw je w miejsce `HASLO`, a wynik kroku 2 w miejsce `ADMIN`:

```sh
docker exec -it anvero-db-db-1 psql -U ADMIN -d postgres -c "CREATE ROLE grosz LOGIN PASSWORD 'HASLO';" -c "CREATE DATABASE grosz OWNER grosz;"
```

**Krok 4. Klon repo do pustego katalogu** (git odmawia klonowania do niepustego, więc `.env` tworzysz dopiero po klonie)

```sh
mkdir -p /share/Container/grosz && cd /share/Container/grosz
```

```sh
docker run --rm -v "$PWD":/git -w /git alpine/git clone https://github.com/dev-chintz/grosz.git .
```

**Krok 5. Plik `.env`** — skopiuj wzór i wpisz hasło z kroku 3 w miejsce `ZMIEN_HASLO` (np. `vi .env`):

```sh
cp .env.example .env
```

**Krok 6. Pierwsze wdrożenie.** Zbuduje obraz (kilka minut, NAS potrzebuje internetu), zrobi kopię bazy, zastosuje migracje, założy pusty budżet i uruchomi aplikację:

```sh
sh deploy/deploy.sh
```

**Krok 7. Sprawdzenie.** Odpowiedź powinna zawierać `"db":"postgres"`; potem otwórz `http://100.112.158.37:8090`:

```sh
wget -qO- http://localhost:8090/api/health
```

W aplikacji będzie pusty budżet: konto „Konto główne” z saldem 0, osoba „Ja” i domyślne kategorie. Saldo początkowe ustaw w Ustawieniach, potem dodawaj płatności cykliczne.

**Kolejne wydania:** wypchnij zmiany na GitHub, potem `ssh admin@100.112.158.37 'sh /share/Container/grosz/deploy/deploy.sh'`. Skrypt sam robi kopię bazy przed migracją.

**Po wdrożeniu:** ustaw dobowy backup (`sh /share/Container/grosz/deploy/backup.sh daily`) w harmonogramie QNAP (Panel sterowania → System → Harmonogram zadań).

### Gdyby coś nie działało

- **Aplikacja nie łączy się z bazą:** `host.docker.internal` może nie działać na Twojej wersji Container Station. Obejście (adres IP NAS albo wspólna sieć dockerowa z kontenerem Postgresa) jest w `deploy-qnap.md`, sekcja 8.
- **Każdy ekran pokazuje 409:** baza jest pusta i nie uruchomił się bootstrap — `cd /share/Container/grosz && docker compose run --rm migrate node server/src/bootstrap.ts`.
- **Błąd w trakcie `deploy.sh`:** skrypt staje (`set -e`), a dotychczasowa wersja działa dalej. Logi: `docker compose logs app`. Wklej wynik w nowej rozmowie z Claude'em.

## 3. Jak zacząć rozmowę z Claude'em w domu

Otwórz folder projektu w Claude Code i napisz np.:

> Przeczytaj docs/HANDOFF.md i poprowadź mnie przez wdrożenie na NAS krok po kroku. Nie wykonuj niczego na NAS bez mojego wyraźnego „tak”.

Claude nie ma kluczy SSH do NAS ani Dockera na komputerze z projektem, więc komendy z kroków 1–7 uruchamiasz sam, a wyniki wklejasz do rozmowy.

## 4. Zasady pracy ustalone w tym projekcie

- **Plan przed budową:** przy nowej funkcji, nowym ekranie lub zmianie schematu bazy najpierw krótki plan (kroki, miejsca nieodwracalne, „co psuje się pierwsze”) i akceptacja, dopiero potem kod. Przy zmianach wizualnych bez ścisłej specyfikacji — 2–4 makiety do wyboru.
- **Skille projektu:** `grosz` (zasady, domena, wygląd, wdrożenie), `grosz-screen` (nowy ekran end-to-end), `grosz-migration` (zmiana schematu).
- **Nie edytuj migracji, która poszła na NAS** — popraw błąd nową migracją. Nie używaj `drizzle-kit push` na bazie z NAS.
- **Pułapki narzędzi na Windows:** skrypty Pythona zapisują końce linii CRLF, jeśli nie podać `newline=''` (repo wymusza LF — git ostrzega); `npm run typecheck` nie wyłapie nieużytego komponentu, więc po dodaniu karty sprawdź w przeglądarce, że się renderuje.

## 5. Pomysły na później

- **Import z kopii JSON** — odwrotność eksportu. Nadpisuje dane, więc zaczynaj od planu z bramkami i kopii bazy przed importem.
- **Logowanie i prawdziwe konta domowników** — osobny projekt z bezpieczeństwem (hasła, sesje, zaproszenia). Dziś aplikacja nie ma logowania: każdy w sieci domowej lub w Tailscale ma dostęp.

## 6. Pamięć Claude'a (pliki memory)

Claude Code zapisuje notatki o projekcie w plikach memory. Są **lokalne dla komputera i folderu projektu** i **nie trafiają do gita**, więc w domu Claude ich nie zobaczy, dopóki ich nie przeniesiesz. Nic ważnego nie przepadnie: wszystko, co dotyczy `grosz`, jest w repo (ten plik, `README.md`, skille w `.claude/skills/`). Memory to tylko wygoda.

**Gdzie leżą na komputerze w pracy:** `~/.claude/projects/C--Users-fmic--Documents-projekt-grosz/memory/`. Nazwa folderu to ścieżka projektu, w której każdy znak inny niż litera lub cyfra zamieniono na `-`. W domu ścieżka będzie inna, więc folder będzie się nazywał inaczej; Claude Code utworzy go sam przy pierwszym otwarciu projektu. Sprawdzisz go poleceniem:

```powershell
dir $HOME/.claude/projects
```

**Co zawierają pliki (stan z 2026-10-06):**

| Plik | O czym jest |
|---|---|
| `MEMORY.md` | Indeks: po jednej linii na każdy plik. Wczytuje się na początku każdej sesji. |
| `user-profile.md` | Piszesz po polsku (krótko, potocznie), kod i commity po angielsku; Windows 11; NAS QNAP przez Tailscale; lubisz, gdy Claude proponuje skille. |
| `grosz-project.md` | Co jest gotowe i co zostaje (wdrożenie na NAS, import, logowanie), dane wdrożenia i pułapki narzędzi na Windows (patrz niżej). |
| `plan-before-building.md` | Zasada: przy nowej funkcji najpierw krótki plan i akceptacja, przy zmianach wizualnych makiety do wyboru (opis też w sekcji 4 tego pliku). |
| `ai-patterns-repo.md` | Wskaźnik na repo ze wzorcami agentów (Agent Graph, Jev-Powered App). Dotyczy projektów z agentami AI, nie `grosz`. |

**Pułapki narzędzi Claude'a, które są tylko w memory** (warto je znać):
- Narzędzie Bash może zjadać jeden z podwójnych ukośników w heredocu, więc wzorce regex w kodzie TypeScript lądują z jednym ukośnikiem. Składaj je z `chr(92)` w Pythonie albo edytuj plik narzędziem Edit.
- Narzędzia Write i Edit zamieniają zapis ukośnik-u-FEFF na prawdziwy znak BOM w kodzie. Po zapisie sprawdź: `grep -rlP '\xEF\xBB\xBF' shared/src server/src web/src`.
- Podgląd przeglądarki w aplikacji Claude szuka `.claude/launch.json` w folderze, w którym sesja się zaczęła. Serwer dev uruchamiaj komendą `npm run dev` i otwieraj `http://localhost:5173`. Po restarcie serwera użyj świeżej karty przeglądarki, bo stara trzyma stare moduły.

**Jak przenieść memory do domu (opcjonalnie):**
1. Nic nie rób. Claude w domu przeczyta ten plik i skille, a zasady pracy są w sekcji 4. To wystarczy.
2. Skopiuj pięć plików z folderu z pracy do odpowiedniego folderu `memory/` w domu (po pierwszym otwarciu projektu w domu, gdy folder już istnieje). Pliki nie zawierają haseł, ale zawierają Twoje preferencje, nazwę konta GitHub i adres NAS, więc **nie wkładaj ich do publicznego repo** (to repo jest publiczne).
3. Sklonuj repo ze wzorcami agentów obok projektu: `git clone https://github.com/dev-chintz/ai-patterns.git`.

**Pamięć w chmurze konta (claude.ai)** z plikami `/areas/agent-architecture.md` i `/areas/jev-powered-app.md` jest przypisana do konta, a nie do komputera. Te same pliki są w repo `ai-patterns`.

**Memory innych projektów** (Anvero, micro) leży w osobnych folderach i nie dotyczy `grosz`.
