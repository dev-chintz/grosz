// Kształty odpowiedzi API, wspólne dla serwera i przeglądarki. Kwoty w groszach.

import type { IsoDate } from './dates.ts';
import type { RuleInput, ScheduleSummary } from './recurring.ts';
import type { TransactionInput } from './transactions.ts';
import type { CategoryInput, LimitState } from './categories.ts';
import type { ReportCategory, ReportMonth, ReportTotals } from './reports.ts';
import type { AccountInput, HouseholdInput, MemberInput } from './settings.ts';

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
  /** Termin mieści się w oknie przypomnienia reguły (zostało tyle dni lub mniej) i płatność jest nieopłacona. */
  reminder: boolean;
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
  accountName: string | null;
  accountBank: string | null;
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
  accountName: string | null;
  accountBank: string | null;
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
  accounts: { id: string; name: string; bank: string | null }[];
  members: { id: string; name: string }[];
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
  /** Account name for this event. */
  accountName: string | null;
  /** Bank code for the account. */
  accountBank: string | null;
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
  /** Bank code for the account, or null. */
  accountBank: string | null;
  /** Domownik; null = wspólna. */
  userId: string | null;
  userName: string | null;
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

export interface CategoryDto {
  id: string;
  name: string;
  direction: Direction;
  sortOrder: number;
  monthlyLimit: number | null;
  /** Suma w oglądanym miesiącu: wydane + zaplanowane. */
  total: number;
  /** Część sumy, która już się wydarzyła (opłacone terminy, operacje do dziś). */
  done: number;
  /** Średnia z 3 poprzednich miesięcy. */
  average: number;
  /** Sumy 3 poprzednich miesięcy, od najstarszego. */
  history: { month: string; total: number }[];
  rulesCount: number;
  transactionsCount: number;
  limitState: LimitState;
}

export interface CategoriesResponse {
  month: string;
  today: IsoDate;
  categories: CategoryDto[];
  /** Operacje bez kategorii w oglądanym miesiącu. */
  uncategorized: { expense: number; income: number };
}

export type SaveCategoryRequest = CategoryInput;

export interface ReportsResponse {
  /** Ostatni miesiąc okresu (YYYY-MM). */
  endMonth: string;
  today: IsoDate;
  /** Od najstarszego; ostatni to `endMonth`. */
  months: ReportMonth[];
  /** Wydatki okresu wg kategorii, od największej. */
  categories: ReportCategory[];
  totals: ReportTotals;
  /** Okres obejmuje miesiące, w których są jeszcze nieopłacone (zaplanowane) płatności. */
  includesPlanned: boolean;
}

export interface AccountDto {
  id: string;
  name: string;
  openingBalance: number;
  openingDate: IsoDate;
  archived: boolean;
  /** Bank code from BANKS, or null. */
  bank: string | null;
  /** Ile płatności cyklicznych i operacji jednorazowych jest przypisanych do konta. */
  rulesCount: number;
  transactionsCount: number;
}

export interface MemberDto {
  id: string;
  name: string;
  /** Ile płatności cyklicznych i operacji jednorazowych jest przypisanych do osoby. */
  rulesCount: number;
  transactionsCount: number;
}

export interface SettingsResponse {
  household: { name: string; currency: string };
  /** Alfabetycznie. */
  members: MemberDto[];
  /** Aktywne najpierw, potem zarchiwizowane; w grupach alfabetycznie. */
  accounts: AccountDto[];
}

export type SaveAccountRequest = AccountInput;
export type SaveHouseholdRequest = HouseholdInput;
export type SaveMemberRequest = MemberInput;

export interface UpdateChange {
  sha: string;
  message: string;
  date: string;
}

export interface UpdateStatusResponse {
  /** Commit zainstalowanej wersji (null w developmencie). */
  current: string | null;
  latest: UpdateChange | null;
  /** O ile commitów zainstalowana wersja jest za GitHubem. */
  behind: number | null;
  /** Nowe zmiany, od najnowszej (najwyżej 20). */
  changes: UpdateChange[];
  checkError: string | null;
  updater: {
    configured: boolean;
    reachable: boolean;
    state: {
      running: boolean;
      startedAt: string | null;
      finishedAt: string | null;
      result: 'ok' | 'failed' | null;
      steps: { title: string; at: string }[];
      log: string;
    } | null;
  };
}

export type ImportAction = 'create' | 'match' | 'skip';

export interface ImportPreviewRow {
  key: string;
  date: IsoDate;
  direction: Direction;
  amount: number;
  description: string;
  /** imported: już zaimportowany (pomijamy); matched: pasuje do terminu cyklicznego; duplicate: podobna operacja wpisana ręcznie. */
  status: 'new' | 'imported' | 'matched' | 'duplicate';
  suggestedCategoryId: string | null;
  match: { occurrenceId: string; name: string; dueDate: IsoDate; plannedAmount: number } | null;
  duplicateOf: { id: string; description: string; date: IsoDate } | null;
  defaultAction: ImportAction;
}

export interface ImportPreviewResponse {
  rows: ImportPreviewRow[];
}

export interface ImportCommitRequest {
  bank: string;
  fileName: string;
  accountId: string | null;
  rows: { key: string; date: IsoDate; direction: Direction; amount: number; description: string; categoryId: string | null; action: ImportAction; occurrenceId: string | null }[];
}

export interface ImportBatchDto {
  id: string;
  bank: string;
  fileName: string;
  createdCount: number;
  matchedCount: number;
  createdAt: string;
}
