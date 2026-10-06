// Daty płatności to daty kalendarzowe bez godziny, zapisane jako 'YYYY-MM-DD'.
// Cała arytmetyka idzie przez UTC, więc strefa czasowa komputera nie przesuwa dni.

export type IsoDate = string;

export const APP_TIME_ZONE = 'Europe/Warsaw';

export function toIso(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseIso(date: IsoDate): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Nieprawidłowa data: ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function toUtc(date: IsoDate): Date {
  const { year, month, day } = parseIso(date);
  return new Date(Date.UTC(year, month - 1, day));
}

function fromUtc(d: Date): IsoDate {
  return toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** month: 1–12 */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 0 = poniedziałek … 6 = niedziela (polski tydzień). */
export function weekday(date: IsoDate): number {
  return (toUtc(date).getUTCDay() + 6) % 7;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

/** Przesuwa (rok, miesiąc) o n miesięcy; month: 1–12. */
export function addMonths(year: number, month: number, n: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + n;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

export function monthStart(date: IsoDate): IsoDate {
  const { year, month } = parseIso(date);
  return toIso(year, month, 1);
}

export function monthEnd(date: IsoDate): IsoDate {
  const { year, month } = parseIso(date);
  return toIso(year, month, daysInMonth(year, month));
}

/** Dzisiejsza data w strefie aplikacji (nie w strefie serwera). */
export function today(timeZone: string = APP_TIME_ZONE): IsoDate {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// Polskie dni ustawowo wolne — w te dni bank nie realizuje przelewów,
// więc reguła „przesuń na dzień roboczy” musi je omijać tak jak weekendy.
const FIXED_HOLIDAYS: Record<string, string> = {
  '01-01': 'Nowy Rok',
  '01-06': 'Trzech Króli',
  '05-01': 'Święto Pracy',
  '05-03': 'Święto Konstytucji 3 Maja',
  '08-15': 'Wniebowzięcie NMP',
  '11-01': 'Wszystkich Świętych',
  '11-11': 'Święto Niepodległości',
  '12-25': 'Boże Narodzenie',
  '12-26': 'Drugi dzień Bożego Narodzenia',
};

const EASTER_HOLIDAYS: [offset: number, name: string][] = [
  [0, 'Wielkanoc'],
  [1, 'Poniedziałek Wielkanocny'],
  [49, 'Zielone Świątki'],
  [60, 'Boże Ciało'],
];

function easterSunday(year: number): IsoDate {
  // Algorytm Meeusa/Jonesa/Butchera (kalendarz gregoriański).
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toIso(year, month, day);
}

/** Nazwa polskiego dnia ustawowo wolnego albo null. */
export function polishHolidayName(date: IsoDate): string | null {
  const { year } = parseIso(date);
  const monthDay = date.slice(5);
  const fixed = FIXED_HOLIDAYS[monthDay];
  if (fixed) return fixed;
  // Wigilia jest dniem wolnym od 2025 r.
  if (monthDay === '12-24' && year >= 2025) return 'Wigilia';
  const easter = easterSunday(year);
  return EASTER_HOLIDAYS.find(([offset]) => addDays(easter, offset) === date)?.[1] ?? null;
}

export function isPolishHoliday(date: IsoDate): boolean {
  return polishHolidayName(date) !== null;
}

export function isBusinessDay(date: IsoDate): boolean {
  return weekday(date) < 5 && !isPolishHoliday(date);
}
