import type { ReportsResponse } from '@grosz/shared/api';
import { daysInMonth, toIso, type IsoDate } from '@grosz/shared/dates';
import { aggregateReport, monthKeys, type ReportItem } from '@grosz/shared/reports';
import type { Db } from '../db/client.ts';
import { ensureHorizon, loadRange } from './month.ts';

/** Wpływy i wydatki z `months` miesięcy kończących się na `endMonth`: opłacone i zaplanowane, tak jak na Pulpicie. */
export async function buildReport(db: Db, householdId: string, endMonth: string, months: number, today: IsoDate): Promise<ReportsResponse> {
  const keys = monthKeys(endMonth, months);
  const [startYear, startMonth] = keys[0]!.split('-').map(Number) as [number, number];
  const [endYear, endMonthNumber] = endMonth.split('-').map(Number) as [number, number];
  const from = toIso(startYear, startMonth, 1);
  const to = toIso(endYear, endMonthNumber, daysInMonth(endYear, endMonthNumber));

  await ensureHorizon(db, householdId, endYear, endMonthNumber);
  const range = await loadRange(db, householdId, from, to);

  const items: ReportItem[] = [
    ...range.occurrences.map(({ occurrence, rule, category }) => ({
      date: occurrence.dueDate,
      direction: rule.direction,
      kind: 'recurring' as const,
      amount: occurrence.actualAmount ?? occurrence.plannedAmount,
      category,
    })),
    ...range.transactions.map(({ tx, category }) => ({
      date: tx.date,
      direction: tx.direction,
      kind: 'oneoff' as const,
      amount: tx.amount,
      category,
    })),
  ];

  return {
    endMonth,
    today,
    ...aggregateReport(items, keys),
    includesPlanned: today <= to,
  };
}
