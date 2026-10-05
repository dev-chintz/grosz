# grosz — system wizualny

Źródło prawdy: mockup https://claude.ai/artifact/Ro1Kvgqao6zRbBcuMGq2cz. Ten plik spisuje jego reguły, żeby każdy nowy ekran wyglądał jak część tej samej aplikacji.

Charakter: ciepła, papierowa szarość jako tło, prawie czarny „atrament” na elementy najważniejsze, jeden mocny limonkowy akcent. Spokojnie i gęsto informacyjnie, bez ozdobników. Liczby są bohaterem — duże, wyraźne, krojem display.

## Spis treści
1. Tokeny kolorów
2. Typografia
3. Kształt, odstępy, układ
4. Kwoty i daty
5. Komponenty
6. Wykresy
7. Dostępność
8. Czego nie robić

## 1. Tokeny kolorów

Trzymaj je w `web/src/styles/tokens.css` jako zmienne CSS i używaj wyłącznie przez zmienne — żadnych heksów w komponentach.

```css
:root {
  /* tła */
  --ground: #EFECE6;        /* tło aplikacji */
  --surface: #FFFFFF;       /* karty */
  --surface-2: #F6F4EF;     /* panele wewnątrz kart, hover wierszy, podsumowania */
  --track: #F1EEE8;         /* tło przełączników segmentowych i pasków postępu */
  --track-strong: #E4E0D8;  /* zakładki/filtry na tle --ground */

  /* atrament (ciemne elementy) */
  --ink: #16181B;           /* tekst główny, sidebar, karta główna, aktywny segment */
  --ink-2: #212429;         /* karty w sidebarze */
  --ink-3: #2A2D32;         /* aktywna pozycja menu, pigułki na ciemnym */

  /* tekst */
  --text: #16181B;
  --text-2: #5B5F66;        /* opisy, metadane — min. kontrast OK na białym i --ground */
  --text-3: #6F737A;        /* TYLKO tekst ≥ 24 px (np. rok przy nazwie miesiąca) */
  --on-ink: #F3F1EC;        /* tekst na --ink */
  --on-ink-2: #A3A7AE;      /* drugorzędny tekst na --ink */
  --on-ink-nav: #C9CCD1;    /* nieaktywne pozycje menu */

  /* linie */
  --divider: #EFECE6;       /* separatory wierszy w kartach */
  --border: #E2DED6;        /* obrys pól wyszukiwania, kart na tle */
  --border-input: #D6D1C7;  /* obrys inputów i przycisków „ghost” */

  /* akcent i semantyka */
  --accent: #C8F04A;        /* limonka: wpływy, główna akcja, „wolne środki”, zaznaczenie */
  --expense: #E8622C;       /* wydatki stałe: kropki, paski, segmenty */
  --expense-soft: #F2A57E;  /* wydatki jednorazowe w paskach podziału */
  --expense-tint: #FBE3D6;  /* tło ikon/odznak związanych z wydatkami */
  --expense-text: #9A3A12;  /* gdy pomarańczowy musi być tekstem (np. „Usuń”, nota o przesunięciu) */
  --oneoff: #8E939B;        /* kropka wydatku jednorazowego w kalendarzu */
}
```

Zasady użycia:
- **Limonka i pomarańcz to wypełnienia, nie kolory tekstu na jasnym tle** — oba mają za mały kontrast. Na limonce zawsze tekst `--ink`. Limonka jako tekst tylko na `--ink` (np. „175 zł dziennie” w karcie głównej).
- **Wpływ = limonka, wydatek = pomarańcz.** Nie używaj czerwony/zielony — część osób ich nie rozróżnia, a limonka i pomarańcz różnią się też jasnością.
- Akcent jest wymienny (w mockupie warianty: `#7DE2D1`, `#FFB86B`, `#BBA8FF`) — dlatego zawsze przez `--accent`, nigdy wpisany na sztywno.

## 2. Typografia

Trzy kroje z Google Fonts (lub self-hosted w `web/public/fonts` — na NAS lepiej self-hosted, aplikacja ma działać też bez internetu):

| Krój | Do czego | Typowe ustawienia |
|---|---|---|
| **Bricolage Grotesque** | nagłówki, duże kwoty, liczby w kafelkach, numery dni | 700, `letter-spacing` od −0.02em (20 px) do −0.045em (80 px) |
| **Geist** | cały tekst interfejsu | 400/500/600, 13–15 px |
| **Geist Mono** | kwoty w listach i tabelach, daty skrócone, liczniki | 400–600, 11–15 px |

Skala:
- kwota główna (karta „Zostaje do wydania”): 80 px / line-height 0.95; grosze w kolorze `#8E939B` na ciemnym, „zł” 34 px
- h1 strony (np. „Październik 2026”): 36 px
- kwota w kafelku statystyki: 26 px
- nagłówek karty (h2): 20–22 px
- tekst: 15 px (ważny), 14 px (wiersze list), 13 px (metadane), 12 px (etykiety drobne, nagłówki dni tygodnia — wersaliki z `letter-spacing: 0.06–0.08em`)

Nie używaj Inter, Roboto ani Arial.

## 3. Kształt, odstępy, układ

- Promienie: karta duża 24 px · kafelek 20 px · kafelek ikony 13–14 px · input/przycisk 12 px · drobne przyciski i komórki 10 px · pigułki 999 px.
- Wysokość kontrolek: 44 px (cel kliknięcia). Mniejsze tylko w gęstych siatkach (dni miesiąca: 40 px).
- Odstępy: między kartami 20 px, między sekcjami strony 24 px, padding karty 24–28 px, wnętrze sekcji formularza 14 px.
- Bez cieni na kartach — karty odcinają się kolorem od `--ground`. Zaznaczenie = obwódka `inset 0 0 0 2px var(--ink)`.
- **Układ strony:** ciemny sidebar 232 px + treść z `max-width` 1200–1320 px. Wiersz flex z `flex-wrap: wrap`; sidebar `flex: 1 1 232px`, treść `flex: 999 1 560px; min-width: 0`. Na wąskim ekranie sidebar spada nad treść, a pozycje menu układają się w kilka kolumn — bez `position: sticky` i bez `100vh` na sidebarze.
- Karty w rzędzie: flex z `flex-wrap` i `flex-basis` (np. 1.6 1 520px + 1 1 360px), nie sztywny grid — tak rzędy same się łamią na mniejszych ekranach.
- Szerokie tabele i wykresy osi miesiąca w kontenerze `overflow-x: auto` z `min-width` treści.

## 4. Kwoty i daty

Jedna funkcja formatująca w `shared/` — nie formatuj kwot ręcznie w komponentach.

```ts
const pln = new Intl.NumberFormat('pl-PL', {
  style: 'currency', currency: 'PLN', useGrouping: 'always',
});
// grosze → "1 234,56 zł"; minus zamieniony na typograficzny "−" (U+2212)
export const formatPLN = (grosze: number, opts?: { sign?: boolean }) => {
  const s = pln.format(Math.abs(grosze) / 100);
  if (grosze < 0) return '−' + s;
  return opts?.sign && grosze > 0 ? '+' + s : s;
};
```

Dlaczego tak: domyślne `pl-PL` nie grupuje liczb czterocyfrowych („1234,56 zł”), a `useGrouping: 'always'` daje „1 234,56 zł” jak w mockupie. Separator tysięcy to twarda spacja, więc kwota nie złamie się na końcu linii.

- Kwoty w listach: Geist Mono, 600, wyrównane do prawej, `white-space: nowrap`.
- Znak: wydatki w historii `−640,00 zł`, wpływy `+8 450,00 zł`; w listach płatności do zapłaty bez znaku.
- Kwota zmienna (prognoza): prefiks `~` (np. `~180,00 zł`) plus odznaka „kwota zmienna”.
- Daty: krótko `15 paź`, z dniem tygodnia `cz, 15 paź 2026`, długo `15 października` + nazwa dnia w linii nad. Skróty miesięcy: sty lut mar kwi maj cze lip sie wrz paź lis gru; dni: pn wt śr cz pt sb nd. Tydzień zaczyna się w poniedziałek.
- Liczby względne: „za 5 dni”, „dziś”, „jutro”.

## 5. Komponenty

Każdy komponent poniżej istnieje w mockupie — sprawdź tam wygląd, zanim zbudujesz własny wariant.

- **Sidebar:** tło `--ink`, logo (kafelek 34 px w `--accent` + słowo „grosz” Bricolage 26 px), menu: Pulpit, Transakcje, Cykliczne (z licznikiem), Kalendarz, Kategorie, Raporty, Ustawienia. Aktywna pozycja: tło `--ink-3`, biały tekst, kropka `--accent` po prawej. Na dole karta gospodarstwa (`--ink-2`) z linkiem „Zaproś domownika”.
- **Nagłówek strony:** strzałki poprzedni/następny miesiąc (44 px, obrys `--border-input`), h1 z miesiącem, po prawej wyszukiwarka i przycisk główny „Dodaj” (`--accent`, ikona +).
- **Karta główna (hero):** tło `--ink`, „Zostaje do wydania…”, kwota 80 px, zdanie z kwotą dzienną, pasek podziału wpływów (stałe `--expense` / jednorazowe `--expense-soft` / wolne `--accent`, odstęp 3 px między segmentami) z legendą.
- **Kafelek statystyki:** biały, ikona w kafelku 44 px (tło zależne od znaczenia), etykieta + metadane, kwota po prawej.
- **Wiersz płatności:** data w kolumnie (dzień Bricolage 24 px + skrót miesiąca), nazwa + metadane („rata 43 z 360 · za 10 dni”), kwota mono, przycisk „Opłać” (obrys) → po kliknięciu „Opłacone” z ikoną ✓ na `--accent`, nazwa przekreślona.
- **Przełącznik segmentowy:** kontener `--track`, padding 4 px, promień 14; aktywny segment `--ink` + biały tekst. Na tle `--ground` kontener `--track-strong`, aktywny biały. Rola `radiogroup`/`radio` lub `tablist`/`tab`.
- **Switch:** 46×28, tor `--ink` (włączony) / `--border-input` (wyłączony), gałka biała 22 px. `role="switch"` + `aria-checked`.
- **Wybór dnia płatności:** siatka 8 × 4 (1–31 + „ost.”), komórka 40 px, zaznaczona `--accent` z obwódką `--ink`; nad siatką podpowiedź (np. „w krótszych miesiącach: ostatni dzień”).
- **Podgląd terminów:** lista 5 najbliższych dat na `--surface-2`, numer raty mono, przy przesunięciu z weekendu nota w `--expense-text` („przesunięte z niedzieli, 15 lis”). Liczony na żywo tym samym kodem z `shared/`, którego używa serwer.
- **Wiersz listy cyklicznych:** kafelek z inicjałem (zaznaczony: `--ink` z literą w `--accent`), nazwa + odznaki (kwota zmienna / kończy się / wstrzymane), „kategoria · częstotliwość”, pasek rat (`--ink` na `--track`) z „42 / 360 opłacone”, po prawej kwota i najbliższy termin. Wstrzymane: `opacity: .6`.
- **Komórka kalendarza:** min. 132 px wysokości, numer dnia (dziś: pigułka `--ink` z białym), saldo dnia mono w rogu, do 3 chipów (wpływ: tło `--accent`; wydatek: `--surface-2` + kropka; opłacone: przekreślone, `--text-3`), na dole pasek „obciążenia dnia” w `--expense`. Weekendy tło `#FBFAF7`, nagłówki sb/nd w `--expense-text`.

Ikony: liniowe SVG 18–20 px, `stroke-width` 1.8–2, `stroke="currentColor"`, zaokrąglone końce (np. lucide). Bez emoji.

## 6. Wykresy

- **Oś miesiąca:** 31 słupków salda prognozowanego. Za nami `--ink`, przyszłość `#D9D4CA`, dni z wpływem `--accent`. Pod słupkiem kropki: pomarańczowa (płatność), limonkowa (wpływ); numer dnia mono 11 px, dziś w pigułce `--ink`. Kliknięcie dnia pokazuje panel: data, saldo na koniec dnia, chipy operacji.
- **Kategorie:** poziome paski 8 px w `--expense` na `--track`, długość względem największej kategorii, obok kwota i procent.
- Biblioteka do wykresów tylko gdy prosty HTML/CSS nie wystarczy. Kolory zawsze z tokenów.

## 7. Dostępność

- Prawdziwe `<button>`, `<a href>`, `<label>` + `<input>`; nigdy `onClick` na `div`.
- Przyciski z samą ikoną mają `aria-label` („Poprzedni miesiąc”, „Usuń”).
- Kontrast tekstu min. 4.5:1 (3:1 dla ≥ 24 px) — stąd `--text-2` zamiast jaśniejszych szarości.
- Stan nie może być przekazywany samym kolorem: opłacone = przekreślenie + ✓, zaznaczony dzień = obwódka + `aria-pressed`.

## 8. Czego nie robić

- Gradienty, poświaty, glassmorphism, karty z kolorowym lewym paskiem, emoji — to wygląda jak szablon, a celem jest wygląd nieszablonowy.
- Nowe kolory „na chwilę” — jeśli coś potrzebuje nowego znaczenia, dodaj token i opisz go tutaj.
- Cienie pod kartami i obramowania kart — karty odróżnia kolor tła.
- Limonka lub pomarańcz jako kolor tekstu na jasnym tle.
