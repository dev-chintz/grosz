import { and, asc, count, eq } from 'drizzle-orm';
import type { AccountDto, MemberDto, SettingsResponse } from '@grosz/shared/api';
import {
  validateAccountInput,
  validateHouseholdInput,
  validateMemberInput,
  type AccountInput,
  type AccountInputErrors,
  type HouseholdInput,
  type HouseholdInputErrors,
  type MemberInput,
  type MemberInputErrors,
} from '@grosz/shared/settings';
import type { Db } from '../db/client.ts';
import { accounts, households, recurringRules, transactions, users } from '../db/schema.ts';

export class SettingsValidationError extends Error {
  readonly statusCode = 400;
  readonly errors: AccountInputErrors | HouseholdInputErrors | MemberInputErrors;
  constructor(errors: AccountInputErrors | HouseholdInputErrors | MemberInputErrors) {
    super('Popraw zaznaczone pola.');
    this.errors = errors;
  }
}

class SettingsError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export async function getSettings(db: Db, householdId: string): Promise<SettingsResponse> {
  const [household] = await db.select().from(households).where(eq(households.id, householdId));
  if (!household) throw new SettingsError(404, 'Nie znaleziono gospodarstwa.');
  const [rows, ruleCounts, transactionCounts, memberRows, memberRuleCounts, memberTransactionCounts] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.householdId, householdId)).orderBy(asc(accounts.archived), asc(accounts.name)),
    db.select({ accountId: recurringRules.accountId, n: count() }).from(recurringRules).where(eq(recurringRules.householdId, householdId)).groupBy(recurringRules.accountId),
    db.select({ accountId: transactions.accountId, n: count() }).from(transactions).where(eq(transactions.householdId, householdId)).groupBy(transactions.accountId),
    db.select().from(users).where(eq(users.householdId, householdId)).orderBy(asc(users.name)),
    db.select({ userId: recurringRules.userId, n: count() }).from(recurringRules).where(eq(recurringRules.householdId, householdId)).groupBy(recurringRules.userId),
    db.select({ userId: transactions.userId, n: count() }).from(transactions).where(eq(transactions.householdId, householdId)).groupBy(transactions.userId),
  ]);
  const members: MemberDto[] = memberRows.map((m) => ({
    id: m.id,
    name: m.name,
    rulesCount: memberRuleCounts.find((r) => r.userId === m.id)?.n ?? 0,
    transactionsCount: memberTransactionCounts.find((r) => r.userId === m.id)?.n ?? 0,
  }));
  const result: AccountDto[] = rows.map((a) => ({
    id: a.id,
    name: a.name,
    openingBalance: a.openingBalance,
    openingDate: a.openingDate,
    archived: a.archived,
    rulesCount: ruleCounts.find((r) => r.accountId === a.id)?.n ?? 0,
    transactionsCount: transactionCounts.find((r) => r.accountId === a.id)?.n ?? 0,
  }));
  return { household: { name: household.name, currency: household.currency }, members, accounts: result };
}

export async function updateHousehold(db: Db, householdId: string, input: HouseholdInput): Promise<void> {
  const errors = validateHouseholdInput(input);
  if (Object.keys(errors).length) throw new SettingsValidationError(errors);
  await db.update(households).set({ name: input.name.trim() }).where(eq(households.id, householdId));
}

async function otherNames(db: Db, householdId: string, exceptId?: string) {
  const rows = await db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(eq(accounts.householdId, householdId));
  return rows.filter((r) => r.id !== exceptId).map((r) => r.name);
}

async function findAccount(db: Db, householdId: string, id: string) {
  const [row] = await db.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.householdId, householdId)));
  if (!row) throw new SettingsError(404, 'Nie znaleziono konta.');
  return row;
}

export async function createAccount(db: Db, householdId: string, input: AccountInput): Promise<string> {
  const errors = validateAccountInput(input, await otherNames(db, householdId));
  if (Object.keys(errors).length) throw new SettingsValidationError(errors);
  const [row] = await db
    .insert(accounts)
    .values({ householdId, name: input.name.trim(), openingBalance: input.openingBalance, openingDate: input.openingDate })
    .returning({ id: accounts.id });
  return row!.id;
}

export async function updateAccount(db: Db, householdId: string, id: string, input: AccountInput): Promise<void> {
  await findAccount(db, householdId, id);
  const errors = validateAccountInput(input, await otherNames(db, householdId, id));
  if (Object.keys(errors).length) throw new SettingsValidationError(errors);
  await db
    .update(accounts)
    .set({ name: input.name.trim(), openingBalance: input.openingBalance, openingDate: input.openingDate })
    .where(and(eq(accounts.id, id), eq(accounts.householdId, householdId)));
}

/**
 * Konta nie usuwamy: płatności i operacje straciłyby przypisanie, a historia salda by się zmieniła.
 * Archiwizacja wyłącza konto z formularzy i z prognozy salda; ostatniego aktywnego konta nie można zarchiwizować.
 */
export async function setAccountArchived(db: Db, householdId: string, id: string, archived: boolean): Promise<void> {
  const account = await findAccount(db, householdId, id);
  if (account.archived === archived) return;
  if (archived) {
    const active = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.householdId, householdId), eq(accounts.archived, false)));
    if (active.length <= 1) throw new SettingsError(400, 'Musi zostać co najmniej jedno aktywne konto.');
  }
  await db.update(accounts).set({ archived }).where(and(eq(accounts.id, id), eq(accounts.householdId, householdId)));
}

async function otherMemberNames(db: Db, householdId: string, exceptId?: string) {
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.householdId, householdId));
  return rows.filter((r) => r.id !== exceptId).map((r) => r.name);
}

async function findMember(db: Db, householdId: string, id: string) {
  const [row] = await db.select().from(users).where(and(eq(users.id, id), eq(users.householdId, householdId)));
  if (!row) throw new SettingsError(404, 'Nie znaleziono osoby.');
  return row;
}

/** Czy `userId` to domownik tego gospodarstwa — żeby nie dało się przypisać operacji do cudzej osoby. */
export async function memberExists(db: Db, householdId: string, userId: string): Promise<boolean> {
  const [row] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.householdId, householdId)));
  return !!row;
}

export async function createMember(db: Db, householdId: string, input: MemberInput): Promise<string> {
  const errors = validateMemberInput(input, await otherMemberNames(db, householdId));
  if (Object.keys(errors).length) throw new SettingsValidationError(errors);
  const [row] = await db.insert(users).values({ householdId, name: input.name.trim() }).returning({ id: users.id });
  return row!.id;
}

export async function updateMember(db: Db, householdId: string, id: string, input: MemberInput): Promise<void> {
  await findMember(db, householdId, id);
  const errors = validateMemberInput(input, await otherMemberNames(db, householdId, id));
  if (Object.keys(errors).length) throw new SettingsValidationError(errors);
  await db.update(users).set({ name: input.name.trim() }).where(and(eq(users.id, id), eq(users.householdId, householdId)));
}

/**
 * Usuwa osobę z listy. Jej operacje i płatności zostają jako wspólne (klucz obcy `ON DELETE SET NULL`).
 * Ostatniej osoby nie usuwamy — gospodarstwo zawsze ma co najmniej jednego domownika.
 */
export async function deleteMember(db: Db, householdId: string, id: string): Promise<void> {
  await findMember(db, householdId, id);
  const all = await db.select({ id: users.id }).from(users).where(eq(users.householdId, householdId));
  if (all.length <= 1) throw new SettingsError(400, 'Musi zostać co najmniej jedna osoba.');
  await db.delete(users).where(and(eq(users.id, id), eq(users.householdId, householdId)));
}
