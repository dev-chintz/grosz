import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm';
import type { OptionsResponse, RecurringListResponse, RecurringRuleDto, SaveRuleRequest } from '@grosz/shared/api';
import { addMonths, daysInMonth, monthStart, toIso, type IsoDate } from '@grosz/shared/dates';
import { describeFrequency } from '@grosz/shared/labels';
import { amountAt } from '@grosz/shared/recurrence';
import { monthlyEquivalent, summarizeSchedule, toRecurrenceRule, validateRuleInput, type RuleInput, type RuleInputErrors } from '@grosz/shared/recurring';
import type { Db } from '../db/client.ts';
import { accounts, categories, occurrences, recurringRules, ruleAmountVersions, users } from '../db/schema.ts';
import { ensureOccurrences, settleAutoBooked } from './rules.ts';
import { findForeignReferences } from './household.ts';

type RuleRow = typeof recurringRules.$inferSelect;

export class ValidationError extends Error {
  readonly statusCode = 400;
  readonly errors: RuleInputErrors;
  constructor(errors: RuleInputErrors) {
    super('Popraw zaznaczone pola.');
    this.errors = errors;
  }
}

export class NotFoundError extends Error {
  readonly statusCode = 404;
  constructor() {
    super('Nie znaleziono wydatku cyklicznego.');
  }
}

const horizon = (today: IsoDate) => {
  const { year, month } = addMonths(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 3);
  return toIso(year, month, daysInMonth(year, month));
};

const later = (a: IsoDate, b: IsoDate) => (a > b ? a : b);

function toInput(row: RuleRow, amount: number): RuleInput {
  return {
    name: row.name,
    direction: row.direction,
    categoryId: row.categoryId,
    accountId: row.accountId,
    userId: row.userId,
    payee: row.payee,
    amount,
    variableAmount: row.variableAmount,
    unit: row.unit,
    interval: row.interval,
    startDate: row.startDate,
    dayOfMonth: row.dayOfMonth,
    lastDayOfMonth: row.lastDayOfMonth,
    weekendRule: row.weekendRule,
    endType: row.endType,
    endDate: row.endDate,
    endCount: row.endCount,
    remindDaysBefore: row.remindDaysBefore,
    autoBook: row.autoBook,
    note: row.note,
  };
}

/** Kolumny reguły z danych formularza (bez householdId/trackFrom/statusu). */
function toColumns(input: RuleInput) {
  const monthly = input.unit === 'month' || input.unit === 'year';
  return {
    name: input.name.trim(),
    direction: input.direction,
    categoryId: input.categoryId,
    accountId: input.accountId,
    userId: input.userId,
    payee: input.payee?.trim() || null,
    variableAmount: input.variableAmount,
    unit: input.unit,
    interval: input.interval,
    startDate: input.startDate,
    dayOfMonth: monthly && !input.lastDayOfMonth ? input.dayOfMonth : null,
    lastDayOfMonth: monthly && input.lastDayOfMonth,
    weekendRule: input.weekendRule,
    endType: input.endType,
    endDate: input.endType === 'until' ? input.endDate : null,
    endCount: input.endType === 'count' ? input.endCount : null,
    remindDaysBefore: input.remindDaysBefore,
    autoBook: input.autoBook,
    note: input.note?.trim() || null,
  };
}

function validate(input: RuleInput) {
  const errors = validateRuleInput(input);
  if (Object.keys(errors).length) throw new ValidationError(errors);
}

/** Kategoria, konto i osoba z formularza muszą należeć do tego gospodarstwa. */
async function validateReferences(db: Db, householdId: string, input: RuleInput) {
  const errors = await findForeignReferences(db, householdId, input);
  if (Object.keys(errors).length) throw new ValidationError(errors);
}

export async function listRules(db: Db, householdId: string, today: IsoDate): Promise<RecurringListResponse> {
  await settleAutoBooked(db, householdId, today);
  const rows = await db
    .select({ rule: recurringRules, categoryName: categories.name })
    .from(recurringRules)
    .leftJoin(categories, eq(recurringRules.categoryId, categories.id))
    .where(eq(recurringRules.householdId, householdId))
    .orderBy(asc(recurringRules.name));

  const versions = rows.length
    ? await db
        .select()
        .from(ruleAmountVersions)
        .where(inArray(ruleAmountVersions.ruleId, rows.map((r) => r.rule.id)))
        .orderBy(desc(ruleAmountVersions.effectiveFrom))
    : [];

  const rules: RecurringRuleDto[] = rows.map(({ rule, categoryName }) => {
    const history = versions.filter((v) => v.ruleId === rule.id).map((v) => ({ effectiveFrom: v.effectiveFrom, amount: v.amount }));
    // Kwota „aktualna”: obowiązująca dziś, a dla reguł z przyszłości — pierwsza zaplanowana.
    const amount = amountAt(history, today) ?? history.at(-1)?.amount ?? 0;
    const recurrence = toRecurrenceRule(toInput(rule, amount));
    const schedule = summarizeSchedule(recurrence, today);
    if (rule.status === 'paused') schedule.next = null;
    return {
      ...toInput(rule, amount),
      id: rule.id,
      status: rule.status,
      pausedFrom: rule.pausedFrom,
      categoryName,
      frequencyLabel: describeFrequency(recurrence),
      monthlyAmount: monthlyEquivalent(amount, rule.unit, rule.interval),
      amountHistory: history,
      schedule,
    };
  });

  // Najpierw aktywne według najbliższego terminu, wstrzymane i zakończone na końcu.
  const order = (r: RecurringRuleDto) => (r.status === 'paused' ? '2' : r.schedule.next ? '0' + r.schedule.next.dueDate : '1');
  rules.sort((a, b) => order(a).localeCompare(order(b)));

  const monthlyExpenses = rules
    .filter((r) => r.direction === 'expense' && r.status === 'active' && r.schedule.next)
    .reduce((sum, r) => sum + r.monthlyAmount, 0);

  return { today, rules, monthlyExpenses };
}

export async function listOptions(db: Db, householdId: string): Promise<OptionsResponse> {
  const [categoryRows, accountRows, memberRows] = await Promise.all([
    db
      .select({ id: categories.id, name: categories.name, direction: categories.direction })
      .from(categories)
      .where(eq(categories.householdId, householdId))
      .orderBy(asc(categories.direction), asc(categories.sortOrder), asc(categories.name)),
    db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.householdId, householdId), eq(accounts.archived, false)))
      .orderBy(asc(accounts.name)),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.householdId, householdId)).orderBy(asc(users.name)),
  ]);
  return { categories: categoryRows, accounts: accountRows, members: memberRows };
}

async function findRule(db: Db, householdId: string, id: string): Promise<RuleRow> {
  const [rule] = await db
    .select()
    .from(recurringRules)
    .where(and(eq(recurringRules.id, id), eq(recurringRules.householdId, householdId)));
  if (!rule) throw new NotFoundError();
  return rule;
}

export async function createRule(db: Db, householdId: string, input: RuleInput, today: IsoDate): Promise<string> {
  validate(input);
  await validateReferences(db, householdId, input);
  const id = await db.transaction(async (tx) => {
    const [rule] = await tx
      .insert(recurringRules)
      .values({
        ...toColumns(input),
        householdId,
        // Reguła założona dziś dla kredytu sprzed lat: śledzimy terminy od bieżącego miesiąca,
        // a numery rat i tak liczą się od prawdziwej pierwszej płatności.
        trackFrom: later(input.startDate, monthStart(today)),
      })
      .returning({ id: recurringRules.id });
    await tx.insert(ruleAmountVersions).values({ ruleId: rule!.id, effectiveFrom: input.startDate, amount: input.amount });
    return rule!.id;
  });
  await ensureOccurrences(db, householdId, horizon(today));
  return id;
}

/**
 * Zmiana obowiązuje od `applyFrom`: nieopłacone terminy od tej daty są generowane od nowa,
 * opłacone i wcześniejsze zostają. Zmiana kwoty dopisuje wersję kwoty od `applyFrom`.
 */
export async function updateRule(db: Db, householdId: string, id: string, request: SaveRuleRequest, today: IsoDate): Promise<void> {
  const { applyFrom = today, ...input } = request;
  validate(input);
  await validateReferences(db, householdId, input);
  await findRule(db, householdId, id);

  await db.transaction(async (tx) => {
    await tx
      .update(recurringRules)
      .set({ ...toColumns(input), updatedAt: new Date() })
      .where(eq(recurringRules.id, id));

    const versions = await tx.select().from(ruleAmountVersions).where(eq(ruleAmountVersions.ruleId, id));
    if (amountAt(versions, applyFrom) !== input.amount) {
      await tx
        .insert(ruleAmountVersions)
        .values({ ruleId: id, effectiveFrom: applyFrom, amount: input.amount })
        .onConflictDoUpdate({ target: [ruleAmountVersions.ruleId, ruleAmountVersions.effectiveFrom], set: { amount: input.amount } });
    }

    await tx
      .delete(occurrences)
      .where(and(eq(occurrences.ruleId, id), eq(occurrences.status, 'planned'), gte(occurrences.dueDate, applyFrom)));
  });
  await ensureOccurrences(db, householdId, horizon(today));
}

export async function pauseRule(db: Db, householdId: string, id: string, today: IsoDate): Promise<void> {
  await findRule(db, householdId, id);
  await db.transaction(async (tx) => {
    await tx.update(recurringRules).set({ status: 'paused', pausedFrom: today, updatedAt: new Date() }).where(eq(recurringRules.id, id));
    await tx
      .delete(occurrences)
      .where(and(eq(occurrences.ruleId, id), eq(occurrences.status, 'planned'), gte(occurrences.dueDate, today)));
  });
}

export async function resumeRule(db: Db, householdId: string, id: string, today: IsoDate): Promise<void> {
  const rule = await findRule(db, householdId, id);
  // Terminy z okresu wstrzymania nie wracają — śledzenie zaczyna się od dziś.
  await db
    .update(recurringRules)
    .set({ status: 'active', pausedFrom: null, trackFrom: later(rule.trackFrom, today), updatedAt: new Date() })
    .where(eq(recurringRules.id, id));
  await ensureOccurrences(db, householdId, horizon(today));
}

/** Usuwa regułę razem z historią jej płatności. */
export async function deleteRule(db: Db, householdId: string, id: string): Promise<void> {
  await findRule(db, householdId, id);
  await db.delete(recurringRules).where(eq(recurringRules.id, id));
}
