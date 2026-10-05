// Kształty odpowiedzi API, wspólne dla serwera i przeglądarki. Kwoty w groszach.

import type { IsoDate } from './dates.ts';

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
