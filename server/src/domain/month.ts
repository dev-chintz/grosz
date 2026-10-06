// Wspólne zapytania dla widoków miesiąca (Pulpit, Kalendarz).

import { and, asc, eq, gte, lt, lte, ne, sql } from 'drizzle-orm';
import { addMonths, daysInMonth, toIso, type IsoDate } from '@grosz/shared/dates';
import type { Db } from '../db/client.ts';
import { accounts, categories, occurrences, recurringRules, transactions } from '../db/schema.ts';
import { ensureOccurrences } from './rules.ts';

/** Ile miesięcy do przodu trzymamy wygenerowane terminy. */
const HORIZON_MONTHS = 3;

export const signed = (direction: 'expense' | 'income', amount: number) => (direction === 'income' ? amount : -amount);

/** Dopilnowuje, żeby terminy cykliczne były wygenerowane do HORIZON_MONTHS za oglądanym miesiącem. */
export async function ensureHorizon(db: Db, householdId: string, year: number, month: number): Promise<void> {
  const horizon = addMonths(year, month, HORIZON_MONTHS);
  await ensureOccurrences(db, householdId, toIso(horizon.year, horizon.month, daysInMonth(horizon.year, horizon.month)));
}

/** Terminy cykliczne (bez pominiętych) i operacje jednorazowe z zakresu [from, to]. */
export async function loadRange(db: Db, householdId: string, from: IsoDate, to: IsoDate) {
  const [occurrenceRows, transactionRows] = await Promise.all([
    db
      .select({ occurrence: occurrences, rule: recurringRules, category: categories.name })
      .from(occurrences)
      .innerJoin(recurringRules, eq(occurrences.ruleId, recurringRules.id))
      .leftJoin(categories, eq(recurringRules.categoryId, categories.id))
      .where(
        and(
          eq(occurrences.householdId, householdId),
          ne(occurrences.status, 'skipped'),
          gte(occurrences.dueDate, from),
          lte(occurrences.dueDate, to),
        ),
      )
      .orderBy(asc(occurrences.dueDate), asc(recurringRules.name)),
    db
      .select({ tx: transactions, category: categories.name })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(and(eq(transactions.householdId, householdId), gte(transactions.date, from), lte(transactions.date, to)))
      .orderBy(asc(transactions.date), asc(transactions.createdAt)),
  ]);
  return { occurrences: occurrenceRows, transactions: transactionRows };
}

/** Saldo na początek dnia `date`: salda otwarcia kont + wszystkie przepływy od otwarcia do dnia poprzedniego. */
export async function balanceBefore(db: Db, householdId: string, date: IsoDate): Promise<number> {
  const [opening] = await db
    .select({
      total: sql<number>`coalesce(sum(${accounts.openingBalance}), 0)::int`,
      since: sql<IsoDate | null>`min(${accounts.openingDate})::text`,
    })
    .from(accounts)
    // Saldo otwarcia obowiązuje na początek `opening_date`, więc konto otwarte dokładnie w `date` też się liczy.
    .where(and(eq(accounts.householdId, householdId), eq(accounts.archived, false), lte(accounts.openingDate, date)));
  if (!opening?.since) return 0;

  const [recurring] = await db
    .select({
      total: sql<number>`coalesce(sum(case when ${recurringRules.direction} = 'income' then 1 else -1 end * coalesce(${occurrences.actualAmount}, ${occurrences.plannedAmount})), 0)::int`,
    })
    .from(occurrences)
    .innerJoin(recurringRules, eq(occurrences.ruleId, recurringRules.id))
    .where(
      and(
        eq(occurrences.householdId, householdId),
        ne(occurrences.status, 'skipped'),
        gte(occurrences.dueDate, opening.since),
        lt(occurrences.dueDate, date),
      ),
    );

  const [oneOff] = await db
    .select({
      total: sql<number>`coalesce(sum(case when ${transactions.direction} = 'income' then 1 else -1 end * ${transactions.amount}), 0)::int`,
    })
    .from(transactions)
    .where(and(eq(transactions.householdId, householdId), gte(transactions.date, opening.since), lt(transactions.date, date)));

  return opening.total + (recurring?.total ?? 0) + (oneOff?.total ?? 0);
}
