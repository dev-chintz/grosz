// Ustawienia: gospodarstwo i konta — dane formularzy i wspólna walidacja dla przeglądarki i serwera.

import { daysInMonth } from './dates.ts';

export interface AccountInput {
  name: string;
  /** Saldo na początek dnia `openingDate`, w groszach; może być ujemne (debet). */
  openingBalance: number;
  /** YYYY-MM-DD */
  openingDate: string;
  /** Bank code from BANKS, or null. */
  bank: string | null;
}

export type AccountInputErrors = Partial<Record<keyof AccountInput, string>>;

export interface HouseholdInput {
  name: string;
}

export type HouseholdInputErrors = Partial<Record<keyof HouseholdInput, string>>;

export interface MemberInput {
  name: string;
}

export type MemberInputErrors = Partial<Record<keyof MemberInput, string>>;

const MAX_BALANCE = 100_000_000_00;

/** Prawdziwa data kalendarzowa (odrzuca np. 2026-02-31). */
export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return year >= 1900 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase('pl') === b.trim().toLocaleLowerCase('pl');

export function validateAccountInput(input: AccountInput, existingNames: readonly string[] = []): AccountInputErrors {
  const errors: AccountInputErrors = {};
  const name = input.name.trim();
  if (!name) errors.name = 'Podaj nazwę konta.';
  else if (name.length > 60) errors.name = 'Nazwa może mieć najwyżej 60 znaków.';
  else if (existingNames.some((n) => sameName(n, name))) errors.name = 'Takie konto już istnieje.';
  if (!Number.isInteger(input.openingBalance) || Math.abs(input.openingBalance) > MAX_BALANCE) {
    errors.openingBalance = 'Podaj saldo jako kwotę, np. 2 340,50.';
  }
  if (!isCalendarDate(input.openingDate)) errors.openingDate = 'Podaj datę salda.';
  return errors;
}

export function validateMemberInput(input: MemberInput, existingNames: readonly string[] = []): MemberInputErrors {
  const name = input.name.trim();
  if (!name) return { name: 'Podaj imię lub nazwę osoby.' };
  if (name.length > 60) return { name: 'Nazwa może mieć najwyżej 60 znaków.' };
  if (existingNames.some((n) => sameName(n, name))) return { name: 'Taka osoba już jest na liście.' };
  return {};
}

export function validateHouseholdInput(input: HouseholdInput): HouseholdInputErrors {
  const name = input.name.trim();
  if (!name) return { name: 'Podaj nazwę gospodarstwa.' };
  if (name.length > 60) return { name: 'Nazwa może mieć najwyżej 60 znaków.' };
  return {};
}
