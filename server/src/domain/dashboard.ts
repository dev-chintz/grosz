import type { CategoryTotal, DashboardResponse, DayEvent, RecentItem, TimelineDay, UpcomingPayment } from '@grosz/shared/api';
import { daysBetween, daysInMonth, toIso, type IsoDate } from '@grosz/shared/dates';
import { formatRelativeDays } from '@grosz/shared/format';
import { describeFrequency } from '@grosz/shared/labels';
import type { Db } from '../db/client.ts';
import { balanceBefore, ensureHorizon, loadRange, signed } from './month.ts';
import { toRecurrence } from './rules.ts';

export async function buildDashboard(db: Db, householdId: string, month: string, today: IsoDate): Promise<DashboardResponse> {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const from = toIso(year, monthNumber, 1);
  const to = toIso(year, monthNumber, daysInMonth(year, monthNumber));
  await ensureHorizon(db, householdId, year, monthNumber);
  const { occurrences: monthOccurrences, transactions: monthTransactions } = await loadRange(db, householdId, from, to);
  const openingBalance = await balanceBefore(db, householdId, from);

  // Zdarzenia dnia po dniu.
  const eventsByDay = new Map<IsoDate, DayEvent[]>();
  const push = (date: IsoDate, event: DayEvent) => eventsByDay.set(date, [...(eventsByDay.get(date) ?? []), event]);
  for (const { occurrence, rule } of monthOccurrences) {
    push(occurrence.dueDate, {
      name: rule.name,
      direction: rule.direction,
      amount: occurrence.actualAmount ?? occurrence.plannedAmount,
      kind: 'recurring',
    });
  }
  for (const { tx } of monthTransactions) {
    push(tx.date, { name: tx.description, direction: tx.direction, amount: tx.amount, kind: 'oneoff' });
  }

  const timeline: TimelineDay[] = [];
  let balance = openingBalance;
  for (let day = 1; day <= daysInMonth(year, monthNumber); day++) {
    const date = toIso(year, monthNumber, day);
    const events = eventsByDay.get(date) ?? [];
    for (const e of events) balance += signed(e.direction, e.amount);
    timeline.push({ date, balance, events });
  }

  const allEvents = [...eventsByDay.values()].flat();
  const sum = (filter: (e: DayEvent) => boolean) => allEvents.filter(filter).reduce((acc, e) => acc + e.amount, 0);
  const income = sum((e) => e.direction === 'income');
  const fixed = sum((e) => e.direction === 'expense' && e.kind === 'recurring');
  const oneOff = sum((e) => e.direction === 'expense' && e.kind === 'oneoff');
  const free = income - fixed - oneOff;

  const daysLeft = today > to ? 0 : today < from ? daysInMonth(year, monthNumber) : daysBetween(today, to) + 1;

  const fixedOccurrences = monthOccurrences.filter((r) => r.rule.direction === 'expense');
  const reference = today < from ? from : today;

  const upcoming: UpcomingPayment[] = fixedOccurrences
    .filter(({ occurrence }) => occurrence.dueDate >= reference)
    .slice(0, 6)
    .map(({ occurrence, rule }) => {
      const parts = [
        rule.endType === 'count' && rule.endCount
          ? `rata ${occurrence.index + 1} z ${rule.endCount}`
          : describeFrequency(toRecurrence(rule)).split(',')[0]!,
      ];
      if (rule.variableAmount) parts.push('kwota zmienna');
      parts.push(formatRelativeDays(daysBetween(today, occurrence.dueDate)));
      return {
        occurrenceId: occurrence.id,
        name: rule.name,
        dueDate: occurrence.dueDate,
        amount: occurrence.actualAmount ?? occurrence.plannedAmount,
        meta: parts.join(' · '),
        variableAmount: rule.variableAmount,
        paid: occurrence.status === 'paid',
        reminder: rule.remindDaysBefore !== null && occurrence.status !== 'paid' && daysBetween(today, occurrence.dueDate) <= rule.remindDaysBefore,
      };
    });

  const byCategory = new Map<string, number>();
  for (const { occurrence, rule, category } of fixedOccurrences) {
    const name = category ?? 'Bez kategorii';
    byCategory.set(name, (byCategory.get(name) ?? 0) + (occurrence.actualAmount ?? occurrence.plannedAmount));
  }
  for (const { tx, category } of monthTransactions) {
    if (tx.direction !== 'expense') continue;
    const name = category ?? 'Bez kategorii';
    byCategory.set(name, (byCategory.get(name) ?? 0) + tx.amount);
  }
  const categoryTotals: CategoryTotal[] = [...byCategory.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);

  const recent: RecentItem[] = [
    ...monthTransactions
      .filter(({ tx }) => tx.date <= today)
      .map(({ tx, category, accountName, accountBank }) => ({
        date: tx.date,
        name: tx.description,
        category: category ?? 'Bez kategorii',
        kind: 'oneoff' as const,
        direction: tx.direction,
        amount: tx.amount,
        accountName: accountName ?? null,
        accountBank: accountBank ?? null,
      })),
    ...monthOccurrences
      .filter(({ occurrence }) => occurrence.status === 'paid')
      .map(({ occurrence, rule, category, accountName, accountBank }) => ({
        date: occurrence.paidOn ?? occurrence.dueDate,
        name: rule.name,
        category: category ?? 'Bez kategorii',
        kind: 'recurring' as const,
        direction: rule.direction,
        amount: occurrence.actualAmount ?? occurrence.plannedAmount,
        accountName: accountName ?? null,
        accountBank: accountBank ?? null,
      })),
  ]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 6);

  const nextIncome = monthOccurrences.find(({ rule, occurrence }) => rule.direction === 'income' && occurrence.dueDate >= reference);

  return {
    month,
    today,
    income,
    fixed,
    oneOff,
    free,
    daysLeft,
    perDay: daysLeft > 0 ? Math.floor(free / daysLeft) : null,
    fixedCount: fixedOccurrences.length,
    fixedPaidCount: fixedOccurrences.filter(({ occurrence }) => occurrence.status === 'paid').length,
    oneOffCount: monthTransactions.filter(({ tx }) => tx.direction === 'expense').length,
    nextIncome: nextIncome ? { name: nextIncome.rule.name, dueDate: nextIncome.occurrence.dueDate } : null,
    timeline,
    upcoming,
    categories: categoryTotals,
    recent,
  };
}
