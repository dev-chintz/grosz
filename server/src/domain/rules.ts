import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { addDays, type IsoDate } from '@grosz/shared/dates';
import { amountAt, occurrencesBetween, type RecurrenceRule } from '@grosz/shared/recurrence';
import type { Db } from '../db/client.ts';
import { occurrences, recurringRules, ruleAmountVersions } from '../db/schema.ts';

type RuleRow = typeof recurringRules.$inferSelect;

export function toRecurrence(rule: RuleRow): RecurrenceRule {
  return {
    unit: rule.unit,
    interval: rule.interval,
    startDate: rule.startDate,
    dayOfMonth: rule.lastDayOfMonth ? 'last' : (rule.dayOfMonth ?? undefined),
    weekendRule: rule.weekendRule,
    end:
      rule.endType === 'count' && rule.endCount
        ? { type: 'count', count: rule.endCount }
        : rule.endType === 'until' && rule.endDate
          ? { type: 'until', date: rule.endDate }
          : { type: 'never' },
  };
}

/**
 * Dopisuje brakujące terminy reguł do `until` (włącznie). Istniejących nie zmienia —
 * opłacone i ręcznie poprawione wystąpienia zostają nietknięte.
 */
export async function ensureOccurrences(db: Db, householdId: string, until: IsoDate): Promise<void> {
  const rules = await db.select().from(recurringRules).where(eq(recurringRules.householdId, householdId));
  if (rules.length === 0) return;

  const versions = await db
    .select()
    .from(ruleAmountVersions)
    .where(inArray(ruleAmountVersions.ruleId, rules.map((r) => r.id)));

  const rows: (typeof occurrences.$inferInsert)[] = [];
  for (const rule of rules) {
    // Wstrzymana reguła nie generuje terminów od dnia wstrzymania.
    const limit = rule.status === 'paused' && rule.pausedFrom ? addDays(rule.pausedFrom, -1) : until;
    if (limit < rule.trackFrom) continue;
    const ruleVersions = versions.filter((v) => v.ruleId === rule.id);
    for (const o of occurrencesBetween(toRecurrence(rule), rule.trackFrom, limit < until ? limit : until)) {
      rows.push({
        householdId,
        ruleId: rule.id,
        index: o.index,
        nominalDate: o.nominalDate,
        dueDate: o.dueDate,
        plannedAmount: amountAt(ruleVersions, o.nominalDate) ?? 0,
      });
    }
  }
  if (rows.length === 0) return;
  await db
    .insert(occurrences)
    .values(rows)
    .onConflictDoNothing({ target: [occurrences.ruleId, occurrences.index] });
}

export async function setOccurrencePaid(
  db: Db,
  householdId: string,
  occurrenceId: string,
  paid: { on: IsoDate; amount?: number } | null,
): Promise<boolean> {
  const updated = await db
    .update(occurrences)
    .set(
      paid
        ? { status: 'paid', paidOn: paid.on, actualAmount: paid.amount ?? null }
        : { status: 'planned', paidOn: null, actualAmount: null },
    )
    .where(and(eq(occurrences.id, occurrenceId), eq(occurrences.householdId, householdId)))
    .returning({ id: occurrences.id });
  return updated.length > 0;
}

/**
 * Księguje automatycznie terminy reguł z włączonym „Księguj automatycznie”: nieopłacone, z datą dzisiejszą lub wcześniejszą;
 * jako dzień zapłaty wpisuje datę terminu, a kwota zostaje planowana. Pomija reguły o zmiennej kwocie — nie wiadomo, ile
 * naprawdę zeszło (np. prąd). Każdy termin jest księgowany raz: znacznik `auto_booked_at` sprawia, że ręcznie cofnięta
 * płatność nie wraca po następnym otwarciu widoku. Idempotentne, więc równoległe zapytania niczego nie psują.
 */
export async function settleAutoBooked(db: Db, householdId: string, today: IsoDate): Promise<void> {
  const autoRules = db
    .select({ id: recurringRules.id })
    .from(recurringRules)
    .where(and(eq(recurringRules.householdId, householdId), eq(recurringRules.autoBook, true), eq(recurringRules.variableAmount, false)));
  await db
    .update(occurrences)
    .set({ status: 'paid', paidOn: sql`${occurrences.dueDate}`, autoBookedAt: new Date() })
    .where(
      and(
        eq(occurrences.householdId, householdId),
        eq(occurrences.status, 'planned'),
        isNull(occurrences.autoBookedAt),
        lte(occurrences.dueDate, today),
        inArray(occurrences.ruleId, autoRules),
      ),
    );
}
