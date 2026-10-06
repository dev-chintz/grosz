// Testy API na prawdziwym Postgresie (PGlite w pamięci): trasy, walidacja i zapis do bazy razem.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { CategoriesResponse, RecurringListResponse } from '@grosz/shared/api';
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
