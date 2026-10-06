// Dane formularza reguły cyklicznej: wspólna walidacja i przeliczenia dla przeglądarki i serwera.

import { addDays, daysBetween, parseIso, type IsoDate } from './dates.ts';
import { lastOccurrence, occurrences, validateRule, type RecurrenceEnd, type RecurrenceRule, type RecurrenceUnit, type WeekendRule } from './recurrence.ts';

export type Direction = 'expense' | 'income';

export interface RuleInput {
  name: string;
  direction: Direction;
  categoryId: string | null;
  accountId: string | null;
  /** Domownik, którego dotyczy płatność; null = wspólna. */
  userId: string | null;
  payee: string | null;
  /** W groszach, > 0. */
  amount: number;
  variableAmount: boolean;
  unit: RecurrenceUnit;
  interval: number;
  startDate: IsoDate;
  dayOfMonth: number | null;
  lastDayOfMonth: boolean;
  weekendRule: WeekendRule;
  endType: RecurrenceEnd['type'];
  endDate: IsoDate | null;
  endCount: number | null;
  remindDaysBefore: number | null;
  autoBook: boolean;
  note: string | null;
}

export type RuleInputErrors = Partial<Record<keyof RuleInput, string>>;

export function toRecurrenceRule(input: Pick<RuleInput, 'unit' | 'interval' | 'startDate' | 'dayOfMonth' | 'lastDayOfMonth' | 'weekendRule' | 'endType' | 'endDate' | 'endCount'>): RecurrenceRule {
  const monthly = input.unit === 'month' || input.unit === 'year';
  return {
    unit: input.unit,
    interval: input.interval,
    startDate: input.startDate,
    dayOfMonth: !monthly ? undefined : input.lastDayOfMonth ? 'last' : (input.dayOfMonth ?? undefined),
    weekendRule: input.weekendRule,
    end:
      input.endType === 'count'
        ? { type: 'count', count: input.endCount ?? 0 }
        : input.endType === 'until'
          ? { type: 'until', date: input.endDate ?? input.startDate }
          : { type: 'never' },
  };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isIso = (v: unknown): v is IsoDate => {
  if (typeof v !== 'string' || !ISO.test(v)) return false;
  const { month, day } = parseIso(v);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
};

/** Pusty obiekt = poprawne dane. Komunikaty po polsku, gotowe do pokazania przy polu. */
export function validateRuleInput(input: RuleInput): RuleInputErrors {
  const errors: RuleInputErrors = {};
  if (!input.name.trim()) errors.name = 'Podaj nazwę.';
  else if (input.name.length > 120) errors.name = 'Nazwa może mieć najwyżej 120 znaków.';
  if (!Number.isInteger(input.amount) || input.amount <= 0) errors.amount = 'Podaj kwotę większą od zera.';
  else if (input.amount > 100_000_000_00) errors.amount = 'Kwota jest zbyt duża.';
  if (!Number.isInteger(input.interval) || input.interval < 1 || input.interval > 99) errors.interval = 'Odstęp musi być liczbą od 1 do 99.';
  if (!isIso(input.startDate)) errors.startDate = 'Podaj datę pierwszej płatności.';
  if (input.dayOfMonth !== null && (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 31)) {
    errors.dayOfMonth = 'Dzień płatności musi być z zakresu 1–31.';
  }
  if (input.endType === 'until') {
    if (!isIso(input.endDate)) errors.endDate = 'Podaj datę zakończenia.';
    else if (isIso(input.startDate) && input.endDate < input.startDate) errors.endDate = 'Koniec nie może być przed pierwszą płatnością.';
  }
  if (input.endType === 'count' && (!Number.isInteger(input.endCount) || (input.endCount ?? 0) < 1 || (input.endCount ?? 0) > 2000)) {
    errors.endCount = 'Liczba płatności musi być od 1 do 2000.';
  }
  if (input.remindDaysBefore !== null && (!Number.isInteger(input.remindDaysBefore) || input.remindDaysBefore < 0 || input.remindDaysBefore > 60)) {
    errors.remindDaysBefore = 'Przypomnienie: od 0 do 60 dni.';
  }
  if (Object.keys(errors).length === 0) {
    const ruleErrors = validateRule(toRecurrenceRule(input));
    if (ruleErrors.length) errors.unit = ruleErrors[0];
  }
  return errors;
}

/** Przybliżony koszt miesięczny reguły — do sum „≈ X zł / miesiąc”. */
export function monthlyEquivalent(amount: number, unit: RecurrenceUnit, interval: number): number {
  const perMonth = { day: 365 / 12, week: 52 / 12, month: 1, year: 1 / 12 }[unit] / interval;
  return Math.round(amount * perMonth);
}

export interface ScheduleSummary {
  /** Płatności z terminem przed `today` (dla rat: ile już za nami). */
  done: number;
  total: number | null;
  next: { dueDate: IsoDate; nominalDate: IsoDate; shifted: boolean; number: number } | null;
  last: IsoDate | null;
  /** Ile płatności jeszcze zostało (od dziś włącznie); null dla bezterminowych. */
  remaining: number | null;
  /** Kończy się w ciągu pół roku. */
  endingSoon: boolean;
}

export function summarizeSchedule(rule: RecurrenceRule, today: IsoDate): ScheduleSummary {
  let done = 0;
  let next: ScheduleSummary['next'] = null;
  for (const o of occurrences(rule)) {
    if (o.dueDate < today) {
      done++;
      continue;
    }
    next = { dueDate: o.dueDate, nominalDate: o.nominalDate, shifted: o.shifted, number: o.index + 1 };
    break;
  }
  const lastOccurrenceOfRule = lastOccurrence(rule);
  const total = rule.end.type === 'count' ? rule.end.count : rule.end.type === 'until' ? (lastOccurrenceOfRule ? lastOccurrenceOfRule.index + 1 : 0) : null;
  const last = lastOccurrenceOfRule?.dueDate ?? null;
  return {
    done,
    total,
    next,
    last,
    remaining: total === null ? null : Math.max(0, total - done),
    endingSoon: last !== null && last >= today && daysBetween(today, last) <= 183,
  };
}

/** Najbliższe terminy od `from` — podgląd w formularzu. */
export function upcomingDates(rule: RecurrenceRule, from: IsoDate, limit: number) {
  const result = [];
  const stop = addDays(from, 366 * 30);
  for (const o of occurrences(rule)) {
    if (o.nominalDate > stop || result.length >= limit) break;
    if (o.dueDate >= from) result.push(o);
  }
  return result;
}
