// Testy API na prawdziwym Postgresie (PGlite w pamięci): trasy, walidacja i zapis do bazy razem.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { CategoriesResponse, RecurringListResponse, ReportsResponse } from '@grosz/shared/api';
import { buildApp } from './app.ts';
import { connectPglite, MIGRATIONS_FOLDER, type Connection } from './db/client.ts';
import { accounts, households } from './db/schema.ts';

let connection: Connection;
let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
  connection = await connectPglite();
  await migrate(connection.db as never, { migrationsFolder: MIGRATIONS_FOLDER });
  const [household] = await connection.db.insert(households).values({ name: 'Test' }).returning();
  await connection.db.insert(accounts).values({ householdId: household!.id, name: 'Konto', openingDate: '2026-01-01' });
  app = buildApp(connection);
  await app.ready();
  // Pierwsze uruchomienie PGlite (WASM) i migracje potrafią zająć kilkanaście sekund.
}, 60_000);

afterAll(async () => {
  await app.close();
  await connection.close();
});

const json = <T>(res: { body: string }) => JSON.parse(res.body) as T;

describe('null w polach liczbowych zostaje null', () => {
  it('płatność cykliczna: bez przypomnienia, ostatni dzień miesiąca, bezterminowo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/recurring',
      payload: {
        name: 'Czynsz',
        direction: 'expense',
        categoryId: null,
        accountId: null,
        payee: null,
        amount: 62_000,
        variableAmount: false,
        unit: 'month',
        interval: 1,
        startDate: '2026-01-31',
        dayOfMonth: null,
        lastDayOfMonth: true,
        weekendRule: 'none',
        endType: 'never',
        endDate: null,
        endCount: null,
        remindDaysBefore: null,
        autoBook: false,
        note: null,
      },
    });
    expect(res.statusCode).toBe(201);
    const list = json<RecurringListResponse>(await app.inject({ url: '/api/recurring' }));
    expect(list.rules[0]).toMatchObject({ name: 'Czynsz', remindDaysBefore: null, dayOfMonth: null, lastDayOfMonth: true, endCount: null });
  });

  it('kategoria: limit można ustawić i zdjąć', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/categories', payload: { name: 'Zwierzęta', direction: 'expense', monthlyLimit: 30_000 } });
    expect(created.statusCode).toBe(201);
    const { id } = json<{ id: string }>(created);
    const removed = await app.inject({ method: 'PUT', url: `/api/categories/${id}`, payload: { name: 'Zwierzęta', monthlyLimit: null } });
    expect(removed.statusCode).toBe(200);
    const list = json<CategoriesResponse>(await app.inject({ url: '/api/categories' }));
    expect(list.categories.find((c) => c.id === id)?.monthlyLimit).toBeNull();
  });
});

describe('walidacja', () => {
  it('nie pozwala na duplikat nazwy kategorii', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/categories', payload: { name: 'zwierzęta', direction: 'expense' } });
    expect(res.statusCode).toBe(400);
    expect(json<{ errors: { name: string } }>(res).errors.name).toMatch(/już istnieje/);
  });

  it('liczba jako tekst nie przechodzi', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      payload: { direction: 'expense', amount: '100', date: '2026-10-01', description: 'X' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('usuwanie kategorii przenosi operacje', () => {
  it('operacja trafia do kategorii docelowej', async () => {
    const make = async (name: string) =>
      json<{ id: string }>(await app.inject({ method: 'POST', url: '/api/categories', payload: { name, direction: 'expense' } })).id;
    const from = await make('Stara');
    const to = await make('Nowa');
    await app.inject({
      method: 'POST',
      url: '/api/transactions',
      payload: { direction: 'expense', amount: 1000, date: '2026-10-01', description: 'Coś', categoryId: from },
    });
    const res = await app.inject({ method: 'DELETE', url: `/api/categories/${from}?moveTo=${to}` });
    expect(res.statusCode).toBe(200);
    const list = json<CategoriesResponse>(await app.inject({ url: '/api/categories?month=2026-10' }));
    expect(list.categories.find((c) => c.id === from)).toBeUndefined();
    expect(list.categories.find((c) => c.id === to)).toMatchObject({ transactionsCount: 1, total: 1000 });
  });
});

describe('raporty', () => {
  const addTransaction = (payload: object) => app.inject({ method: 'POST', url: '/api/transactions', payload });

  it('sumuje operacje jednorazowe z okresu per miesiąc i kategoria, bez operacji spoza okresu', async () => {
    const category = json<{ id: string }>(
      await app.inject({ method: 'POST', url: '/api/categories', payload: { name: 'Raportowa', direction: 'expense' } }),
    ).id;
    await addTransaction({ direction: 'expense', amount: 12_345, date: '2031-02-10', description: 'A', categoryId: category });
    await addTransaction({ direction: 'expense', amount: 5_000, date: '2031-03-02', description: 'B', categoryId: category });
    await addTransaction({ direction: 'expense', amount: 700, date: '2031-03-03', description: 'C', categoryId: null });
    await addTransaction({ direction: 'income', amount: 90_000, date: '2031-03-05', description: 'Premia', categoryId: null });
    await addTransaction({ direction: 'expense', amount: 99_999, date: '2030-12-31', description: 'Poza okresem', categoryId: category });

    const res = await app.inject({ url: '/api/reports?month=2031-03&months=3' });
    expect(res.statusCode).toBe(200);
    const report = json<ReportsResponse>(res);
    expect(report.months.map((m) => m.month)).toEqual(['2031-01', '2031-02', '2031-03']);
    expect(report.months.map((m) => m.oneOff)).toEqual([0, 12_345, 5_700]);
    expect(report.months[2]!.income).toBe(90_000);
    expect(report.categories.find((c) => c.name === 'Raportowa')).toMatchObject({ amount: 17_345, average: Math.round(17_345 / 3) });
    // „Bez kategorii” zawiera też Czynsz z testu wyżej (3 × 620 zł), więc sprawdzamy, że 7 zł z operacji tam jest.
    expect(report.categories.find((c) => c.name === 'Bez kategorii')?.amount).toBe(700 + 3 * 62_000);
    expect(report.categories.some((c) => c.name === 'Premia')).toBe(false);
    expect(report.totals.income).toBe(90_000);
    expect(report.includesPlanned).toBe(true); // okres w przyszłości = same zaplanowane płatności
    expect(json<ReportsResponse>(await app.inject({ url: '/api/reports?month=2026-01&months=3' })).includesPlanned).toBe(false);
  });

  it('domyślnie 6 miesięcy do bieżącego; niedozwolona długość okresu to 400', async () => {
    const ok = json<ReportsResponse>(await app.inject({ url: '/api/reports' }));
    expect(ok.months).toHaveLength(6);
    expect(ok.months.at(-1)!.month).toBe(ok.endMonth);
    expect((await app.inject({ url: '/api/reports?months=4' })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/reports?month=2031-13' })).statusCode).toBe(400);
  });
});
