import { and, desc, eq, gte, ilike, lte, ne, or, type SQL } from 'drizzle-orm';
import type { LedgerItem, LedgerStatus, TransactionsResponse } from '@grosz/shared/api';
import { daysInMonth, toIso, type IsoDate } from '@grosz/shared/dates';
import { validateTransactionInput, type TransactionInput, type TransactionInputErrors } from '@grosz/shared/transactions';
import type { Db } from '../db/client.ts';
import { accounts, categories, occurrences, recurringRules, transactions } from '../db/schema.ts';
import { ensureHorizon } from './month.ts';

/** Tyle wyników zwraca wyszukiwanie w całej historii. */
const SEARCH_LIMIT = 200;

export class TransactionValidationError extends Error {
  readonly statusCode = 400;
  readonly errors: TransactionInputErrors;
  constructor(errors: TransactionInputErrors) {
    super('Popraw zaznaczone pola.');
    this.errors = errors;
  }
}

class TransactionNotFoundError extends Error {
  readonly statusCode = 404;
  constructor() {
    super('Nie znaleziono operacji.');
  }
}

/** Znaki specjalne LIKE traktujemy dosłownie — „50%” ma szukać „50%”, a nie wszystkiego. */
const likePattern = (query: string) => `%${query.replace(/[\\%_]/g, (c) => '\\' + c)}%`;

type OccurrenceRow = { occurrence: typeof occurrences.$inferSelect; rule: typeof recurringRules.$inferSelect; categoryName: string | null; accountName: string | null };
type TransactionRow = { tx: typeof transactions.$inferSelect; categoryName: string | null; accountName: string | null };

/** Łączy terminy cykliczne i operacje jednorazowe w jedną listę (od najnowszych) ze statusami względem `today`. */
export function buildLedgerItems(occurrenceRows: OccurrenceRow[], transactionRows: TransactionRow[], today: IsoDate): LedgerItem[] {
  return [
    ...transactionRows.map(({ tx, categoryName, accountName }): LedgerItem => ({
      kind: 'oneoff',
      id: tx.id,
      ruleId: null,
      date: tx.date,
      name: tx.description,
      direction: tx.direction,
      amount: tx.amount,
      plannedAmount: null,
      variableAmount: false,
      categoryId: tx.categoryId,
      categoryName,
      accountId: tx.accountId,
      accountName,
      note: tx.note,
      status: tx.date <= today ? 'done' : 'planned',
    })),
    ...occurrenceRows.map(({ occurrence, rule, categoryName, accountName }): LedgerItem => {
      const status: LedgerStatus = occurrence.status === 'paid' ? 'done' : occurrence.dueDate < today ? 'overdue' : 'planned';
      const actual = occurrence.actualAmount;
      return {
        kind: 'recurring',
        id: occurrence.id,
        ruleId: rule.id,
        date: occurrence.dueDate,
        name: rule.name,
        direction: rule.direction,
        amount: actual ?? occurrence.plannedAmount,
        plannedAmount: actual !== null && actual !== occurrence.plannedAmount ? occurrence.plannedAmount : null,
        variableAmount: rule.variableAmount,
        categoryId: rule.categoryId,
        categoryName,
        accountId: rule.accountId,
        accountName,
        note: null,
        status,
      };
    }),
  ].sort((a, b) => (a.date === b.date ? (a.direction === b.direction ? 0 : a.direction === 'income' ? -1 : 1) : a.date < b.date ? 1 : -1));
}

export async function listLedger(
  db: Db,
  householdId: string,
  params: { month: string | null; query: string | null },
  today: IsoDate,
): Promise<TransactionsResponse> {
  const query = params.query?.trim() || null;
  const month = query ? null : (params.month ?? today.slice(0, 7));

  let range: { from: IsoDate; to: IsoDate } | null = null;
  if (month) {
    const [year, monthNumber] = month.split('-').map(Number) as [number, number];
    range = { from: toIso(year, monthNumber, 1), to: toIso(year, monthNumber, daysInMonth(year, monthNumber)) };
    await ensureHorizon(db, householdId, year, monthNumber);
  }

  const occurrenceFilters: SQL[] = [eq(occurrences.householdId, householdId), ne(occurrences.status, 'skipped')];
  const transactionFilters: SQL[] = [eq(transactions.householdId, householdId)];
  if (range) {
    occurrenceFilters.push(gte(occurrences.dueDate, range.from), lte(occurrences.dueDate, range.to));
    transactionFilters.push(gte(transactions.date, range.from), lte(transactions.date, range.to));
  }
  if (query) {
    const pattern = likePattern(query);
    occurrenceFilters.push(or(ilike(recurringRules.name, pattern), ilike(categories.name, pattern))!);
    transactionFilters.push(or(ilike(transactions.description, pattern), ilike(transactions.note, pattern), ilike(categories.name, pattern))!);
  }
  const limit = query ? SEARCH_LIMIT + 1 : 10_000;

  const [occurrenceRows, transactionRows] = await Promise.all([
    db
      .select({ occurrence: occurrences, rule: recurringRules, categoryName: categories.name, accountName: accounts.name })
      .from(occurrences)
      .innerJoin(recurringRules, eq(occurrences.ruleId, recurringRules.id))
      .leftJoin(categories, eq(recurringRules.categoryId, categories.id))
      .leftJoin(accounts, eq(recurringRules.accountId, accounts.id))
      .where(and(...occurrenceFilters))
      .orderBy(desc(occurrences.dueDate))
      .limit(limit),
    db
      .select({ tx: transactions, categoryName: categories.name, accountName: accounts.name })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .leftJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(and(...transactionFilters))
      .orderBy(desc(transactions.date), desc(transactions.createdAt))
      .limit(limit),
  ]);

  const items = buildLedgerItems(occurrenceRows, transactionRows, today);

  const limited = query !== null && items.length > SEARCH_LIMIT;
  const shown = limited ? items.slice(0, SEARCH_LIMIT) : items;
  const sum = (direction: 'income' | 'expense') => shown.filter((i) => i.direction === direction).reduce((acc, i) => acc + i.amount, 0);

  return { today, month, query, items: shown, limited, totals: { income: sum('income'), expense: sum('expense') } };
}

function columns(input: TransactionInput) {
  return {
    direction: input.direction,
    amount: input.amount,
    date: input.date,
    description: input.description.trim(),
    categoryId: input.categoryId,
    accountId: input.accountId,
    note: input.note?.trim() || null,
  };
}

function validate(input: TransactionInput) {
  const errors = validateTransactionInput(input);
  if (Object.keys(errors).length) throw new TransactionValidationError(errors);
}

export async function createTransaction(db: Db, householdId: string, input: TransactionInput): Promise<string> {
  validate(input);
  const [row] = await db
    .insert(transactions)
    .values({ ...columns(input), householdId })
    .returning({ id: transactions.id });
  return row!.id;
}

export async function updateTransaction(db: Db, householdId: string, id: string, input: TransactionInput): Promise<void> {
  validate(input);
  const updated = await db
    .update(transactions)
    .set(columns(input))
    .where(and(eq(transactions.id, id), eq(transactions.householdId, householdId)))
    .returning({ id: transactions.id });
  if (updated.length === 0) throw new TransactionNotFoundError();
}

export async function deleteTransaction(db: Db, householdId: string, id: string): Promise<void> {
  const deleted = await db
    .delete(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.householdId, householdId)))
    .returning({ id: transactions.id });
  if (deleted.length === 0) throw new TransactionNotFoundError();
}
