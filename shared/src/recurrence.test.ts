import { describe, expect, it } from 'vitest';
import { isBusinessDay, isPolishHoliday, weekday } from './dates.ts';
import { amountAt, lastOccurrence, occurrences, occurrencesBetween, validateRule, type RecurrenceRule } from './recurrence.ts';

const take = (rule: RecurrenceRule, n: number) => {
  const out = [];
  for (const o of occurrences(rule)) {
    if (out.length === n) break;
    out.push(o);
  }
  return out;
};

const mortgage: RecurrenceRule = {
  unit: 'month',
  interval: 1,
  startDate: '2023-04-15',
  dayOfMonth: 15,
  weekendRule: 'next',
  end: { type: 'count', count: 360 },
};

describe('dni robocze', () => {
  it('liczy dzień tygodnia od poniedziałku', () => {
    expect(weekday('2026-10-05')).toBe(0); // poniedziałek
    expect(weekday('2026-10-04')).toBe(6); // niedziela
  });

  it('zna święta stałe i ruchome', () => {
    expect(isPolishHoliday('2026-11-11')).toBe(true);
    expect(isPolishHoliday('2026-04-06')).toBe(true); // poniedziałek wielkanocny 2026
    expect(isPolishHoliday('2026-06-04')).toBe(true); // Boże Ciało 2026
    expect(isPolishHoliday('2026-12-24')).toBe(true); // Wigilia od 2025
    expect(isPolishHoliday('2024-12-24')).toBe(false);
    expect(isPolishHoliday('2026-10-15')).toBe(false);
    expect(isBusinessDay('2026-10-15')).toBe(true);
  });
});

describe('occurrences', () => {
  it('rata kredytu: 43. rata w październiku 2026, listopadowa przesunięta z niedzieli', () => {
    const between = occurrencesBetween(mortgage, '2026-10-01', '2026-11-30');
    expect(between.map((o) => [o.index + 1, o.dueDate, o.shifted])).toEqual([
      [43, '2026-10-15', false],
      [44, '2026-11-16', true],
    ]);
    expect(between[1]?.nominalDate).toBe('2026-11-15');
  });

  it('kończy się po zadanej liczbie płatności', () => {
    expect(lastOccurrence(mortgage)).toMatchObject({ index: 359, nominalDate: '2053-03-15' });
  });

  it('dzień 31 w krótszym miesiącu przypada na ostatni dzień', () => {
    const rule: RecurrenceRule = { unit: 'month', interval: 1, startDate: '2026-01-31', weekendRule: 'none', end: { type: 'never' } };
    expect(take(rule, 3).map((o) => o.nominalDate)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('„ostatni dzień miesiąca” to osobna opcja', () => {
    const rule: RecurrenceRule = { unit: 'month', interval: 1, startDate: '2028-01-31', dayOfMonth: 'last', weekendRule: 'none', end: { type: 'never' } };
    expect(take(rule, 3).map((o) => o.nominalDate)).toEqual(['2028-01-31', '2028-02-29', '2028-03-31']);
  });

  it('dzień płatności wcześniejszy niż start przesuwa pierwszą płatność na kolejny okres', () => {
    const rule: RecurrenceRule = { unit: 'month', interval: 1, startDate: '2026-10-20', dayOfMonth: 5, weekendRule: 'none', end: { type: 'never' } };
    expect(take(rule, 2).map((o) => o.nominalDate)).toEqual(['2026-11-05', '2026-12-05']);
  });

  it('co 2 miesiące, co kwartał i co rok', () => {
    const base = { startDate: '2026-10-20', weekendRule: 'none', end: { type: 'never' } } as const;
    expect(take({ ...base, unit: 'month', interval: 2 }, 3).map((o) => o.nominalDate)).toEqual(['2026-10-20', '2026-12-20', '2027-02-20']);
    expect(take({ ...base, unit: 'month', interval: 3 }, 2).map((o) => o.nominalDate)).toEqual(['2026-10-20', '2027-01-20']);
    expect(take({ ...base, unit: 'year', interval: 1 }, 2).map((o) => o.nominalDate)).toEqual(['2026-10-20', '2027-10-20']);
  });

  it('co tydzień od dnia startu', () => {
    const rule: RecurrenceRule = { unit: 'week', interval: 1, startDate: '2026-10-08', weekendRule: 'none', end: { type: 'never' } };
    expect(take(rule, 3).map((o) => o.nominalDate)).toEqual(['2026-10-08', '2026-10-15', '2026-10-22']);
  });

  it('przesuwa na poprzedni dzień roboczy, omijając święto', () => {
    const rule: RecurrenceRule = { unit: 'month', interval: 1, startDate: '2026-11-11', weekendRule: 'previous', end: { type: 'count', count: 1 } };
    expect(take(rule, 1)[0]).toMatchObject({ nominalDate: '2026-11-11', dueDate: '2026-11-10', shifted: true });
  });

  it('kończy się na dacie końcowej', () => {
    const rule: RecurrenceRule = { unit: 'month', interval: 1, startDate: '2026-10-01', weekendRule: 'none', end: { type: 'until', date: '2026-12-31' } };
    expect([...occurrences(rule)].map((o) => o.nominalDate)).toEqual(['2026-10-01', '2026-11-01', '2026-12-01']);
  });

  it('waliduje regułę', () => {
    expect(validateRule({ ...mortgage, interval: 0 })).toHaveLength(1);
    expect(validateRule({ ...mortgage, dayOfMonth: 32 })).toHaveLength(1);
    expect(validateRule(mortgage)).toEqual([]);
  });
});

describe('amountAt', () => {
  const versions = [
    { effectiveFrom: '2023-04-15', amount: 241_000 },
    { effectiveFrom: '2026-07-01', amount: 234_000 },
  ];
  it('wybiera kwotę obowiązującą w danym dniu', () => {
    expect(amountAt(versions, '2026-06-15')).toBe(241_000);
    expect(amountAt(versions, '2026-07-15')).toBe(234_000);
    expect(amountAt(versions, '2023-01-01')).toBeNull();
  });
});
