// Przykładowe dane z mockupu (październik 2026) do pracy lokalnej.
// Nie uruchamiaj na bazie na NAS — tam są prawdziwe dane.

import { and, eq, lte } from 'drizzle-orm';
import { today } from '@grosz/shared/dates';
import { parsePLN } from '@grosz/shared/format';
import { connect } from './db/client.ts';
import { accounts, categories, households, occurrences, recurringRules, ruleAmountVersions, transactions } from './db/schema.ts';
import { currentHouseholdId } from './domain/household.ts';
import { ensureOccurrences } from './domain/rules.ts';

const zl = (text: string) => {
  const value = parsePLN(text);
  if (value === null) throw new Error(`Zła kwota w seedzie: ${text}`);
  return value;
};

const connection = await connect();
const { db } = connection;
try {
  if (connection.kind === 'postgres' && process.env.ALLOW_SEED !== '1') {
    throw new Error('Seed na prawdziwym PostgreSQL jest zablokowany. Ustaw ALLOW_SEED=1, jeśli naprawdę wiesz, co robisz.');
  }
  if (await currentHouseholdId(db)) {
    console.log('Baza ma już dane — pomijam seed.');
  } else {
    await seed();
    console.log('Dane przykładowe zapisane.');
  }
} finally {
  await connection.close();
}

async function seed() {
  const trackFrom = '2026-10-01';
  const [household] = await db.insert(households).values({ name: 'Budżet osobisty' }).returning();
  const householdId = household!.id;

  const [account] = await db
    .insert(accounts)
    .values({ householdId, name: 'Konto główne', openingBalance: zl('3280'), openingDate: trackFrom })
    .returning();

  const categoryNames = {
    expense: ['Mieszkanie', 'Transport', 'Jedzenie', 'Raty', 'Abonamenty', 'Prezenty', 'Sport i zdrowie'],
    income: ['Wynagrodzenie', 'Dodatkowe'],
  } as const;
  // Przykładowe limity: Jedzenie z zapasem, Transport celowo przekroczony (serwis auta), Mieszkanie blisko limitu.
  const limits: Record<string, number> = { Jedzenie: zl('1200'), Transport: zl('800'), Mieszkanie: zl('3300'), Abonamenty: zl('200') };
  const categoryRows = await db
    .insert(categories)
    .values([
      ...categoryNames.expense.map((name, i) => ({ householdId, name, direction: 'expense' as const, sortOrder: i, monthlyLimit: limits[name] ?? null })),
      ...categoryNames.income.map((name, i) => ({ householdId, name, direction: 'income' as const, sortOrder: i })),
    ])
    .returning();
  const category = (name: string) => categoryRows.find((c) => c.name === name)!.id;

  type RuleSeed = Omit<typeof recurringRules.$inferInsert, 'householdId' | 'trackFrom'> & { amounts: [string, string][] };
  const rules: RuleSeed[] = [
    { name: 'Wypłata', direction: 'income', categoryId: category('Wynagrodzenie'), unit: 'month', startDate: '2024-01-10', dayOfMonth: 10, weekendRule: 'previous', autoBook: true, amounts: [['2024-01-10', '8450']] },
    {
      name: 'Rata kredytu hipotecznego', categoryId: category('Mieszkanie'), payee: 'Bank — kredyt nr …4471', unit: 'month', startDate: '2023-04-15', dayOfMonth: 15,
      endType: 'count', endCount: 360, remindDaysBefore: 3, autoBook: true,
      amounts: [['2023-04-15', '2410'], ['2026-07-01', '2340']],
    },
    { name: 'Czynsz administracyjny', categoryId: category('Mieszkanie'), unit: 'month', startDate: '2024-01-10', dayOfMonth: 10, amounts: [['2024-01-10', '620']] },
    { name: 'Raty 0% — laptop', categoryId: category('Raty'), unit: 'month', startDate: '2026-04-25', dayOfMonth: 25, endType: 'count', endCount: 20, amounts: [['2026-04-25', '250']] },
    { name: 'Prąd', categoryId: category('Mieszkanie'), unit: 'month', interval: 2, startDate: '2026-02-20', dayOfMonth: 20, variableAmount: true, amounts: [['2026-02-20', '180']] },
    { name: 'Ubezpieczenie OC/AC', categoryId: category('Transport'), unit: 'year', startDate: '2026-03-03', dayOfMonth: 3, amounts: [['2026-03-03', '1140']] },
    // Subskrypcje pobierane z karty schodzą także w weekendy, więc bez przesuwania.
    { name: 'Siłownia — karnet', categoryId: category('Sport i zdrowie'), unit: 'month', startDate: '2025-01-01', dayOfMonth: 1, weekendRule: 'none', endType: 'until', endDate: '2026-12-31', amounts: [['2025-01-01', '139']] },
    { name: 'Internet światłowód', categoryId: category('Abonamenty'), unit: 'month', startDate: '2025-08-05', dayOfMonth: 5, endType: 'until', endDate: '2027-08-05', amounts: [['2025-08-05', '69']] },
    { name: 'Netflix', categoryId: category('Abonamenty'), unit: 'month', startDate: '2025-01-18', dayOfMonth: 18, weekendRule: 'none', amounts: [['2025-01-18', '49']] },
    { name: 'Telefon', categoryId: category('Abonamenty'), unit: 'month', startDate: '2025-01-12', dayOfMonth: 12, amounts: [['2025-01-12', '45']] },
    { name: 'Spotify', categoryId: category('Abonamenty'), unit: 'month', startDate: '2025-01-22', dayOfMonth: 22, weekendRule: 'none', amounts: [['2025-01-22', '23,99']] },
    { name: 'Basen — karnet', categoryId: category('Sport i zdrowie'), unit: 'month', startDate: '2025-03-01', dayOfMonth: 1, weekendRule: 'none', status: 'paused', pausedFrom: '2026-09-01', amounts: [['2025-03-01', '120']] },
  ];

  for (const { amounts, ...rule } of rules) {
    const [row] = await db.insert(recurringRules).values({ ...rule, householdId, accountId: account!.id, trackFrom }).returning();
    await db.insert(ruleAmountVersions).values(amounts.map(([effectiveFrom, amount]) => ({ ruleId: row!.id, effectiveFrom, amount: zl(amount) })));
  }

  await db.insert(transactions).values(
    (
      [
        ['2026-10-02', 'Paliwo', 'Transport', '280', 'expense'],
        ['2026-10-03', 'Zakupy spożywcze', 'Jedzenie', '312,40', 'expense'],
        ['2026-10-04', 'Prezent urodzinowy', 'Prezenty', '150', 'expense'],
        ['2026-10-05', 'Serwis auta', 'Transport', '640', 'expense'],
        ['2026-10-28', 'Zlecenie freelance', 'Dodatkowe', '1200', 'income'],
      ] as const
    ).map(([date, description, cat, amount, direction]) => ({
      householdId, accountId: account!.id, categoryId: category(cat), date, description, amount: zl(amount), direction,
    })),
  );

  // Terminy do końca roku; wszystko, co już minęło, oznaczamy jako opłacone.
  await ensureOccurrences(db, householdId, '2027-01-31');
  const now = today();
  const due = await db.select().from(occurrences).where(and(eq(occurrences.householdId, householdId), lte(occurrences.dueDate, now)));
  for (const o of due) {
    await db.update(occurrences).set({ status: 'paid', paidOn: o.dueDate }).where(eq(occurrences.id, o.id));
  }
}
