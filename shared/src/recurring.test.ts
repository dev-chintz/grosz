import { describe, expect, it } from 'vitest';
import { monthlyEquivalent, summarizeSchedule, toRecurrenceRule, upcomingDates, validateRuleInput, type RuleInput } from './recurring.ts';

const mortgage: RuleInput = {
  name: 'Rata kredytu hipotecznego',
  direction: 'expense',
  categoryId: null,
  accountId: null,
  payee: null,
  amount: 234_000,
  variableAmount: false,
  unit: 'month',
  interval: 1,
  startDate: '2023-04-15',
  dayOfMonth: 15,
  lastDayOfMonth: false,
  weekendRule: 'next',
  endType: 'count',
  endDate: null,
  endCount: 360,
  remindDaysBefore: 3,
  autoBook: true,
  note: null,
};

describe('validateRuleInput', () => {
  it('przepuszcza poprawne dane', () => {
    expect(validateRuleInput(mortgage)).toEqual({});
  });

  it('zgłasza błędy przy konkretnych polach', () => {
    const errors = validateRuleInput({ ...mortgage, name: ' ', amount: 0, endCount: 0, startDate: '2026-13-01' });
    expect(Object.keys(errors).sort()).toEqual(['amount', 'endCount', 'name', 'startDate']);
  });

  it('pilnuje daty końca po starcie', () => {
    expect(validateRuleInput({ ...mortgage, endType: 'until', endDate: '2020-01-01' }).endDate).toBeDefined();
  });
});

describe('summarizeSchedule', () => {
  it('liczy raty za nami i najbliższą', () => {
    const s = summarizeSchedule(toRecurrenceRule(mortgage), '2026-10-06');
    expect(s).toMatchObject({ done: 42, total: 360, remaining: 318, endingSoon: false });
    expect(s.next).toMatchObject({ dueDate: '2026-10-15', number: 43 });
    expect(s.last).toBe('2053-03-17'); // 15.03.2053 to sobota → poniedziałek
  });

  it('wykrywa regułę kończącą się w ciągu pół roku', () => {
    const gym = { ...mortgage, startDate: '2025-01-01', dayOfMonth: 1, endType: 'until' as const, endDate: '2026-12-31', endCount: null, weekendRule: 'none' as const };
    const s = summarizeSchedule(toRecurrenceRule(gym), '2026-10-06');
    expect(s).toMatchObject({ endingSoon: true, total: 24, done: 22, remaining: 2 });
  });
});

describe('upcomingDates', () => {
  it('pokazuje najbliższe terminy z przesunięciem', () => {
    const dates = upcomingDates(toRecurrenceRule(mortgage), '2026-10-06', 2).map((o) => [o.index + 1, o.dueDate]);
    expect(dates).toEqual([
      [43, '2026-10-15'],
      [44, '2026-11-16'],
    ]);
  });
});

describe('monthlyEquivalent', () => {
  it('przelicza okresy na miesiąc', () => {
    expect(monthlyEquivalent(18_000, 'month', 2)).toBe(9_000);
    expect(monthlyEquivalent(114_000, 'year', 1)).toBe(9_500);
    expect(monthlyEquivalent(1_000, 'week', 1)).toBe(4_333);
  });
});
