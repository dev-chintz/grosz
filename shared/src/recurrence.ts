// Silnik terminów wydatków cyklicznych. Używa go serwer (generowanie wystąpień)
// i formularz w przeglądarce (podgląd „Najbliższe terminy”), żeby oba zawsze liczyły tak samo.

import { addDays, addMonths, daysInMonth, isBusinessDay, parseIso, toIso, type IsoDate } from './dates.ts';

export type RecurrenceUnit = 'day' | 'week' | 'month' | 'year';
export type WeekendRule = 'next' | 'previous' | 'none';
export type RecurrenceEnd =
  | { type: 'never' }
  | { type: 'until'; date: IsoDate }
  | { type: 'count'; count: number };

export interface RecurrenceRule {
  unit: RecurrenceUnit;
  /** Co ile jednostek, np. kwartał = { unit: 'month', interval: 3 }. */
  interval: number;
  /** Pierwsza płatność. Wcześniejszych terminów nie ma. */
  startDate: IsoDate;
  /** Tylko dla month/year. Brak = dzień ze startDate. 29–31 w krótszym miesiącu → ostatni dzień. */
  dayOfMonth?: number | 'last';
  /** Co zrobić, gdy termin wypada w weekend lub polskie święto. */
  weekendRule: WeekendRule;
  end: RecurrenceEnd;
}

export interface Occurrence {
  /** 0 = pierwsza płatność; przy ratach numer raty to index + 1. */
  index: number;
  /** Termin wynikający z reguły. */
  nominalDate: IsoDate;
  /** Termin po przesunięciu na dzień roboczy. */
  dueDate: IsoDate;
  shifted: boolean;
}

export function validateRule(rule: RecurrenceRule): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(rule.interval) || rule.interval < 1) errors.push('Odstęp musi być liczbą całkowitą ≥ 1.');
  if (typeof rule.dayOfMonth === 'number' && (!Number.isInteger(rule.dayOfMonth) || rule.dayOfMonth < 1 || rule.dayOfMonth > 31)) {
    errors.push('Dzień płatności musi być z zakresu 1–31.');
  }
  if (rule.end.type === 'count' && (!Number.isInteger(rule.end.count) || rule.end.count < 1)) {
    errors.push('Liczba płatności musi być ≥ 1.');
  }
  if (rule.end.type === 'until' && rule.end.date < rule.startDate) {
    errors.push('Data zakończenia nie może być wcześniejsza niż pierwsza płatność.');
  }
  return errors;
}

function nominalAt(rule: RecurrenceRule, step: number): IsoDate {
  switch (rule.unit) {
    case 'day':
      return addDays(rule.startDate, step * rule.interval);
    case 'week':
      return addDays(rule.startDate, step * rule.interval * 7);
    case 'month':
    case 'year': {
      const start = parseIso(rule.startDate);
      const months = step * rule.interval * (rule.unit === 'year' ? 12 : 1);
      const { year, month } = addMonths(start.year, start.month, months);
      const last = daysInMonth(year, month);
      const wanted = rule.dayOfMonth ?? start.day;
      return toIso(year, month, wanted === 'last' ? last : Math.min(wanted, last));
    }
  }
}

export function applyWeekendRule(date: IsoDate, rule: WeekendRule): IsoDate {
  if (rule === 'none') return date;
  const direction = rule === 'next' ? 1 : -1;
  let result = date;
  // Najdłuższy ciąg dni wolnych w Polsce to kilka dni, więc 14 kroków to bezpieczny limit.
  for (let i = 0; i < 14 && !isBusinessDay(result); i++) result = addDays(result, direction);
  return result;
}

/** Wszystkie terminy po kolei. Dla reguły bezterminowej generator jest nieskończony. */
export function* occurrences(rule: RecurrenceRule): Generator<Occurrence> {
  // Gdy dzień płatności jest wcześniejszy niż dzień startDate, pierwszy termin wypada w kolejnym okresie.
  const offset = nominalAt(rule, 0) < rule.startDate ? 1 : 0;
  for (let index = 0; ; index++) {
    if (rule.end.type === 'count' && index >= rule.end.count) return;
    const nominalDate = nominalAt(rule, index + offset);
    if (rule.end.type === 'until' && nominalDate > rule.end.date) return;
    const dueDate = applyWeekendRule(nominalDate, rule.weekendRule);
    yield { index, nominalDate, dueDate, shifted: dueDate !== nominalDate };
  }
}

/** Terminy, których dueDate mieści się w [from, to] (włącznie). */
export function occurrencesBetween(rule: RecurrenceRule, from: IsoDate, to: IsoDate): Occurrence[] {
  const result: Occurrence[] = [];
  // Przesunięcie „na poprzedni dzień roboczy” może cofnąć termin o kilka dni,
  // więc kończymy dopiero, gdy termin nominalny jest wyraźnie za zakresem.
  const stopAfter = addDays(to, 14);
  for (const occurrence of occurrences(rule)) {
    if (occurrence.nominalDate > stopAfter) break;
    if (occurrence.dueDate >= from && occurrence.dueDate <= to) result.push(occurrence);
  }
  return result;
}

/** Ostatni termin reguły skończonej; null dla bezterminowej. */
export function lastOccurrence(rule: RecurrenceRule): Occurrence | null {
  if (rule.end.type === 'never') return null;
  let last: Occurrence | null = null;
  for (const occurrence of occurrences(rule)) last = occurrence;
  return last;
}

export interface AmountVersion {
  effectiveFrom: IsoDate;
  /** W groszach. */
  amount: number;
}

/** Kwota obowiązująca w danym dniu: najnowsza wersja z effectiveFrom ≤ date. */
export function amountAt(versions: readonly AmountVersion[], date: IsoDate): number | null {
  let best: AmountVersion | null = null;
  for (const version of versions) {
    if (version.effectiveFrom <= date && (!best || version.effectiveFrom > best.effectiveFrom)) best = version;
  }
  return best?.amount ?? null;
}
