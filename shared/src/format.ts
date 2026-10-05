// Formatowanie dla UI. Kwoty zawsze w groszach (liczby całkowite).

import { parseIso, weekday, type IsoDate } from './dates.ts';

const pln = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  // Domyślne pl-PL nie grupuje liczb 4-cyfrowych („1234,56 zł”); chcemy „1 234,56 zł”.
  useGrouping: 'always',
});

const MINUS = '−';

/** 123456 → "1 234,56 zł"; ujemne z typograficznym minusem; sign: true dodaje „+” przed dodatnimi. */
export function formatPLN(grosze: number, options: { sign?: boolean } = {}): string {
  const text = pln.format(Math.abs(grosze) / 100);
  if (grosze < 0) return MINUS + text;
  return options.sign && grosze > 0 ? '+' + text : text;
}

const plnWhole = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0, useGrouping: 'always' });

/** Części kwoty do dużego wyświetlania: 455161 → { sign: '', whole: '4 551', fraction: ',61' }. */
export function splitPLN(grosze: number): { sign: string; whole: string; fraction: string } {
  const abs = Math.abs(grosze);
  return {
    sign: grosze < 0 ? MINUS : '',
    whole: plnWhole.format(Math.floor(abs / 100)),
    fraction: ',' + String(abs % 100).padStart(2, '0'),
  };
}

/** "2 340,00", "2340", "-12,5 zł" → grosze; null, gdy nie da się odczytać. */
export function parsePLN(input: string): number | null {
  const cleaned = input
    .replace(/zł/gi, '')
    .replace(/[\s  ]/g, '')
    .replace(MINUS, '-')
    .replace(',', '.');
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole = '0', fraction = ''] = cleaned.replace('-', '').split('.');
  const grosze = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return cleaned.startsWith('-') ? -grosze : grosze;
}

const pluralRules = new Intl.PluralRules('pl-PL');

/** plural(5, ['płatność', 'płatności', 'płatności']) → "płatności" (forma: 1 / 2–4 / 5+). */
export function plural(n: number, forms: readonly [one: string, few: string, many: string]): string {
  switch (pluralRules.select(n)) {
    case 'one':
      return forms[0];
    case 'few':
      return forms[1];
    default:
      return forms[2];
  }
}

export const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'] as const;
export const MONTHS_NOMINATIVE = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'] as const;
export const MONTHS_GENITIVE = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'] as const;
export const MONTHS_LOCATIVE = ['styczniu', 'lutym', 'marcu', 'kwietniu', 'maju', 'czerwcu', 'lipcu', 'sierpniu', 'wrześniu', 'październiku', 'listopadzie', 'grudniu'] as const;
export const WEEKDAYS_SHORT =['pn', 'wt', 'śr', 'cz', 'pt', 'sb', 'nd'] as const;
export const WEEKDAYS = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'] as const;

/** "15 paź" */
export function formatShortDate(date: IsoDate): string {
  const { month, day } = parseIso(date);
  return `${day} ${MONTHS_SHORT[month - 1]}`;
}

/** "cz, 15 paź 2026" */
export function formatDateWithWeekday(date: IsoDate): string {
  const { year } = parseIso(date);
  return `${WEEKDAYS_SHORT[weekday(date)]}, ${formatShortDate(date)} ${year}`;
}

/** "15 października" */
export function formatLongDate(date: IsoDate): string {
  const { month, day } = parseIso(date);
  return `${day} ${MONTHS_GENITIVE[month - 1]}`;
}

/** "dziś", "jutro", "za 5 dni", "wczoraj", "3 dni temu" */
export function formatRelativeDays(days: number): string {
  if (days === 0) return 'dziś';
  if (days === 1) return 'jutro';
  if (days === -1) return 'wczoraj';
  const n = Math.abs(days);
  const word = n === 1 ? 'dzień' : 'dni';
  return days > 0 ? `za ${n} ${word}` : `${n} ${word} temu`;
}
