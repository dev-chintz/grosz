// Kształty odpowiedzi API, wspólne dla serwera i przeglądarki. Kwoty w groszach.

import type { IsoDate } from './dates.ts';
import type { RuleInput, ScheduleSummary } from './recurring.ts';
import type { TransactionInput } from './transactions.ts';

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

export interface CalendarEvent extends DayEvent {
  /** Termin cykliczny (można go opłacić z kalendarza); null dla operacji jednorazowych. */
  occurrenceId: string | null;
  /** Opłacony termin albo operacja jednorazowa, która już się odbyła. */
  done: boolean;
  variableAmount: boolean;
  /** Pierwotna data, gdy termin przesunięto z weekendu lub święta. */
  shiftedFrom: IsoDate | null;
}

export interface CalendarDay {
  date: IsoDate;
  /** false dla dni z sąsiednich miesięcy, dopełniających siatkę do pełnych tygodni. */
  inMonth: boolean;
  holiday: string | null;
  events: CalendarEvent[];
  /** Wpływy − wydatki dnia. */
  net: number;
  /** Suma wydatków dnia (do paska „obciążenie dnia”). */
  outflow: number;
  /** Saldo na koniec dnia; tylko dla dni oglądanego miesiąca. */
  balance: number | null;
}

export interface CalendarResponse {
  month: string; // YYYY-MM
  today: IsoDate;
  /** Pełne tygodnie od poniedziałku do niedzieli. */
  days: CalendarDay[];
  summary: {
    fixedTotal: number;
    fixedPaid: number;
    fixedCount: number;
    fixedPaidCount: number;
    /** Nieopłacone stałe wydatki miesiąca. */
    toPay: number;
    income: number;
    heaviestDay: { date: IsoDate; amount: number } | null;
    endBalance: number;
  };
}

export type LedgerStatus = 'done' | 'planned' | 'overdue';

/** Wiersz listy Transakcje: operacja jednorazowa albo termin cykliczny. */
export interface LedgerItem {
  kind: EventKind;
  /** id transakcji albo terminu (occurrence). */
  id: string;
  /** Tylko dla terminów cyklicznych — link do edycji reguły. */
  ruleId: string | null;
  date: IsoDate;
  name: string;
  direction: Direction;
  amount: number;
  /** Kwota zaplanowana, gdy rzeczywista jest inna (rachunki o zmiennej kwocie). */
  plannedAmount: number | null;
  variableAmount: boolean;
  categoryId: string | null;
  categoryName: string | null;
  accountId: string | null;
  accountName: string | null;
  note: string | null;
  status: LedgerStatus;
}

export interface TransactionsResponse {
  today: IsoDate;
  /** YYYY-MM albo null przy wyszukiwaniu w całej historii. */
  month: string | null;
  query: string | null;
  /** Od najnowszych. */
  items: LedgerItem[];
  /** Wyszukiwanie zwraca najwyżej tyle wyników. */
  limited: boolean;
  totals: { income: number; expense: number };
}

export type SaveTransactionRequest = TransactionInput;
