// Operacje jednorazowe: dane formularza i wspólna walidacja dla przeglądarki i serwera.

import { parseIso, type IsoDate } from './dates.ts';

export interface TransactionInput {
  direction: 'expense' | 'income';
  /** W groszach, > 0. */
  amount: number;
  date: IsoDate;
  description: string;
  categoryId: string | null;
  accountId: string | null;
  /** Domownik, którego dotyczy operacja; null = wspólna. */
  userId: string | null;
  note: string | null;
}

export type TransactionInputErrors = Partial<Record<keyof TransactionInput, string>>;

const isIsoDate = (v: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const { month, day } = parseIso(v);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
};

/** Pusty obiekt = poprawne dane. */
export function validateTransactionInput(input: TransactionInput): TransactionInputErrors {
  const errors: TransactionInputErrors = {};
  if (!Number.isInteger(input.amount) || input.amount <= 0) errors.amount = 'Podaj kwotę większą od zera.';
  else if (input.amount > 100_000_000_00) errors.amount = 'Kwota jest zbyt duża.';
  if (!isIsoDate(input.date)) errors.date = 'Podaj datę.';
  if (!input.description.trim()) errors.description = 'Podaj opis, np. „Zakupy spożywcze”.';
  else if (input.description.length > 200) errors.description = 'Opis może mieć najwyżej 200 znaków.';
  if (input.note && input.note.length > 2000) errors.note = 'Notatka może mieć najwyżej 2000 znaków.';
  return errors;
}
