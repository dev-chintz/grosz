---
name: grosz-screen
description: Checklista dodawania nowego ekranu lub funkcji end-to-end w projekcie grosz — endpoint API, typy w shared, logika w domain, strona React, trasa, pozycja w menu, style z tokenów, testy. Używaj, gdy użytkownik chce dodać ekran (np. Raporty, Ustawienia), nową stronę, nową sekcję albo funkcję, która wymaga zmian i na serwerze, i w interfejsie.
---

# grosz — nowy ekran

Wygląd, tokeny i komponenty opisuje `references/design.md` w skillu `grosz` — przeczytaj go przed pisaniem CSS. Reguły pieniędzy (grosze, `household_id`, `parsePLN`/`formatPLN`) są w sekcji „Reguły domeny” tamże. Poniżej kolejność prac i miejsca w kodzie.

## Kolejność

1. **Dane i logika (jeśli ekran czegoś liczy)**
   - Liczenie wspólne dla serwera i przeglądarki: `shared/src/<temat>.ts` + test obok (`<temat>.test.ts`).
   - Zmiana schematu bazy → najpierw skill `grosz-migration`.
2. **Typy API:** kształty odpowiedzi i żądań w `shared/src/api.ts`. Pola „brak wartości” jako `null`, nie `0`.
3. **Serwer**
   - Logika zapytań w `server/src/domain/<temat>.ts`; **każde zapytanie filtruje po `household_id`**, a każde id z żądania (kategoria, konto, osoba, …) sprawdzaj względem gospodarstwa — dla istniejących pól użyj `findForeignReferences` z `domain/household.ts`, dla nowych dopisz tam sprawdzenie i test z obcym id.
   - Trasy w `server/src/routes/<temat>.ts` (wzór: `routes/categories.ts`): schemat JSON na body/query/params, `additionalProperties: false`, nullable jako `anyOf: [integer, null]`.
   - Zarejestruj w `server/src/app.ts` obok `registerCategoryRoutes`. Własny błąd walidacji dopisz do obsługi błędów w tym samym pliku (jak `CategoryValidationError`), żeby klient dostał 400 z `errors` per pole.
   - Dozwolona tylko składnia „wymazywalna” TS (bez `enum`/`namespace`), importy względne z `.ts`, `import type` dla typów.
4. **Klient API:** dodaj metodę w `web/src/api.ts` (obiekt `api`), nic nie wołaj `fetch` bezpośrednio.
5. **Strona:** `web/src/pages/<Nazwa>.tsx` + `<Nazwa>.module.css` (CSS Modules na zmiennych z `web/src/styles/tokens.css`, żadnych heksów i żadnego Tailwinda).
   - Używaj gotowych: `Segmented`, `Switch`, `Field`, `inputClass` (`components/controls.tsx`), ikon z `Icon.tsx` (nowe ścieżki dopisuj tam), `TransactionDialog`, `usePayment`. Wzór formularza: `pages/recurring/RuleEditor.tsx`.
   - Stany: ładowanie, błąd z `ApiError`, pusta lista — każdy po polsku.
6. **Trasa i menu:** w `web/src/main.tsx` zamień `ComingSoon` na nową stronę (albo dodaj `<Route>`), w `web/src/components/Sidebar.tsx` dopisz/zmień pozycję w `NAV` (ścieżka po polsku, np. `/raporty`).
7. **Testy:** nowa trasa z polem nullable → test w `server/src/app.test.ts` (PGlite, `app.inject`); logika w `shared/` → test jednostkowy.
8. **Weryfikacja:** `npm run typecheck && npm test && npm run build`, potem `npm run dev` (http://localhost:5173) i obejrzenie ekranu — skill `webapp-testing`, jeśli Playwright jest zainstalowany.

## Checklista przed oddaniem

- [ ] Kwoty w groszach end-to-end; wyświetlanie tylko przez `formatPLN`/`splitPLN`, wpis przez `parsePLN`.
- [ ] Daty jako `YYYY-MM-DD`, strefa `Europe/Warsaw`, formaty skrótów z `shared/format.ts`.
- [ ] Liczebniki odmienione przez `Intl.PluralRules('pl-PL')` („1 płatność”, „2 płatności”, „5 płatności”).
- [ ] Wpływ = limonka (`--accent`), wydatek = pomarańcz (`--expense`); limonka/pomarańcz nigdy jako kolor tekstu na jasnym tle.
- [ ] Prawdziwe `<button>`/`<a>`/`<label>`; przyciski z samą ikoną mają `aria-label`; stan nie tylko kolorem.
- [ ] Układ łamie się na wąskim ekranie (`flex-wrap` + `flex-basis`, bez `100vh` na sidebarze); szerokie tabele w `overflow-x: auto`.
- [ ] Brak gradientów, cieni pod kartami i emoji.
- [ ] UI po polsku, kod i commity po angielsku.
- [ ] Jeśli ekran wprowadza nowy wzorzec wizualny — dopisz go do `references/design.md`, żeby następny ekran go użył.
