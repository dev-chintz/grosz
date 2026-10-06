import { and, asc, eq, gte, lte, ne, type SQL } from 'drizzle-orm';
import type { LedgerItem } from '@grosz/shared/api';
import type { IsoDate } from '@grosz/shared/dates';
import { BACKUP_VERSION, type BackupFile } from '@grosz/shared/export';
import type { Db } from '../db/client.ts';
import { accounts, categories, households, occurrences, recurringRules, ruleAmountVersions, transactions, users } from '../db/schema.ts';
import { buildLedgerItems } from './transactions.ts';

const withoutHousehold = <T extends { householdId: string }>({ householdId: _omitted, ...rest }: T) => rest;

/** Pełna kopia danych gospodarstwa. Tylko odczyt — nic nie jest generowane ani zmieniane. */
export async function buildBackup(db: Db, householdId: string, now: Date): Promise<BackupFile> {
  const [household] = await db.select().from(households).where(eq(households.id, householdId));
  if (!household) throw Object.assign(new Error('Nie znaleziono gospodarstwa.'), { statusCode: 404 });

  const [accountRows, userRows, categoryRows, ruleRows, versionRows, occurrenceRows, transactionRows] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.householdId, householdId)).orderBy(asc(accounts.name)),
    db.select().from(users).where(eq(users.householdId, householdId)).orderBy(asc(users.name)),
    db.select().from(categories).where(eq(categories.householdId, householdId)).orderBy(asc(categories.direction), asc(categories.sortOrder)),
    db.select().from(recurringRules).where(eq(recurringRules.householdId, householdId)).orderBy(asc(recurringRules.name)),
    db
      .select({ version: ruleAmountVersions })
      .from(ruleAmountVersions)
      .innerJoin(recurringRules, eq(ruleAmountVersions.ruleId, recurringRules.id))
      .where(eq(recurringRules.householdId, householdId))
      .orderBy(asc(ruleAmountVersions.ruleId), asc(ruleAmountVersions.effectiveFrom)),
    db.select().from(occurrences).where(eq(occurrences.householdId, householdId)).orderBy(asc(occurrences.dueDate), asc(occurrences.index)),
    db.select().from(transactions).where(eq(transactions.householdId, householdId)).orderBy(asc(transactions.date), asc(transactions.createdAt)),
  ]);

  return {
    app: 'grosz',
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    household: { name: household.name, currency: household.currency },
    accounts: accountRows.map(withoutHousehold),
    users: userRows.map(withoutHousehold),
    categories: categoryRows.map(withoutHousehold),
    recurringRules: ruleRows.map(withoutHousehold),
    amountVersions: versionRows.map((r) => r.version),
    occurrences: occurrenceRows.map(withoutHousehold),
    transactions: transactionRows.map(withoutHousehold),
  };
}

/**
 * Operacje do CSV: terminy cykliczne (bez pominiętych) i operacje jednorazowe z zakresu dat; brak granicy = bez ograniczenia.
 * Zaplanowane terminy są tylko te, które aplikacja już wygenerowała (kilka miesięcy do przodu) — eksport niczego nie generuje.
 */
export async function exportLedger(db: Db, householdId: string, range: { from: IsoDate | null; to: IsoDate | null }, today: IsoDate): Promise<LedgerItem[]> {
  const occurrenceFilters: SQL[] = [eq(occurrences.householdId, householdId), ne(occurrences.status, 'skipped')];
  const transactionFilters: SQL[] = [eq(transactions.householdId, householdId)];
  if (range.from) {
    occurrenceFilters.push(gte(occurrences.dueDate, range.from));
    transactionFilters.push(gte(transactions.date, range.from));
  }
  if (range.to) {
    occurrenceFilters.push(lte(occurrences.dueDate, range.to));
    transactionFilters.push(lte(transactions.date, range.to));
  }

  const [occurrenceRows, transactionRows] = await Promise.all([
    db
      .select({ occurrence: occurrences, rule: recurringRules, categoryName: categories.name, accountName: accounts.name, userName: users.name })
      .from(occurrences)
      .innerJoin(recurringRules, eq(occurrences.ruleId, recurringRules.id))
      .leftJoin(categories, eq(recurringRules.categoryId, categories.id))
      .leftJoin(accounts, eq(recurringRules.accountId, accounts.id))
      .leftJoin(users, eq(recurringRules.userId, users.id))
      .where(and(...occurrenceFilters)),
    db
      .select({ tx: transactions, categoryName: categories.name, accountName: accounts.name, userName: users.name })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .leftJoin(accounts, eq(transactions.accountId, accounts.id))
      .leftJoin(users, eq(transactions.userId, users.id))
      .where(and(...transactionFilters)),
  ]);
  return buildLedgerItems(occurrenceRows, transactionRows, today);
}
