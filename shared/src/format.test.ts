import { describe, expect, it } from 'vitest';
import { formatDateWithWeekday, formatPLN, formatRelativeDays, parsePLN, plural, splitPLN } from './format.ts';

const nbsp = (s: string) => s.replace(/ /g, ' ');

describe('formatPLN', () => {
  it('grupuje tysiące twardą spacją, także dla 4 cyfr', () => {
    expect(formatPLN(123_456)).toBe(nbsp('1 234,56 zł'));
    expect(formatPLN(4_465_188)).toBe(nbsp('44 651,88 zł'));
    expect(formatPLN(2_399)).toBe(nbsp('23,99 zł'));
  });

  it('dzieli kwotę do dużego wyświetlania', () => {
    expect(splitPLN(455_161)).toEqual({ sign: '', whole: nbsp('4 551'), fraction: ',61' });
    expect(splitPLN(-5)).toEqual({ sign: '−', whole: '0', fraction: ',05' });
  });

  it('używa typograficznego minusa i opcjonalnego plusa', () => {
    expect(formatPLN(-64_000)).toBe('−' + nbsp('640,00 zł'));
    expect(formatPLN(845_000, { sign: true })).toBe('+' + nbsp('8 450,00 zł'));
    expect(formatPLN(0, { sign: true })).toBe(nbsp('0,00 zł'));
  });
});

describe('parsePLN', () => {
  it('czyta zapis polski i wpisany ręcznie', () => {
    expect(parsePLN('2 340,00')).toBe(234_000);
    expect(parsePLN('2340')).toBe(234_000);
    expect(parsePLN('23,9 zł')).toBe(2_390);
    expect(parsePLN('−640,00 zł')).toBe(-64_000);
    expect(parsePLN(formatPLN(123_456))).toBe(123_456);
  });

  it('odrzuca śmieci i zbyt wiele miejsc po przecinku', () => {
    expect(parsePLN('abc')).toBeNull();
    expect(parsePLN('1,234')).toBeNull();
    expect(parsePLN('')).toBeNull();
  });
});

describe('teksty', () => {
  it('odmienia liczebniki', () => {
    const forms = ['płatność', 'płatności', 'płatności'] as const;
    expect(plural(1, forms)).toBe('płatność');
    expect(plural(3, forms)).toBe('płatności');
    expect(plural(5, forms)).toBe('płatności');
    expect(plural(22, ['rata', 'raty', 'rat'])).toBe('raty');
    expect(plural(25, ['rata', 'raty', 'rat'])).toBe('rat');
  });

  it('formatuje daty i odległości', () => {
    expect(formatDateWithWeekday('2026-11-16')).toBe('pn, 16 lis 2026');
    expect(formatRelativeDays(5)).toBe('za 5 dni');
    expect(formatRelativeDays(0)).toBe('dziś');
  });
});
