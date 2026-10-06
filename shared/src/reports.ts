// Agregacja raportów: miesiąc po miesiącu i wydatki wg kategorii. Kwoty w groszach.

import { addMonths } from './dates.ts';

export const UNCATEGORIZED_LABEL = 'Bez kategorii';

/** Jedna operacja do zsumowania: termin cykliczny (zaplanowany lub opłacony) albo operacja jednorazowa. */
export interface ReportItem {
  /** YYYY-MM-DD */
  date: string;
  direction: 'expense' | 'income';
  kind: 'recurring' | 'oneoff';
  amount: number;
  category: string | null;
}

export interface ReportMonth {
  month: string; // YYYY-MM
  income: number;
  fixed: number;
  oneOff: number;
}

export interface ReportCategory {
  name: string;
  amount: number;
  /** Udział w wydatkach okresu, 0–1. */
  share: number;
  /** Średnio na miesiąc okresu. */
  average: number;
}

export interface ReportTotals {
  income: number;
  expenses: number;
  /** income − expenses */
  balance: number;
  /** balance / income; null, gdy nie było wpływów (dzielenie przez zero). */
  savingsRate: number | null;
}

/** Klucze miesięcy (YYYY-MM) od najstarszego, ostatni to `endMonth`. */
export function monthKeys(endMonth: string, count: number): string[] {
  const [year, month] = endMonth.split('-').map(Number) as [number, number];
  return Array.from({ length: count }, (_, i) => {
    const m = addMonths(year, month, i - (count - 1));
    return `${m.year}-${String(m.month).padStart(2, '0')}`;
  });
}

export function aggregateReport(items: readonly ReportItem[], keys: readonly string[]) {
  const months = new Map<string, ReportMonth>(keys.map((month) => [month, { month, income: 0, fixed: 0, oneOff: 0 }]));
  const byCategory = new Map<string, number>();

  for (const item of items) {
    const row = months.get(item.date.slice(0, 7));
    if (!row) continue;
    if (item.direction === 'income') {
      row.income += item.amount;
    } else {
      if (item.kind === 'recurring') row.fixed += item.amount;
      else row.oneOff += item.amount;
      const name = item.category ?? UNCATEGORIZED_LABEL;
      byCategory.set(name, (byCategory.get(name) ?? 0) + item.amount);
    }
  }

  const monthRows = keys.map((key) => months.get(key)!);
  const income = monthRows.reduce((sum, m) => sum + m.income, 0);
  const expenses = monthRows.reduce((sum, m) => sum + m.fixed + m.oneOff, 0);
  const totals: ReportTotals = {
    income,
    expenses,
    balance: income - expenses,
    savingsRate: income > 0 ? (income - expenses) / income : null,
  };

  const categories: ReportCategory[] = [...byCategory.entries()]
    .map(([name, amount]) => ({
      name,
      amount,
      share: expenses > 0 ? amount / expenses : 0,
      average: Math.round(amount / keys.length),
    }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'pl'));

  return { months: monthRows, categories, totals };
}
