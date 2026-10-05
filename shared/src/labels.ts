import { parseIso } from './dates.ts';
import { MONTHS_GENITIVE, plural } from './format.ts';
import type { RecurrenceRule } from './recurrence.ts';

const every = (n: number, forms: readonly [string, string, string]) => `co ${n} ${plural(n, forms)}`;

/** „co miesiąc, 15.”, „co 2 miesiące, 20.”, „co kwartał, 1.”, „co rok, 3 marca”, „co tydzień” */
export function describeFrequency(rule: Pick<RecurrenceRule, 'unit' | 'interval' | 'dayOfMonth' | 'startDate'>): string {
  const { unit, interval } = rule;
  const start = parseIso(rule.startDate);
  switch (unit) {
    case 'day':
      return interval === 1 ? 'codziennie' : every(interval, ['dzień', 'dni', 'dni']);
    case 'week':
      return interval === 1 ? 'co tydzień' : every(interval, ['tydzień', 'tygodnie', 'tygodni']);
    case 'month': {
      const day = rule.dayOfMonth === 'last' ? 'ostatni dzień' : `${rule.dayOfMonth ?? start.day}.`;
      if (interval === 1) return `co miesiąc, ${day}`;
      if (interval === 3) return `co kwartał, ${day}`;
      return `${every(interval, ['miesiąc', 'miesiące', 'miesięcy'])}, ${day}`;
    }
    case 'year': {
      const day = rule.dayOfMonth === 'last' ? 'ostatni dzień' : String(rule.dayOfMonth ?? start.day);
      const when = `${day} ${MONTHS_GENITIVE[start.month - 1]}`;
      return interval === 1 ? `co rok, ${when}` : `${every(interval, ['rok', 'lata', 'lat'])}, ${when}`;
    }
  }
}
