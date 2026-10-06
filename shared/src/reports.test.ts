import { describe, expect, it } from 'vitest';
import { aggregateReport, monthKeys, UNCATEGORIZED_LABEL, type ReportItem } from './reports.ts';

describe('monthKeys', () => {
  it('zwraca miesiące od najstarszego i przechodzi przez granicę roku', () => {
    expect(monthKeys('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('aggregateReport', () => {
  const keys = ['2026-09', '2026-10'];
  const items: ReportItem[] = [
    { date: '2026-09-10', direction: 'income', kind: 'recurring', amount: 800000, category: 'Wypłata' },
    { date: '2026-09-15', direction: 'expense', kind: 'recurring', amount: 200000, category: 'Mieszkanie' },
    { date: '2026-09-20', direction: 'expense', kind: 'oneoff', amount: 30000, category: 'Jedzenie' },
    { date: '2026-10-10', direction: 'income', kind: 'recurring', amount: 800000, category: 'Wypłata' },
    { date: '2026-10-15', direction: 'expense', kind: 'recurring', amount: 200000, category: 'Mieszkanie' },
    { date: '2026-10-21', direction: 'expense', kind: 'oneoff', amount: 10001, category: null },
    { date: '2026-08-31', direction: 'expense', kind: 'oneoff', amount: 999999, category: 'Jedzenie' },
  ];
  const report = aggregateReport(items, keys);

  it('sumuje wpływy, wydatki stałe i jednorazowe per miesiąc', () => {
    expect(report.months).toEqual([
      { month: '2026-09', income: 800000, fixed: 200000, oneOff: 30000 },
      { month: '2026-10', income: 800000, fixed: 200000, oneOff: 10001 },
    ]);
  });

  it('pomija operacje spoza okresu', () => {
    expect(report.categories.find((c) => c.name === 'Jedzenie')?.amount).toBe(30000);
  });

  it('liczy sumy i stopę oszczędności', () => {
    expect(report.totals.income).toBe(1600000);
    expect(report.totals.expenses).toBe(440001);
    expect(report.totals.balance).toBe(1159999);
    expect(report.totals.savingsRate).toBeCloseTo(1159999 / 1600000);
  });

  it('wydatki bez kategorii trafiają do osobnej pozycji, a wpływy nie wchodzą do kategorii', () => {
    expect(report.categories.map((c) => c.name)).toEqual(['Mieszkanie', 'Jedzenie', UNCATEGORIZED_LABEL]);
    expect(report.categories.map((c) => c.name)).not.toContain('Wypłata');
  });

  it('udziały kategorii sumują się do 1, a średnia jest na miesiąc okresu', () => {
    expect(report.categories.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1);
    expect(report.categories[0]).toMatchObject({ name: 'Mieszkanie', amount: 400000, average: 200000 });
  });

  it('bez wpływów stopa oszczędności to null, nie 0 ani NaN', () => {
    const only = aggregateReport([{ date: '2026-10-01', direction: 'expense', kind: 'oneoff', amount: 500, category: null }], keys);
    expect(only.totals.savingsRate).toBeNull();
  });

  it('pusty okres daje zera i brak kategorii', () => {
    const empty = aggregateReport([], keys);
    expect(empty.totals).toEqual({ income: 0, expenses: 0, balance: 0, savingsRate: null });
    expect(empty.categories).toEqual([]);
  });
});
