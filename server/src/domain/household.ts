import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { accounts, categories, households, users } from '../db/schema.ts';

/**
 * Na razie aplikacja ma jedno gospodarstwo i nie ma logowania, więc bierzemy pierwsze.
 * Gdy dojdą konta użytkowników, ta funkcja zacznie czytać gospodarstwo z sesji —
 * reszta kodu już filtruje po householdId i nie będzie wymagała zmian.
 */
export async function currentHouseholdId(db: Db): Promise<string | null> {
  const [first] = await db.select({ id: households.id }).from(households).orderBy(asc(households.createdAt)).limit(1);
  return first?.id ?? null;
}

export interface ReferenceErrors {
  categoryId?: string;
  accountId?: string;
  userId?: string;
}

const exists = async (query: PromiseLike<unknown[]>) => (await query).length > 0;

/**
 * Sprawdza, że kategoria, konto i osoba z żądania należą do tego gospodarstwa (nie do cudzego ani nieistniejące).
 * Bez tego dałoby się zapisać operację z odwołaniem do danych innego gospodarstwa. Zwraca błędy per pole; pusty obiekt = w porządku.
 * Nie sprawdza, czy konto jest zarchiwizowane — edycja starej operacji z zarchiwizowanym kontem musi nadal się zapisywać.
 */
export async function findForeignReferences(
  db: Db,
  householdId: string,
  refs: { categoryId: string | null; accountId: string | null; userId: string | null },
): Promise<ReferenceErrors> {
  const errors: ReferenceErrors = {};
  if (refs.categoryId && !(await exists(db.select({ id: categories.id }).from(categories).where(and(eq(categories.id, refs.categoryId), eq(categories.householdId, householdId)))))) {
    errors.categoryId = 'Nie ma takiej kategorii.';
  }
  if (refs.accountId && !(await exists(db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, refs.accountId), eq(accounts.householdId, householdId)))))) {
    errors.accountId = 'Nie ma takiego konta.';
  }
  if (refs.userId && !(await exists(db.select({ id: users.id }).from(users).where(and(eq(users.id, refs.userId), eq(users.householdId, householdId)))))) {
    errors.userId = 'Nie ma takiej osoby.';
  }
  return errors;
}
