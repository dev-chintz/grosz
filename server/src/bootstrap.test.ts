// Bootstrap pustego budżetu na świeżym PGlite w pamięci.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { CategoriesResponse, SettingsResponse } from '@grosz/shared/api';
import { buildApp } from './app.ts';
import { connectPglite, MIGRATIONS_FOLDER, type Connection } from './db/client.ts';
import { bootstrapBudget, DEFAULT_CATEGORIES } from './domain/bootstrap.ts';

let connection: Connection;
let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
  connection = await connectPglite();
  await migrate(connection.db as never, { migrationsFolder: MIGRATIONS_FOLDER });
  app = buildApp(connection);
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app.close();
  await connection.close();
});

const json = <T>(res: { body: string }) => JSON.parse(res.body) as T;

describe('bootstrap pustego budżetu', () => {
  it('przed bootstrapem pusta baza zwraca 409 na każdym ekranie', async () => {
    expect((await app.inject({ url: '/api/settings' })).statusCode).toBe(409);
    expect((await app.inject({ url: '/api/dashboard' })).statusCode).toBe(409);
  });

  it('zakłada gospodarstwo, osobę, konto z saldem 0 i domyślne kategorie', async () => {
    expect(await bootstrapBudget(connection.db, '2026-10-06')).toBe(true);

    const settings = json<SettingsResponse>(await app.inject({ url: '/api/settings' }));
    expect(settings.household).toMatchObject({ name: 'Budżet domowy', currency: 'PLN' });
    expect(settings.members.map((m) => m.name)).toEqual(['Ja']);
    expect(settings.accounts).toHaveLength(1);
    expect(settings.accounts[0]).toMatchObject({ name: 'Konto główne', openingBalance: 0, openingDate: '2026-10-06', archived: false });

    const categories = json<CategoriesResponse>(await app.inject({ url: '/api/categories?month=2026-10' })).categories;
    expect(categories.filter((c) => c.direction === 'expense').map((c) => c.name)).toEqual([...DEFAULT_CATEGORIES.expense]);
    expect(categories.filter((c) => c.direction === 'income').map((c) => c.name)).toEqual([...DEFAULT_CATEGORIES.income]);
    expect(categories.every((c) => c.monthlyLimit === null)).toBe(true);
  });

  it('po bootstrapie ekrany działają na pustym budżecie', async () => {
    const dashboard = await app.inject({ url: '/api/dashboard?month=2026-10' });
    expect(dashboard.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/calendar?month=2026-10' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/reports' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/transactions?month=2026-10' })).statusCode).toBe(200);
  });

  it('jest idempotentny: drugie uruchomienie niczego nie dubluje', async () => {
    expect(await bootstrapBudget(connection.db, '2026-10-07')).toBe(false);
    const settings = json<SettingsResponse>(await app.inject({ url: '/api/settings' }));
    expect(settings.members).toHaveLength(1);
    expect(settings.accounts).toHaveLength(1);
    expect(settings.accounts[0]!.openingDate).toBe('2026-10-06');
    const categories = json<CategoriesResponse>(await app.inject({ url: '/api/categories?month=2026-10' })).categories;
    expect(categories).toHaveLength(DEFAULT_CATEGORIES.expense.length + DEFAULT_CATEGORIES.income.length);
  });
});
