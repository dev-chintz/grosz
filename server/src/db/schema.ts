// Konwencje (zob. skill `grosz`):
// - kwoty: liczby całkowite w groszach, zawsze dodatnie; kierunek w kolumnie `direction`,
// - daty płatności: `date` (bez godziny), znaczniki czasu: `timestamptz`,
// - każda tabela budżetu ma `household_id`, żeby dało się dodać domowników bez przebudowy.

import { boolean, date, index, integer, pgEnum, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const householdId = () =>
  uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' });

export const direction = pgEnum('direction', ['expense', 'income']);
export const recurrenceUnit = pgEnum('recurrence_unit', ['day', 'week', 'month', 'year']);
export const weekendRule = pgEnum('weekend_rule', ['next', 'previous', 'none']);
export const endType = pgEnum('end_type', ['never', 'until', 'count']);
export const ruleStatus = pgEnum('rule_status', ['active', 'paused']);
export const occurrenceStatus = pgEnum('occurrence_status', ['planned', 'paid', 'skipped']);

export const households = pgTable('households', {
  id: id(),
  name: text('name').notNull(),
  currency: text('currency').notNull().default('PLN'),
  createdAt: createdAt(),
});

/** Domownicy. Na razie bez logowania — to lista osób, do których można przypisać operacje. */
export const users = pgTable(
  'users',
  {
    id: id(),
    householdId: householdId(),
    name: text('name').notNull(),
    email: text('email').unique(),
    createdAt: createdAt(),
  },
  (t) => [index('users_household_idx').on(t.householdId)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    householdId: householdId(),
    name: text('name').notNull(),
    /** Saldo na początek dnia `opening_date`; od niego liczymy prognozę salda. */
    openingBalance: integer('opening_balance').notNull().default(0),
    openingDate: date('opening_date').notNull(),
    archived: boolean('archived').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('accounts_household_idx').on(t.householdId)],
);

export const categories = pgTable(
  'categories',
  {
    id: id(),
    householdId: householdId(),
    name: text('name').notNull(),
    direction: direction('direction').notNull().default('expense'),
    sortOrder: smallint('sort_order').notNull().default(0),
    /** Miesięczny limit wydatków w groszach; null = bez limitu. Tylko dla kategorii wydatków. */
    monthlyLimit: integer('monthly_limit'),
    createdAt: createdAt(),
  },
  (t) => [index('categories_household_idx').on(t.householdId)],
);

/** Wpływy i wydatki cykliczne (wypłata też jest regułą). */
export const recurringRules = pgTable(
  'recurring_rules',
  {
    id: id(),
    householdId: householdId(),
    name: text('name').notNull(),
    direction: direction('direction').notNull().default('expense'),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    /** Kto wydał / otrzymał; null = wspólne. Usunięcie domownika zostawia operacje jako wspólne. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    payee: text('payee'),
    unit: recurrenceUnit('unit').notNull(),
    interval: smallint('interval').notNull().default(1),
    /** Pierwsza płatność (także sprzed korzystania z aplikacji — wtedy numery rat są poprawne). */
    startDate: date('start_date').notNull(),
    /** 1–31; null = dzień ze start_date. Ignorowane, gdy last_day_of_month. */
    dayOfMonth: smallint('day_of_month'),
    lastDayOfMonth: boolean('last_day_of_month').notNull().default(false),
    weekendRule: weekendRule('weekend_rule').notNull().default('next'),
    endType: endType('end_type').notNull().default('never'),
    endDate: date('end_date'),
    endCount: integer('end_count'),
    /** Od tej daty aplikacja śledzi terminy; wcześniejszych wystąpień nie tworzymy. */
    trackFrom: date('track_from').notNull(),
    variableAmount: boolean('variable_amount').notNull().default(false),
    remindDaysBefore: smallint('remind_days_before'),
    autoBook: boolean('auto_book').notNull().default(false),
    status: ruleStatus('status').notNull().default('active'),
    pausedFrom: date('paused_from'),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('recurring_rules_household_idx').on(t.householdId)],
);

/** Historia kwoty reguły: zmiana raty tworzy nową wersję, przeszłość się nie zmienia. */
export const ruleAmountVersions = pgTable(
  'rule_amount_versions',
  {
    id: id(),
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => recurringRules.id, { onDelete: 'cascade' }),
    effectiveFrom: date('effective_from').notNull(),
    amount: integer('amount').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('rule_amount_versions_rule_from_uq').on(t.ruleId, t.effectiveFrom)],
);

/** Konkretne terminy reguł, generowane kilka miesięcy do przodu. */
export const occurrences = pgTable(
  'occurrences',
  {
    id: id(),
    householdId: householdId(),
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => recurringRules.id, { onDelete: 'cascade' }),
    /** 0 = pierwsza płatność reguły; numer raty = index + 1. */
    index: integer('index').notNull(),
    nominalDate: date('nominal_date').notNull(),
    dueDate: date('due_date').notNull(),
    plannedAmount: integer('planned_amount').notNull(),
    /** Rzeczywista kwota (np. rachunek za prąd); null = jak planowana. */
    actualAmount: integer('actual_amount'),
    status: occurrenceStatus('status').notNull().default('planned'),
    paidOn: date('paid_on'),
    /** Kiedy termin zaksięgowano automatycznie; ustawiony znacznik chroni przed ponownym zaksięgowaniem po ręcznym cofnięciu płatności. */
    autoBookedAt: timestamp('auto_booked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('occurrences_rule_index_uq').on(t.ruleId, t.index),
    index('occurrences_household_due_idx').on(t.householdId, t.dueDate),
  ],
);

/** Operacje jednorazowe (wydatki i wpływy). Terminy cykliczne żyją w `occurrences`. */
export const transactions = pgTable(
  'transactions',
  {
    id: id(),
    householdId: householdId(),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    /** Kto wydał / otrzymał; null = wspólne. Usunięcie domownika zostawia operacje jako wspólne. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    direction: direction('direction').notNull().default('expense'),
    date: date('date').notNull(),
    amount: integer('amount').notNull(),
    description: text('description').notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [index('transactions_household_date_idx').on(t.householdId, t.date)],
);
