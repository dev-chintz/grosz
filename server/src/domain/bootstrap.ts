import { type IsoDate } from '@grosz/shared/dates';
import type { Db } from '../db/client.ts';
import { accounts, categories, households, users } from '../db/schema.ts';
import { currentHouseholdId } from './household.ts';

/** Domyślne kategorie nowego budżetu — te same trafiają do seedu z danymi przykładowymi. */
export const DEFAULT_CATEGORIES = {
  expense: ['Mieszkanie', 'Transport', 'Jedzenie', 'Raty', 'Abonamenty', 'Prezenty', 'Sport i zdrowie'],
  income: ['Wynagrodzenie', 'Dodatkowe'],
} as const;

/**
 * Zakłada pusty budżet na świeżej bazie: gospodarstwo, osobę „Ja”, konto „Konto główne” (saldo 0 na dziś)
 * i domyślne kategorie. Bez tego na pustej bazie każdy ekran zwraca 409 „Brak gospodarstwa”.
 * Gdy gospodarstwo już istnieje, nic nie zmienia i zwraca false.
 */
export async function bootstrapBudget(db: Db, today: IsoDate): Promise<boolean> {
  if (await currentHouseholdId(db)) return false;
  await db.transaction(async (tx) => {
    const [household] = await tx.insert(households).values({ name: 'Budżet domowy' }).returning({ id: households.id });
    const householdId = household!.id;
    await tx.insert(users).values({ householdId, name: 'Ja' });
    await tx.insert(accounts).values({ householdId, name: 'Konto główne', openingBalance: 0, openingDate: today });
    await tx.insert(categories).values([
      ...DEFAULT_CATEGORIES.expense.map((name, i) => ({ householdId, name, direction: 'expense' as const, sortOrder: i })),
      ...DEFAULT_CATEGORIES.income.map((name, i) => ({ householdId, name, direction: 'income' as const, sortOrder: i })),
    ]);
  });
  return true;
}
