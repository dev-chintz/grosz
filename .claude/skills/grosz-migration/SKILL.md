---
name: grosz-migration
description: Procedura zmiany schematu bazy w projekcie grosz (Drizzle + PostgreSQL/PGlite) — dodanie lub zmiana tabeli albo kolumny, generowanie i przegląd migracji SQL, test na PGlite, commit. Używaj za każdym razem, gdy edytujesz `server/src/db/schema.ts`, dodajesz plik w `server/drizzle/` albo użytkownik mówi o nowej kolumnie, tabeli, indeksie lub „zmianie w bazie” — nawet jeśli nie pada słowo „migracja”.
---

# grosz — zmiana schematu bazy

Ogólne zasady (dlaczego bez `push`, bez edycji starych migracji, zmiany niszczące w dwóch wydaniach) są w skillu `grosz`, plik `references/deploy-qnap.md`, sekcja 3. Tu jest sama procedura krok po kroku.

## Procedura

1. **Zmień `server/src/db/schema.ts`.** Pilnuj konwencji:
   - kwoty `integer` w groszach (`bigint` dla sum), nigdy `float`/`numeric`;
   - daty płatności `date` (string `YYYY-MM-DD`);
   - nowa tabela z danymi budżetu ma `household_id` (FK) i indeks na nim;
   - kolumna „brak wartości” = `NULL` (np. `monthly_limit`), nie `0`.
2. **Wygeneruj migrację** z czytelną nazwą po angielsku, w stylu `0001_category_monthly_limit`:
   ```bash
   npm run db:generate -- --name <krotki_opis>
   ```
   Bez `--name` drizzle nada losową nazwę (`majestic_loners`) — wtedy zmień nazwę pliku `.sql` i pole `tag` w `server/drizzle/meta/_journal.json`.
3. **Przeczytaj wygenerowany plik `.sql`** (to obowiązkowy krok, nie formalność):
   - `DROP COLUMN` / `DROP TABLE` — czy na pewno zamierzone? Przy zmianie nazwy kolumny drizzle-kit generuje `DROP` + `ADD`, czyli **kasuje dane**. Zamień na `ALTER TABLE … RENAME COLUMN` ręcznie, **zanim** migracja trafi do gita.
   - Nowa kolumna `NOT NULL` w tabeli z danymi wymaga `DEFAULT` albo kroku uzupełniającego, inaczej migracja wywali się na NAS (tam dane już są, w świeżym PGlite nie).
   - Jeśli widzisz `DROP`, powiedz o tym użytkownikowi, zanim pójdziesz dalej.
4. **Zastosuj lokalnie i sprawdź na danych:**
   ```bash
   npm run db:migrate
   ```
   Jeśli lokalna baza jest w złym stanie: usuń `.data/` i `npm run db:migrate && npm run db:seed`.
5. **Zaktualizuj kod korzystający ze zmiany:** `shared/src/api.ts` (kształty odpowiedzi), `server/src/domain/*`, trasy, front. Pole nullable → test w `server/src/app.test.ts` (PGlite w pamięci stosuje wszystkie migracje, więc test sprawdza je przy okazji).
6. **Zweryfikuj:** `npm run typecheck && npm test`.
7. **Commit** migracja + `meta/*_snapshot.json` + `_journal.json` + kod w jednym commicie (po angielsku).

## Czego nie robić

- `drizzle-kit push` — omija pliki migracji, baza na NAS przestaje odpowiadać historii w repo.
- Edytować migrację, która już była wdrożona na NAS — Drizzle jej nie uruchomi ponownie. Poprawkę zrób nową migracją.
- Usuwać kolumny w tym samym wydaniu, w którym przestaje się ich używać (cofnięcie o wersję zostawiłoby starą aplikację bez kolumny).
- Dotykać bazy Anvero w kontenerze `anvero-db-db-1` — grosz ma własną bazę i użytkownika.

## Wdrożenie

Migracje uruchamia osobny krok `migrate` (profil `tools` w `compose.yaml`) przed startem `app`. Przed wydaniem z migracją niszczącą zrób kopię (`deploy/backup.sh`) — szczegóły w `references/deploy-qnap.md`.
