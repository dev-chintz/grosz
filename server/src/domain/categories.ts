import { and, asc, count, eq, inArray, max } from 'drizzle-orm';
import type { CategoriesResponse, CategoryDto } from '@grosz/shared/api';
import { limitState, validateCategoryInput, type CategoryInput, type CategoryInputErrors } from '@grosz/shared/categories';
import { addMonths, daysInMonth, toIso, type IsoDate } from '@grosz/shared/dates';
import type { Db } from '../db/client.ts';
import { categories, recurringRules, transactions } from '../db/schema.ts';
import { ensureHorizon, loadRange } from './month.ts';

export class CategoryValidationError extends Error {
  readonly statusCode = 400;
  readonly errors: CategoryInputErrors;
  constructor(errors: CategoryInputErrors) {
    super('Popraw zaznaczone pola.');
    this.errors = errors;
  }
}

class CategoryError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

const HISTORY_MONTHS = 3;
const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

export async function listCategories(db: Db, householdId: string, month: string, today: IsoDate): Promise<CategoriesResponse> {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const first = addMonths(year, monthNumber, -HISTORY_MONTHS);
  const from = toIso(first.year, first.month, 1);
  const to = toIso(year, monthNumber, daysInMonth(year, monthNumber));
  const previousMonths = Array.from({ length: HISTORY_MONTHS }, (_, i) => {
    const m = addMonths(first.year, first.month, i);
    return monthKey(m.year, m.month);
  });

  await ensureHorizon(db, householdId, year, monthNumber);
  const [rows, range, ruleCounts, transactionCounts] = await Promise.all([
    db.select().from(categories).where(eq(categories.householdId, householdId)).orderBy(asc(categories.direction), asc(categories.sortOrder), asc(categories.name)),
    loadRange(db, householdId, from, to),
    db
      .select({ categoryId: recurringRules.categoryId, n: count() })
      .from(recurringRules)
      .where(eq(recurringRules.householdId, householdId))
      .groupBy(recurringRules.categoryId),
    db
      .select({ categoryId: transactions.categoryId, n: count() })
      .from(transactions)
      .where(eq(transactions.householdId, householdId))
      .groupBy(transactions.categoryId),
  ]);

  // Sumy per (kategoria, miesiąc); kierunek operacji musi zgadzać się z kierunkiem kategorii.
  const totals = new Map<string, number>();
  const done = new Map<string, number>();
  const uncategorized = { expense: 0, income: 0 };
  const add = (categoryId: string | null, direction: 'expense' | 'income', date: IsoDate, amount: number, happened: boolean) => {
    const key = date.slice(0, 7);
    if (!categoryId) {
      if (key === month) uncategorized[direction] += amount;
      return;
    }
    const id = `${categoryId}|${direction}|${key}`;
    totals.set(id, (totals.get(id) ?? 0) + amount);
    if (happened) done.set(id, (done.get(id) ?? 0) + amount);
  };
  for (const { occurrence, rule } of range.occurrences) {
    add(rule.categoryId, rule.direction, occurrence.dueDate, occurrence.actualAmount ?? occurrence.plannedAmount, occurrence.status === 'paid');
  }
  for (const { tx } of range.transactions) add(tx.categoryId, tx.direction, tx.date, tx.amount, tx.date <= today);

  const result: CategoryDto[] = rows.map((c) => {
    const get = (map: Map<string, number>, m: string) => map.get(`${c.id}|${c.direction}|${m}`) ?? 0;
    const history = previousMonths.map((m) => ({ month: m, total: get(totals, m) }));
    const total = get(totals, month);
    const limit = c.direction === 'expense' ? c.monthlyLimit : null;
    return {
      id: c.id,
      name: c.name,
      direction: c.direction,
      sortOrder: c.sortOrder,
      monthlyLimit: limit,
      total,
      done: get(done, month),
      average: Math.round(history.reduce((s, h) => s + h.total, 0) / HISTORY_MONTHS),
      history,
      rulesCount: ruleCounts.find((r) => r.categoryId === c.id)?.n ?? 0,
      transactionsCount: transactionCounts.find((r) => r.categoryId === c.id)?.n ?? 0,
      limitState: limitState(total, limit),
    };
  });

  return { month, today, categories: result, uncategorized };
}

async function namesInGroup(db: Db, householdId: string, direction: 'expense' | 'income', exceptId?: string) {
  const rows = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(and(eq(categories.householdId, householdId), eq(categories.direction, direction)));
  return rows.filter((r) => r.id !== exceptId).map((r) => r.name);
}

function validate(input: CategoryInput, existing: string[]) {
  const errors = validateCategoryInput(input, existing);
  if (Object.keys(errors).length) throw new CategoryValidationError(errors);
}

async function findCategory(db: Db, householdId: string, id: string) {
  const [row] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.householdId, householdId)));
  if (!row) throw new CategoryError(404, 'Nie znaleziono kategorii.');
  return row;
}

export async function createCategory(db: Db, householdId: string, input: CategoryInput): Promise<string> {
  validate(input, await namesInGroup(db, householdId, input.direction));
  const [last] = await db
    .select({ value: max(categories.sortOrder) })
    .from(categories)
    .where(and(eq(categories.householdId, householdId), eq(categories.direction, input.direction)));
  const [row] = await db
    .insert(categories)
    .values({
      householdId,
      name: input.name.trim(),
      direction: input.direction,
      monthlyLimit: input.direction === 'expense' ? input.monthlyLimit : null,
      sortOrder: (last?.value ?? -1) + 1,
    })
    .returning({ id: categories.id });
  return row!.id;
}

/** Zmiana nazwy i limitu. Kierunku nie zmieniamy — wydatki przypisane do kategorii straciłyby sens. */
export async function updateCategory(db: Db, householdId: string, id: string, input: Omit<CategoryInput, 'direction'>): Promise<void> {
  const current = await findCategory(db, householdId, id);
  const full = { ...input, direction: current.direction };
  validate(full, await namesInGroup(db, householdId, current.direction, id));
  await db
    .update(categories)
    .set({ name: input.name.trim(), monthlyLimit: current.direction === 'expense' ? input.monthlyLimit : null })
    .where(eq(categories.id, id));
}

/** Nowa kolejność kategorii jednej grupy (wydatki albo wpływy). */
export async function reorderCategories(db: Db, householdId: string, ids: string[]): Promise<void> {
  const rows = await db
    .select({ id: categories.id, direction: categories.direction })
    .from(categories)
    .where(and(eq(categories.householdId, householdId), inArray(categories.id, ids)));
  if (rows.length !== ids.length || new Set(rows.map((r) => r.direction)).size !== 1) {
    throw new CategoryError(400, 'Nieprawidłowa lista kategorii.');
  }
  await db.transaction(async (tx) => {
    for (const [index, id] of ids.entries()) await tx.update(categories).set({ sortOrder: index }).where(eq(categories.id, id));
  });
}

/**
 * Usuwa kategorię. Płatności cykliczne i operacje z tej kategorii przechodzą do `moveTo`
 * (kategoria tego samego rodzaju) albo zostają bez kategorii, gdy `moveTo` = null.
 */
export async function deleteCategory(db: Db, householdId: string, id: string, moveTo: string | null): Promise<void> {
  const current = await findCategory(db, householdId, id);
  if (moveTo) {
    if (moveTo === id) throw new CategoryError(400, 'Nie można przenieść do usuwanej kategorii.');
    const target = await findCategory(db, householdId, moveTo);
    if (target.direction !== current.direction) throw new CategoryError(400, 'Kategoria docelowa musi być tego samego rodzaju.');
  }
  await db.transaction(async (tx) => {
    await tx.update(recurringRules).set({ categoryId: moveTo }).where(and(eq(recurringRules.categoryId, id), eq(recurringRules.householdId, householdId)));
    await tx.update(transactions).set({ categoryId: moveTo }).where(and(eq(transactions.categoryId, id), eq(transactions.householdId, householdId)));
    await tx.delete(categories).where(eq(categories.id, id));
  });
}

