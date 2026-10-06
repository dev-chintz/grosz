// Eksport danych: CSV operacji (do Excela) i kształt pliku kopii zapasowej.

import type { LedgerItem, LedgerStatus } from './api.ts';

/** Wersja formatu kopii — import (gdy powstanie) po niej rozpozna, jak czytać plik. */
export const BACKUP_VERSION = 1;

/** Plik pełnej kopii. Wiersze to dane z bazy bez `household_id` (kopię da się wczytać do innego gospodarstwa). */
export interface BackupFile {
  app: 'grosz';
  version: number;
  /** Znacznik czasu ISO (UTC). */
  exportedAt: string;
  household: { name: string; currency: string };
  accounts: unknown[];
  categories: unknown[];
  recurringRules: unknown[];
  amountVersions: unknown[];
  occurrences: unknown[];
  transactions: unknown[];
}

const BOM = '\uFEFF';
// Excel po polsku używa średnika jako separatora i CRLF jako końca wiersza.
const SEPARATOR = ';';
const EOL = '\r\n';

/** Excel wykona komórkę zaczynającą się od tych znaków jako formułę (np. „=HYPERLINK(...)”). */
const FORMULA_START = /^[=+\-@\t\r]/;

const quote = (value: string) => (/[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** Komórka z tekstem od użytkownika: zabezpieczona przed wykonaniem jako formuła i poprawnie ujęta w cudzysłów. */
export function csvText(value: string | null | undefined): string {
  const text = value ?? '';
  return quote(FORMULA_START.test(text) ? `'${text}` : text);
}

/** Kwota z groszy: „1234,56”, bez separatora tysięcy, z ASCII minusem — Excel czyta to jako liczbę. */
export function csvAmount(grosze: number): string {
  const abs = Math.abs(grosze);
  const text = `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
  return grosze < 0 ? `-${text}` : text;
}

export function toCsv(rows: readonly (readonly string[])[]): string {
  return BOM + rows.map((row) => row.join(SEPARATOR)).join(EOL) + EOL;
}

const STATUS_LABELS: Record<LedgerStatus, string> = { done: 'zrealizowana', planned: 'zaplanowana', overdue: 'po terminie' };

export const LEDGER_CSV_HEADER = ['Data', 'Rodzaj', 'Nazwa', 'Kategoria', 'Konto', 'Kierunek', 'Kwota', 'Kwota zaplanowana', 'Status', 'Notatka'] as const;

/**
 * Operacje do CSV od najstarszej. Kwota ze znakiem (wpływ +, wydatek −), żeby suma kolumny dawała bilans.
 * „Kwota zaplanowana” wypełniona tylko wtedy, gdy rzeczywista kwota rachunku jest inna niż planowana.
 */
export function ledgerToCsv(items: readonly LedgerItem[]): string {
  const sorted = [...items].sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name, 'pl') : a.date < b.date ? -1 : 1));
  const rows = sorted.map((item) => [
    item.date,
    item.kind === 'recurring' ? 'cykliczna' : 'jednorazowa',
    csvText(item.name),
    csvText(item.categoryName),
    csvText(item.accountName),
    item.direction === 'income' ? 'wpływ' : 'wydatek',
    csvAmount(item.direction === 'income' ? item.amount : -item.amount),
    item.plannedAmount === null ? '' : csvAmount(item.direction === 'income' ? item.plannedAmount : -item.plannedAmount),
    STATUS_LABELS[item.status],
    csvText(item.note),
  ]);
  return toCsv([[...LEDGER_CSV_HEADER], ...rows]);
}
