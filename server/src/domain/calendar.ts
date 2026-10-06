import type { CalendarDay, CalendarEvent, CalendarResponse } from '@grosz/shared/api';
import { addDays, daysInMonth, polishHolidayName, toIso, weekday, type IsoDate } from '@grosz/shared/dates';
import type { Db } from '../db/client.ts';
import { balanceBefore, ensureHorizon, loadRange, signed } from './month.ts';

export async function buildCalendar(db: Db, householdId: string, month: string, today: IsoDate): Promise<CalendarResponse> {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const from = toIso(year, monthNumber, 1);
  const to = toIso(year, monthNumber, daysInMonth(year, monthNumber));
  // Siatka od poniedziałku przed 1. dniem do niedzieli po ostatnim.
  const gridFrom = addDays(from, -weekday(from));
  const gridTo = addDays(to, 6 - weekday(to));

  await ensureHorizon(db, householdId, year, monthNumber);
  const [range, openingBalance] = await Promise.all([loadRange(db, householdId, gridFrom, gridTo), balanceBefore(db, householdId, from)]);

  const byDay = new Map<IsoDate, CalendarEvent[]>();
  const add = (date: IsoDate, event: CalendarEvent) => byDay.set(date, [...(byDay.get(date) ?? []), event]);
  for (const { occurrence, rule, accountName, accountBank } of range.occurrences) {
    add(occurrence.dueDate, {
      name: rule.name,
      direction: rule.direction,
      amount: occurrence.actualAmount ?? occurrence.plannedAmount,
      kind: 'recurring',
      occurrenceId: occurrence.id,
      done: occurrence.status === 'paid',
      variableAmount: rule.variableAmount,
      shiftedFrom: occurrence.nominalDate !== occurrence.dueDate ? occurrence.nominalDate : null,
      accountName: accountName ?? null,
      accountBank: accountBank ?? null,
    });
  }
  for (const { tx, accountName, accountBank } of range.transactions) {
    add(tx.date, {
      name: tx.description,
      direction: tx.direction,
      amount: tx.amount,
      kind: 'oneoff',
      occurrenceId: null,
      done: tx.date <= today,
      variableAmount: false,
      shiftedFrom: null,
      accountName: accountName ?? null,
      accountBank: accountBank ?? null,
    });
  }

  const days: CalendarDay[] = [];
  let balance = openingBalance;
  for (let date = gridFrom; date <= gridTo; date = addDays(date, 1)) {
    // Wpływy przed wydatkami: tak samo jak na wyciągu, gdy wypłata i rachunek wypadają tego samego dnia.
    const events = (byDay.get(date) ?? []).sort((a, b) => (a.direction === b.direction ? 0 : a.direction === 'income' ? -1 : 1));
    const inMonth = date >= from && date <= to;
    const net = events.reduce((sum, e) => sum + signed(e.direction, e.amount), 0);
    if (inMonth) balance += net;
    days.push({
      date,
      inMonth,
      holiday: polishHolidayName(date),
      events,
      net,
      outflow: events.filter((e) => e.direction === 'expense').reduce((sum, e) => sum + e.amount, 0),
      balance: inMonth ? balance : null,
    });
  }

  const monthDays = days.filter((d) => d.inMonth);
  const fixed = monthDays.flatMap((d) => d.events).filter((e) => e.kind === 'recurring' && e.direction === 'expense');
  const heaviest = monthDays.reduce<CalendarDay | null>((best, d) => (d.outflow > (best?.outflow ?? 0) ? d : best), null);

  return {
    month,
    today,
    days,
    summary: {
      fixedTotal: fixed.reduce((sum, e) => sum + e.amount, 0),
      fixedPaid: fixed.filter((e) => e.done).reduce((sum, e) => sum + e.amount, 0),
      fixedCount: fixed.length,
      fixedPaidCount: fixed.filter((e) => e.done).length,
      toPay: fixed.filter((e) => !e.done).reduce((sum, e) => sum + e.amount, 0),
      income: monthDays
        .flatMap((d) => d.events)
        .filter((e) => e.direction === 'income')
        .reduce((sum, e) => sum + e.amount, 0),
      heaviestDay: heaviest ? { date: heaviest.date, amount: heaviest.outflow } : null,
      endBalance: balance,
    },
  };
}
