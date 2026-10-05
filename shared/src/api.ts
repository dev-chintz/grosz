// Kształty odpowiedzi API, wspólne dla serwera i przeglądarki. Kwoty w groszach.

import type { IsoDate } from './dates.ts';
import type { RuleInput, ScheduleSummary } from './recurring.ts';

export type Direction = 'expense' | 'income';
export type EventKind = 'recurring' | 'oneoff';

export interface DayEvent {
  name: string;
  direction: Direction;
  amount: number;
  kind: EventKind;
}

export interface TimelineDay {
  date: IsoDate;
  /** Saldo na koniec dnia (prognoza dla przyszłych dni). */
  balance: number;
  events: DayEvent[];
}

export interface UpcomingPayment {
  occurrenceId: string;
  name: string;
  dueDate: IsoDate;
  amount: number;
  /** np. „rata 43 z 360 · za 10 dni” */
  meta: string;
  variableAmount: boolean;
  paid: boolean;
}

export interface CategoryTotal {
  name: string;
  amount: number;
}

export interface RecentItem {
  date: IsoDate;
  name: string;
  category: string;
  kind: EventKind;
  direction: Direction;
  amount: number;
}

export interface DashboardResponse {
  month: string; // YYYY-MM
  today: IsoDate;
  income: number;
  fixed: number;
  oneOff: number;
  /** income − fixed − oneOff */
  free: number;
  /** Dni do końca miesiąca włącznie z dzisiejszym (0 dla przeszłych miesięcy). */
  daysLeft: number;
  perDay: number | null;
  fixedCount: number;
  fixedPaidCount: number;
  oneOffCount: number;
  nextIncome: { name: string; dueDate: IsoDate } | null;
  timeline: TimelineDay[];
  upcoming: UpcomingPayment[];
  categories: CategoryTotal[];
  recent: RecentItem[];
}

export interface RecurringRuleDto extends RuleInput {
  id: string;
  status: 'active' | 'paused';
  pausedFrom: IsoDate | null;
  categoryName: string | null;
  /** „co miesiąc, 15.” */
  frequencyLabel: string;
  /** Aktualna kwota przeliczona na miesiąc (do sum). */
  monthlyAmount: number;
  /** Od najnowszej. */
  amountHistory: { effectiveFrom: IsoDate; amount: number }[];
  schedule: ScheduleSummary;
}

export interface RecurringListResponse {
  today: IsoDate;
  rules: RecurringRuleDto[];
  /** Suma miesięczna aktywnych wydatków. */
  monthlyExpenses: number;
}

export interface OptionsResponse {
  categories: { id: string; name: string; direction: Direction }[];
  accounts: { id: string; name: string }[];
}

export interface SaveRuleRequest extends RuleInput {
  /** Od kiedy zmiana obowiązuje (domyślnie dziś). Opłaconych terminów nie zmieniamy. */
  applyFrom?: IsoDate;
}
