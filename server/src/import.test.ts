// Import wyciągu przez API: podgląd (nowe / dopasowane do cyklicznych / duplikaty ręcznych), zapis, ponowny import, cofnięcie.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { CategoriesResponse, ImportCommitRequest, ImportPreviewRow, OptionsResponse } from '@grosz/shared/api';
import { parseBankFile } from '@grosz/shared/import';
import { buildApp } from './app.ts';
import { connectPglite, MIGRATIONS_FOLDER, type Connection } from './db/client.ts';
import { bootstrapBudget } from './domain/bootstrap.ts';
import { signIn } from './test-auth.ts';

let connection: Connection;
let app: ReturnType<typeof buildApp>;
const json = <T>(res: { body: string }) => JSON.parse(res.body) as T;

const CSV = [
  'Data transakcji;Data księgowania;Nazwa nadawcy;Nazwa odbiorcy;Szczegóły transakcji;Kwota operacji;Waluta operacji;Kwota w walucie rachunku;Waluta rachunku;Numer rachunku nadawcy;Numer rachunku odbiorcy',
  '12-10-2026;12-10-2026;Jan Kowalski;Spółdzielnia;Czynsz 10/2026;-620,00;PLN;-620,00;PLN;11;22',
  '11-10-2026;13-10-2026;;;JMP S.A. BIEDRONKA 392 CZESTOCHOWA PL;-48,09;PLN;-48,09;PLN;;',
  '09-10-2026;11-10-2026;;;KINO HELIOS PL;-52,00;PLN;-52,00;PLN;;',
].join('\n');

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
  connection = await connectPglite();
  await migrate(connection.db as never, { migrationsFolder: MIGRATIONS_FOLDER });
  await bootstrapBudget(connection.db, '2026-10-01');
  app = buildApp(connection);
  await app.ready();
  await signIn(app, connection);
  // Płatność cykliczna na czynsz (10. dnia, 620 zł) i ręcznie wpisane kino.
  await app.inject({
    method: 'POST',
    url: '/api/recurring',
    payload: {
      name: 'Czynsz', direction: 'expense', categoryId: null, accountId: null, userId: null, payee: null, amount: 62_000, variableAmount: false,
      unit: 'month', interval: 1, startDate: '2026-10-10', dayOfMonth: 10, lastDayOfMonth: false, weekendRule: 'next', endType: 'never',
      endDate: null, endCount: null, remindDaysBefore: null, autoBook: false, note: null,
    },
  });
  await app.inject({ method: 'POST', url: '/api/transactions', payload: { direction: 'expense', amount: 5200, date: '2026-10-10', description: 'Kino', categoryId: null, accountId: null, userId: null, note: null } });
}, 60_000);

afterAll(async () => {
  await app.close();
  await connection.close();
});

const preview = async () => json<{ rows: ImportPreviewRow[] }>(await app.inject({ method: 'POST', url: '/api/import/preview', payload: { rows: parseBankFile(CSV).rows } })).rows;

describe('import wyciągu', () => {
  let rows: ImportPreviewRow[];

  it('podgląd: czynsz pasuje do płatności cyklicznej, kino do ręcznej operacji, Biedronka jest nowa z kategorią', async () => {
    rows = await preview();
    const categories = json<CategoriesResponse>(await app.inject({ url: '/api/categories' })).categories;
    expect(rows.map((r) => [r.status, r.defaultAction])).toEqual([
      ['matched', 'match'],
      ['new', 'create'],
      ['duplicate', 'skip'],
    ]);
    expect(rows[0]!.match).toMatchObject({ name: 'Czynsz', dueDate: '2026-10-12' }); // 10.10 to sobota → poniedziałek
    expect(rows[1]!.suggestedCategoryId).toBe(categories.find((c) => c.name === 'Jedzenie')!.id);
  });

  let batchId: string;

  it('zapis tworzy operacje i odhacza termin; ponowny import widzi wszystko jako zaimportowane', async () => {
    const accountId = json<OptionsResponse>(await app.inject({ url: '/api/options' })).accounts[0]!.id;
    const body: ImportCommitRequest = {
      bank: 'alior',
      fileName: 'test.csv',
      accountId,
      rows: rows.map((r) => ({ key: r.key, date: r.date, direction: r.direction, amount: r.amount, description: r.description, categoryId: r.suggestedCategoryId, action: r.defaultAction, occurrenceId: r.match?.occurrenceId ?? null })),
    };
    const res = json<{ batchId: string; created: number; matched: number }>(await app.inject({ method: 'POST', url: '/api/import/commit', payload: body }));
    expect(res).toMatchObject({ created: 1, matched: 1 });
    batchId = res.batchId;
    const again = await preview();
    expect(again.map((r) => r.status)).toEqual(['imported', 'imported', 'duplicate']);
  });

  it('cofnięcie przywraca stan sprzed importu', async () => {
    expect((await app.inject({ method: 'DELETE', url: `/api/import/batches/${batchId}` })).statusCode).toBe(200);
    expect((await preview()).map((r) => r.status)).toEqual(['matched', 'new', 'duplicate']);
    expect(json<unknown[]>(await app.inject({ url: '/api/import/batches' }))).toHaveLength(0);
  });
});
