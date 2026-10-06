import { describe, expect, it } from 'vitest';
import { isCalendarDate, validateAccountInput, validateHouseholdInput } from './settings.ts';

const valid = { name: 'Konto główne', openingBalance: 234_050, openingDate: '2026-01-01' };

describe('isCalendarDate', () => {
  it('przyjmuje prawdziwe daty, także 29 lutego w roku przestępnym', () => {
    expect(isCalendarDate('2026-10-06')).toBe(true);
    expect(isCalendarDate('2028-02-29')).toBe(true);
  });

  it('odrzuca nieistniejące dni i złe formaty', () => {
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2026-02-31')).toBe(false);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('2026-1-1')).toBe(false);
    expect(isCalendarDate('')).toBe(false);
  });
});

describe('validateAccountInput', () => {
  it('poprawne dane nie mają błędów, a saldo może być ujemne albo zerowe', () => {
    expect(validateAccountInput(valid)).toEqual({});
    expect(validateAccountInput({ ...valid, openingBalance: -150_000 })).toEqual({});
    expect(validateAccountInput({ ...valid, openingBalance: 0 })).toEqual({});
  });

  it('wymaga nazwy i pilnuje długości', () => {
    expect(validateAccountInput({ ...valid, name: '   ' }).name).toBeDefined();
    expect(validateAccountInput({ ...valid, name: 'x'.repeat(61) }).name).toBeDefined();
  });

  it('odrzuca duplikat nazwy bez względu na wielkość liter i polskie znaki', () => {
    expect(validateAccountInput({ ...valid, name: 'ŻÓŁTE konto' }, ['żółte konto']).name).toBeDefined();
    expect(validateAccountInput({ ...valid, name: 'Inne' }, ['żółte konto']).name).toBeUndefined();
  });

  it('saldo musi być liczbą całkowitą groszy w rozsądnym zakresie', () => {
    expect(validateAccountInput({ ...valid, openingBalance: 10.5 }).openingBalance).toBeDefined();
    expect(validateAccountInput({ ...valid, openingBalance: Number.NaN }).openingBalance).toBeDefined();
    expect(validateAccountInput({ ...valid, openingBalance: 1e13 }).openingBalance).toBeDefined();
  });

  it('wymaga prawdziwej daty salda', () => {
    expect(validateAccountInput({ ...valid, openingDate: '2026-02-30' }).openingDate).toBeDefined();
  });
});

describe('validateHouseholdInput', () => {
  it('wymaga niepustej nazwy do 60 znaków', () => {
    expect(validateHouseholdInput({ name: 'Dom' })).toEqual({});
    expect(validateHouseholdInput({ name: ' ' }).name).toBeDefined();
    expect(validateHouseholdInput({ name: 'x'.repeat(61) }).name).toBeDefined();
  });
});
