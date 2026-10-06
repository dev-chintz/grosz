---
name: grosz
description: Zasady projektu „grosz” — osobistej aplikacji budżetowej (wpływy, wydatki cykliczne i jednorazowe, kalendarz płatności) w React + TypeScript, Fastify, Drizzle i PostgreSQL, wdrażanej w Dockerze na NAS QNAP. Używaj ZAWSZE przy każdej pracy w tym repozytorium — nowe ekrany i komponenty, style, kolory, czcionki, formatowanie kwot i dat, logika wydatków cyklicznych i rat, schemat bazy i migracje, docker-compose, wdrożenie lub aktualizacja na NAS — nawet jeśli użytkownik nie wspomina o skillu ani o „zasadach”.
---

# grosz — zasady projektu

Aplikacja do prowadzenia budżetu domowego. Na razie jeden użytkownik, ale model danych od początku jest gotowy na wiele osób (gospodarstwo domowe). Używana głównie na komputerze (desktop-first), interfejs po polsku, waluta PLN.

Mockup, z którego wynika cały wygląd: https://claude.ai/artifact/Ro1Kvgqao6zRbBcuMGq2cz (ekrany: Pulpit, Wydatki cykliczne — edycja, Kalendarz płatności).

## Kiedy co czytać

| Zadanie | Przeczytaj |
|---|---|
| Cokolwiek widocznego: ekran, komponent, CSS, wykres, ikona, tekst w UI | `references/design.md` |
| Docker, compose, NAS, baza na produkcji, migracje, kopie zapasowe, wydanie nowej wersji | `references/deploy-qnap.md` |
| Logika domenowa (cykliczne, raty, salda, terminy) | sekcja „Reguły domeny” poniżej |

Gdy kod w repozytorium jest już sprzeczny z tym skillem, nie zgaduj: zapytaj użytkownika, która wersja obowiązuje, i zaproponuj aktualizację skilla, żeby kolejne sesje nie powtarzały pytania.

## Stos technologiczny

Monorepo na npm workspaces (`npm install` w katalogu głównym):

- **`shared/`** (`@grosz/shared`): logika i typy wspólne dla serwera i przeglądarki — `dates.ts` (daty ISO, polskie święta, dni robocze), `recurrence.ts` (silnik terminów, wersje kwot), `format.ts` (kwoty, daty, odmiana), `labels.ts`, `api.ts` (kształty odpowiedzi API). Import przez `@grosz/shared/<plik>`. Logikę domenową dopisuj tutaj, z testami obok (`*.test.ts`).
- **`server/`**: Node 24 + Fastify + Drizzle ORM. **Bez kroku budowania** — Node 24 uruchamia TypeScript bezpośrednio, więc używaj tylko składni „wymazywalnej” (bez `enum`, `namespace`, parametrów-właściwości w konstruktorach; importy względne z rozszerzeniem `.ts`, typy przez `import type`). `tsconfig.base.json` ma `erasableSyntaxOnly`, które to pilnuje. Trasy w `src/app.ts`, logika w `src/domain/`, schemat w `src/db/schema.ts`.
- **`web/`**: React 19 + Vite + React Router. Style w CSS Modules (`*.module.css`) na tokenach z `web/src/styles/tokens.css` — bez Tailwinda, żeby tokeny z mockupu były jedynym źródłem kolorów. Czcionki z pakietów `@fontsource-variable/*` (działają bez internetu).
- **Baza lokalnie:** bez `DATABASE_URL` serwer używa **PGlite** (Postgres w procesie, dane w `.data/pglite`, poza gitem). Nie potrzeba Dockera, a migracje są te same co na NAS. Reset danych: usuń `.data/` i uruchom `npm run db:migrate && npm run db:seed`.
- **API (Fastify):** dopasowywanie typów (`coerceTypes`) jest wyłączone, bo zamieniało `null` na `0` („bez limitu” zapisywało się jako limit 0). Liczby wysyłaj jako liczby, a pola „brak wartości” jako `null`. Testy API są w `server/src/app.test.ts` (PGlite w pamięci, `app.inject`) — nowa trasa z polem nullable dostaje tam test. Parametry zapytania (`?months=6`) też nie są konwertowane: w schemacie to teksty (`enum: ['3', '6', '12']`), liczbę robi dopiero `Number(...)` w trasie.
- **Eksport danych:** `shared/src/export.ts` (CSV i typ kopii JSON), `server/src/domain/export.ts`, trasy `/api/export/*`, karta „Dane” w Ustawieniach. CSV: średnik, UTF-8 z BOM, CRLF, kwota ze znakiem i przecinkiem; **każdy tekst od użytkownika przechodzi przez `csvText`**, który zabezpiecza komórki zaczynające się od `=`, `+`, `-`, `@` przed wykonaniem w Excelu. Eksport tylko czyta (niczego nie generuje); kopia JSON ma `version`, a wiersze nie zawierają `household_id`. Importu jeszcze nie ma.
- **Polecenia:** `npm run dev` (API :3000 + Vite :5173), `npm test` (Vitest), `npm run typecheck`, `npm run db:generate | db:migrate | db:seed`. Kompilator to TypeScript 7 — w skryptach `tsc` działa, ale przez npx wywołuj `npx --no -- tsc …` (inaczej `-p` zostanie zjedzone przez npx).
- **Testy w przeglądarce:** skill `webapp-testing` (Playwright jeszcze niezainstalowany; miejsca na C: jest dość, więc domyślna instalacja wystarczy).

Na dysku C: jest dużo miejsca (sprawdzone 2026-10-06: ok. 340 GB wolne), więc instalacja paczek i Playwrighta nie wymaga oszczędzania. Gdyby miejsca zaczęło brakować, cache npm można bezpiecznie wyczyścić (`npm cache clean --force`).

## Reguły domeny

Te reguły dotyczą pieniędzy, więc błąd tutaj jest dużo droższy niż brzydki przycisk.

**Kwoty** trzymaj jako liczby całkowite w groszach (`integer`/`bigint` w bazie, `number` całkowity w TS). Nigdy jako `float` — 0,1 + 0,2 ≠ 0,3, a w budżecie każdy grosz musi się zgadzać z wyciągiem. Konwencja w bazie: kwota zawsze dodatnia, kierunek w kolumnie `direction` (`expense` / `income`). Wpisy użytkownika czytaj przez `parsePLN`, wyświetlaj przez `formatPLN` / `splitPLN` z `@grosz/shared/format`.

**Daty płatności** to daty bez godziny (`date` w Postgresie, string `YYYY-MM-DD` w API). Strefa czasowa aplikacji: `Europe/Warsaw`. Dzięki temu płatność „15 października” nie przeskoczy na 14 przez przesunięcie UTC.

**Model wydatków cyklicznych** — trzy poziomy:
1. `recurring_rule` — reguła: nazwa, kategoria, konto, częstotliwość (tydzień / miesiąc / kwartał / rok / co N jednostek), dzień płatności (1–31 lub „ostatni dzień miesiąca”), zasada weekendowa (następny dzień roboczy / poprzedni / bez zmian), data pierwszej płatności, zakończenie (bezterminowo / do daty / po N płatnościach), kwota zmienna (tak/nie), przypomnienie (dni przed), automatyczne księgowanie, status (aktywna / wstrzymana).
2. `rule_amount_version` — kwota z datą „obowiązuje od”. Zmiana raty tworzy nową wersję zamiast nadpisywać starą, żeby historia i przeszłe miesiące się nie zmieniały.
3. `occurrence` — konkretne wystąpienie (termin), generowane z reguły na kilka miesięcy do przodu (`ensureOccurrences` w `server/src/domain/rules.ts`, od `track_from` reguły). Ma własny status (zaplanowane / opłacone / pominięte), może mieć nadpisaną kwotę (np. rzeczywisty rachunek za prąd) i zapamiętuje pierwotną datę, jeśli została przesunięta z weekendu.

Wpływy cykliczne (wypłata) to też reguły, z `direction = income`. Operacje jednorazowe (wydatki i wpływy) są w tabeli `transactions`; terminy cykliczne do niej nie trafiają, więc niczego nie liczymy podwójnie.

Przesunięcie „na dzień roboczy” omija weekendy **i polskie święta** (`isBusinessDay` w `shared/dates.ts`, łącznie z Wigilią od 2025 r.). Subskrypcje pobierane z karty zwykle mają `weekendRule = none`, bo karta obciąża też w weekend.

Edycja reguły domyślnie dotyczy terminów od najbliższego nieopłaconego; opłaconych wystąpień nie przeliczaj.

**Księgowanie automatyczne i przypomnienia.** `autoBook`: przy otwieraniu widoków (`ensureHorizon`, lista reguł) `settleAutoBooked` księguje nieopłacone terminy z datą dzisiejszą lub wcześniejszą, z dniem zapłaty = data terminu i kwotą planowaną; pomija reguły o zmiennej kwocie; każdy termin raz (`occurrences.auto_booked_at`), więc ręcznie cofnięta płatność nie wraca. Dotyczy też wpływów. `remindDaysBefore`: tylko wyróżnienie na Pulpicie (flaga `reminder` przy nadchodzących płatnościach, plakietka „przypomnienie”) — aplikacja nie wysyła powiadomień.

**Dzień płatności 29–31** w krótszym miesiącu przypada na ostatni dzień tego miesiąca. „Ostatni dzień miesiąca” to osobna opcja, nie dzień 31.

**Wielu użytkowników:** każda tabela z danymi budżetu ma `household_id`, a każde zapytanie filtruje po nim — nawet teraz, gdy jest jedno gospodarstwo. Dodanie domowników później nie będzie wtedy wymagało przepisywania zapytań. Domownicy to tabela `users` (na razie bez logowania): operacje jednorazowe i reguły cykliczne mają opcjonalne `user_id` (null = wspólne; usunięcie osoby zostawia je jako wspólne). Każde gospodarstwo ma co najmniej jednego domownika (migracja 0003 dodaje „Ja” istniejącym bazom, seed też), a `categoryId`, `accountId` i `userId` z żądania zawsze sprawdzamy przez `findForeignReferences` (`server/src/domain/household.ts`), żeby nie dało się zapisać odwołania do danych z innego gospodarstwa (klucze obce same tego nie pilnują).

**„Zostaje do wydania”** = wpływy miesiąca − wszystkie zaplanowane i opłacone wydatki miesiąca (stałe i jednorazowe). „Dziennie” = ta kwota / liczba dni do końca miesiąca włącznie z dzisiejszym.

## Język i teksty

UI wyłącznie po polsku, z poprawną odmianą liczebników („1 płatność”, „2 płatności”, „5 płatności”) — użyj `Intl.PluralRules('pl-PL')`, nie dopisuj „(y)”. Kod, nazwy w bazie i commity — po angielsku.
