// Testy API na prawdziwym Postgresie (PGlite w pamięci): trasy, walidacja i zapis do bazy razem.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { CategoriesResponse, DashboardResponse, OptionsResponse, RecurringListResponse, ReportsResponse, SettingsResponse, TransactionsResponse } from '@grosz/shared/api';
import { addDays, today as todayIso } from '@grosz/shared/dates';
import { buildApp } from './app.ts';
import { signIn } from './test-auth.ts';
import { connectPglite, MIGRATIONS_FOLDER, type Connection } from './db/client.ts';
import { accounts, categories, households, transactions, users } from './db/schema.ts';

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
  await signIn(app, connection);
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

describe('ustawienia', () => {
  const account = (payload: object) => app.inject({ method: 'POST', url: '/api/accounts', payload });
  const settings = async () => json<SettingsResponse>(await app.inject({ url: '/api/settings' }));

  it('zwraca gospodarstwo i konta, a nazwę gospodarstwa można zmienić', async () => {
    const before = await settings();
    expect(before.household).toMatchObject({ name: 'Test', currency: 'PLN' });
    expect(before.accounts.find((a) => a.name === 'Konto')).toMatchObject({ archived: false, openingBalance: 0, openingDate: '2026-01-01' });

    expect((await app.inject({ method: 'PUT', url: '/api/settings/household', payload: { name: '  Dom  ' } })).statusCode).toBe(200);
    expect((await settings()).household.name).toBe('Dom');

    const empty = await app.inject({ method: 'PUT', url: '/api/settings/household', payload: { name: ' ' } });
    expect(empty.statusCode).toBe(400);
    expect(json<{ errors: { name: string } }>(empty).errors.name).toBeDefined();
  });

  it('konto: saldo ujemne zostaje ujemne, edycja się zapisuje, duplikat i zła data dają błędy per pole', async () => {
    const created = await account({ name: 'Karta', openingBalance: -150_000, openingDate: '2026-03-15' });
    expect(created.statusCode).toBe(201);
    const id = json<{ id: string }>(created).id;
    expect((await settings()).accounts.find((a) => a.id === id)).toMatchObject({ name: 'Karta', openingBalance: -150_000, openingDate: '2026-03-15' });

    const duplicate = await account({ name: 'KARTA', openingBalance: 0, openingDate: '2026-03-15' });
    expect(duplicate.statusCode).toBe(400);
    expect(json<{ errors: { name: string } }>(duplicate).errors.name).toBeDefined();

    const badDate = await account({ name: 'Inna', openingBalance: 0, openingDate: '2026-02-30' });
    expect(badDate.statusCode).toBe(400);
    expect(json<{ errors: { openingDate: string } }>(badDate).errors.openingDate).toBeDefined();

    const update = await app.inject({ method: 'PUT', url: `/api/accounts/${id}`, payload: { name: 'Karta kredytowa', openingBalance: 0, openingDate: '2026-04-01' } });
    expect(update.statusCode).toBe(200);
    expect((await settings()).accounts.find((a) => a.id === id)).toMatchObject({ name: 'Karta kredytowa', openingBalance: 0, openingDate: '2026-04-01' });
  });

  it('saldo jako tekst nie przechodzi', async () => {
    expect((await account({ name: 'Tekst', openingBalance: '100', openingDate: '2026-01-01' })).statusCode).toBe(400);
  });

  it('archiwizacja ukrywa konto w formularzach, a ostatniego aktywnego konta nie da się zarchiwizować', async () => {
    const all = (await settings()).accounts;
    const main = all.find((a) => a.name === 'Konto')!;
    const other = all.find((a) => a.name === 'Karta kredytowa')!;

    expect((await app.inject({ method: 'POST', url: `/api/accounts/${other.id}/archive` })).statusCode).toBe(200);
    expect((await settings()).accounts.find((a) => a.id === other.id)?.archived).toBe(true);
    expect(json<OptionsResponse>(await app.inject({ url: '/api/options' })).accounts.map((a) => a.id)).not.toContain(other.id);

    const last = await app.inject({ method: 'POST', url: `/api/accounts/${main.id}/archive` });
    expect(last.statusCode).toBe(400);
    expect(json<{ error: string }>(last).error).toContain('co najmniej jedno');

    expect((await app.inject({ method: 'POST', url: `/api/accounts/${other.id}/restore` })).statusCode).toBe(200);
    expect(json<OptionsResponse>(await app.inject({ url: '/api/options' })).accounts.map((a) => a.id)).toContain(other.id);
  });

  it('nieistniejące konto to 404', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/accounts/00000000-0000-4000-8000-000000000000/archive' });
    expect(res.statusCode).toBe(404);
  });
});

describe('eksport danych', () => {
  const addTransaction = (payload: object) => app.inject({ method: 'POST', url: '/api/transactions', payload });

  it('kopia JSON: wersja, dane gospodarstwa, bez household_id i bez danych innego gospodarstwa', async () => {
    await addTransaction({ direction: 'expense', amount: 4_200, date: '2032-01-10', description: 'Do kopii zapasowej' });
    const [other] = await connection.db.insert(households).values({ name: 'Obce gospodarstwo' }).returning();
    await connection.db.insert(transactions).values({ householdId: other!.id, direction: 'expense', amount: 100, date: '2032-01-11', description: 'Cudza operacja' });

    const res = await app.inject({ url: '/api/export/backup' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="grosz-kopia-\d{4}-\d{2}-\d{2}\.json"$/);
    const backup = JSON.parse(res.body) as { app: string; version: number; exportedAt: string; household: { name: string }; transactions: { description: string }[]; accounts: unknown[] };
    expect(backup).toMatchObject({ app: 'grosz', version: 1 });
    expect(Number.isNaN(Date.parse(backup.exportedAt))).toBe(false);
    expect(backup.household.name).toBe('Dom');
    expect(backup.accounts.length).toBeGreaterThan(0);
    expect(backup.transactions.map((t) => t.description)).toContain('Do kopii zapasowej');
    expect(res.body).not.toContain('Cudza operacja');
    expect(res.body).not.toContain('householdId');
  });

  it('CSV: tylko zakres dat, BOM, nagłówki do pobrania, formuła zabezpieczona, cudze dane nie wyciekają', async () => {
    await addTransaction({ direction: 'expense', amount: 1_250, date: '2031-05-10', description: 'Eksport w zakresie' });
    await addTransaction({ direction: 'income', amount: 50_000, date: '2031-06-10', description: '=HYPERLINK("http://zlosliwy";"x")' });
    await addTransaction({ direction: 'expense', amount: 999, date: '2031-07-01', description: 'Eksport poza zakresem' });

    const res = await app.inject({ url: '/api/export/transactions?from=2031-05-01&to=2031-06-30' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe('attachment; filename="grosz-operacje-2031-05-01_2031-06-30.csv"');
    expect(res.body.startsWith('\uFEFFData;Rodzaj;Nazwa;')).toBe(true);
    expect(res.body).toContain('2031-05-10;jednorazowa;Eksport w zakresie;;');
    expect(res.body).toContain(';wydatek;-12,50;');
    expect(res.body).toContain("'=HYPERLINK");
    expect(res.body).not.toMatch(/;=HYPERLINK/);
    expect(res.body).not.toContain('poza zakresem');

    const all = await app.inject({ url: '/api/export/transactions' });
    expect(all.body).toContain('Eksport poza zakresem');
    expect(all.body).not.toContain('Cudza operacja');
    expect(all.headers['content-disposition']).toContain('grosz-operacje-poczatek_koniec.csv');
  });

  it('niepoprawny zakres dat to 400', async () => {
    expect((await app.inject({ url: '/api/export/transactions?from=2031-06-30&to=2031-05-01' })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/export/transactions?from=2026-02-30' })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/export/transactions?from=wczoraj' })).statusCode).toBe(400);
  });
});

describe('domownicy', () => {
  const member = (name: string) => app.inject({ method: 'POST', url: '/api/members', payload: { name } });
  const settings = async () => json<SettingsResponse>(await app.inject({ url: '/api/settings' }));
  const addTransaction = (payload: object) => app.inject({ method: 'POST', url: '/api/transactions', payload });
  const ledger = async (query: string) => json<TransactionsResponse>(await app.inject({ url: `/api/transactions?month=2033-04&${query}` }));

  it('dodawanie, alfabetyczna lista, duplikat (bez względu na wielkość liter) i edycja', async () => {
    const piotr = await member('Piotr');
    expect(piotr.statusCode).toBe(201);
    const anna = await member('Anna');
    expect(anna.statusCode).toBe(201);

    const duplicate = await member('ANNA');
    expect(duplicate.statusCode).toBe(400);
    expect(json<{ errors: { name: string } }>(duplicate).errors.name).toBeDefined();

    const list = (await settings()).members;
    expect(list.map((m) => m.name)).toEqual(['Anna', 'Piotr']);
    expect(list[0]).toMatchObject({ rulesCount: 0, transactionsCount: 0 });

    const id = json<{ id: string }>(anna).id;
    expect((await app.inject({ method: 'PUT', url: `/api/members/${id}`, payload: { name: 'Ania' } })).statusCode).toBe(200);
    expect((await settings()).members.map((m) => m.name)).toEqual(['Ania', 'Piotr']);
    expect((await app.inject({ method: 'PUT', url: `/api/members/${id}`, payload: { name: ' ' } })).statusCode).toBe(400);
  });

  it('operacje i płatności cykliczne przypisane do osoby: nazwa w liście, filtr, eksport i opcje formularzy', async () => {
    const [ania, piotr] = (await settings()).members;
    await addTransaction({ direction: 'expense', amount: 1_000, date: '2033-04-05', description: 'Zakup Ani', userId: ania!.id });
    await addTransaction({ direction: 'expense', amount: 2_000, date: '2033-04-06', description: 'Zakup Piotra', userId: piotr!.id });
    await addTransaction({ direction: 'expense', amount: 3_000, date: '2033-04-07', description: 'Zakup wspólny' });

    const all = await ledger('');
    expect(all.items.find((i) => i.name === 'Zakup Ani')).toMatchObject({ userId: ania!.id, userName: 'Ania' });
    expect(all.items.find((i) => i.name === 'Zakup wspólny')).toMatchObject({ userId: null, userName: null });

    const onlyAnia = (await ledger(`user=${ania!.id}`)).items.map((i) => i.name);
    expect(onlyAnia).toContain('Zakup Ani');
    expect(onlyAnia).not.toContain('Zakup Piotra');
    expect(onlyAnia).not.toContain('Zakup wspólny');

    const shared = (await ledger('user=none')).items.map((i) => i.name);
    expect(shared).toContain('Zakup wspólny');
    expect(shared).not.toContain('Zakup Ani');

    expect((await app.inject({ url: '/api/transactions?user=nie-uuid' })).statusCode).toBe(400);

    const rule = await app.inject({
      method: 'POST',
      url: '/api/recurring',
      payload: {
        name: 'Karnet Ani', direction: 'expense', categoryId: null, accountId: null, userId: ania!.id, payee: null, amount: 15_000, variableAmount: false,
        unit: 'month', interval: 1, startDate: '2033-04-10', dayOfMonth: null, lastDayOfMonth: false, weekendRule: 'none', endType: 'never',
        endDate: null, endCount: null, remindDaysBefore: null, autoBook: false, note: null,
      },
    });
    expect(rule.statusCode).toBe(201);
    const rules = json<RecurringListResponse>(await app.inject({ url: '/api/recurring' })).rules;
    expect(rules.find((r) => r.name === 'Karnet Ani')?.userId).toBe(ania!.id);
    expect((await ledger(`user=${ania!.id}`)).items.map((i) => i.name)).toContain('Karnet Ani');

    expect(json<OptionsResponse>(await app.inject({ url: '/api/options' })).members.map((m) => m.name)).toEqual(['Ania', 'Piotr']);
    expect((await settings()).members.find((m) => m.id === ania!.id)).toMatchObject({ transactionsCount: 1, rulesCount: 1 });

    const csv = await app.inject({ url: '/api/export/transactions?from=2033-04-01&to=2033-04-30' });
    expect(csv.body).toContain(';Ania;');
    const backup = JSON.parse((await app.inject({ url: '/api/export/backup' })).body) as { users: { name: string }[] };
    expect(backup.users.map((u) => u.name)).toEqual(['Ania', 'Piotr']);
  });

  it('nie da się przypisać osoby spoza gospodarstwa ani nieistniejącej', async () => {
    const [other] = await connection.db.insert(households).values({ name: 'Inne gospodarstwo' }).returning();
    const [stranger] = await connection.db.insert(users).values({ householdId: other!.id, name: 'Obca osoba' }).returning();

    for (const userId of [stranger!.id, '00000000-0000-4000-8000-000000000000']) {
      const res = await addTransaction({ direction: 'expense', amount: 100, date: '2033-04-08', description: 'Nie powinno przejść', userId });
      expect(res.statusCode).toBe(400);
      expect(json<{ errors: { userId: string } }>(res).errors.userId).toBeDefined();
    }
    expect((await ledger('')).items.map((i) => i.name)).not.toContain('Nie powinno przejść');

    // cudzej osoby nie można też edytować ani usunąć
    expect((await app.inject({ method: 'PUT', url: `/api/members/${stranger!.id}`, payload: { name: 'Zmieniona' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/members/${stranger!.id}` })).statusCode).toBe(404);
  });

  it('usunięcie osoby zostawia jej operacje jako wspólne, a ostatniej osoby nie da się usunąć', async () => {
    const [ania, piotr] = (await settings()).members;
    expect((await app.inject({ method: 'DELETE', url: `/api/members/${piotr!.id}` })).statusCode).toBe(200);

    const item = (await ledger('')).items.find((i) => i.name === 'Zakup Piotra');
    expect(item).toMatchObject({ userId: null, userName: null });
    expect((await settings()).members.map((m) => m.name)).toEqual(['Ania']);

    const last = await app.inject({ method: 'DELETE', url: `/api/members/${ania!.id}` });
    expect(last.statusCode).toBe(400);
    expect(json<{ error: string }>(last).error).toContain('co najmniej jedna');
  });
});

describe('automatyczne księgowanie i przypomnienia', () => {
  const day = todayIso();
  const monthOf = (date: string) => date.slice(0, 7);

  const createRule = (name: string, extra: object = {}, startDate: string = day) =>
    app.inject({
      method: 'POST',
      url: '/api/recurring',
      payload: {
        name, direction: 'expense', categoryId: null, accountId: null, userId: null, payee: null, amount: 5_000, variableAmount: false,
        unit: 'month', interval: 1, startDate, dayOfMonth: Number(startDate.slice(8, 10)), lastDayOfMonth: false, weekendRule: 'none', endType: 'never',
        endDate: null, endCount: null, remindDaysBefore: null, autoBook: false, note: null, ...extra,
      },
    });
  const ledgerItem = async (name: string) => {
    const ledger = json<TransactionsResponse>(await app.inject({ url: `/api/transactions?month=${monthOf(day)}` }));
    return ledger.items.find((i) => i.name === name)!;
  };

  it('księguje termin z włączonym księgowaniem (też wpływ), a zmienną kwotę i wyłączone księgowanie zostawia', async () => {
    expect((await createRule('Auto stała', { autoBook: true })).statusCode).toBe(201);
    expect((await createRule('Auto wpływ', { autoBook: true, direction: 'income' })).statusCode).toBe(201);
    expect((await createRule('Auto zmienna', { autoBook: true, variableAmount: true })).statusCode).toBe(201);
    expect((await createRule('Bez księgowania')).statusCode).toBe(201);

    expect(await ledgerItem('Auto stała')).toMatchObject({ status: 'done', amount: 5_000 });
    expect(await ledgerItem('Auto wpływ')).toMatchObject({ status: 'done', direction: 'income', amount: 5_000 });
    expect(await ledgerItem('Auto zmienna')).toMatchObject({ status: 'planned' });
    expect(await ledgerItem('Bez księgowania')).toMatchObject({ status: 'planned' });
  });

  it('ręcznie cofnięta płatność nie wraca po ponownym otwarciu widoku, a kolejne odczyty niczego nie zmieniają', async () => {
    const booked = await ledgerItem('Auto stała');
    expect(booked.status).toBe('done');
    expect((await app.inject({ method: 'POST', url: `/api/occurrences/${booked.id}/unpay` })).statusCode).toBe(200);

    expect(await ledgerItem('Auto stała')).toMatchObject({ status: 'planned' });
    expect(await ledgerItem('Auto stała')).toMatchObject({ status: 'planned' });
    // widok reguł i Pulpit też nie księgują ponownie
    await app.inject({ url: '/api/recurring' });
    await app.inject({ url: `/api/dashboard?month=${monthOf(day)}` });
    expect(await ledgerItem('Auto stała')).toMatchObject({ status: 'planned' });
  });

  it('przypomnienie: flaga tylko dla nieopłaconej płatności w oknie przypomnienia', async () => {
    const due = addDays(day, 2);
    expect((await createRule('Z przypomnieniem', { remindDaysBefore: 3 }, due)).statusCode).toBe(201);
    expect((await createRule('Przypomnienie za wąskie', { remindDaysBefore: 1 }, due)).statusCode).toBe(201);
    expect((await createRule('Bez przypomnienia', { remindDaysBefore: null }, due)).statusCode).toBe(201);

    const dashboard = json<DashboardResponse>(await app.inject({ url: `/api/dashboard?month=${monthOf(due)}` }));
    const upcoming = (name: string) => dashboard.upcoming.find((u) => u.name === name);
    expect(upcoming('Z przypomnieniem')).toMatchObject({ reminder: true, paid: false });
    expect(upcoming('Przypomnienie za wąskie')?.reminder).toBe(false);
    expect(upcoming('Bez przypomnienia')?.reminder).toBe(false);

    // po opłaceniu przypomnienie znika
    const paid = await app.inject({ method: 'POST', url: `/api/occurrences/${upcoming('Z przypomnieniem')!.occurrenceId}/pay`, payload: {} });
    expect(paid.statusCode).toBe(200);
    const after = json<DashboardResponse>(await app.inject({ url: `/api/dashboard?month=${monthOf(due)}` }));
    expect(after.upcoming.find((u) => u.name === 'Z przypomnieniem')).toMatchObject({ reminder: false, paid: true });
  });
});

describe('odwołania do cudzych danych', () => {
  const ruleBody = (extra: object) => ({
    name: 'Reguła z obcym odwołaniem', direction: 'expense', categoryId: null, accountId: null, userId: null, payee: null, amount: 1_000, variableAmount: false,
    unit: 'month', interval: 1, startDate: '2034-05-10', dayOfMonth: 10, lastDayOfMonth: false, weekendRule: 'none', endType: 'never',
    endDate: null, endCount: null, remindDaysBefore: null, autoBook: false, note: null, ...extra,
  });
  const txBody = (extra: object) => ({ direction: 'expense', amount: 500, date: '2034-05-11', description: 'Operacja z obcym odwołaniem', categoryId: null, accountId: null, userId: null, note: null, ...extra });

  let foreign: { categoryId: string; accountId: string };
  let own: { categoryId: string; accountId: string };

  beforeAll(async () => {
    const [other] = await connection.db.insert(households).values({ name: 'Obcy dom' }).returning();
    const [category] = await connection.db.insert(categories).values({ householdId: other!.id, name: 'Cudza kategoria' }).returning();
    const [account] = await connection.db.insert(accounts).values({ householdId: other!.id, name: 'Cudze konto', openingDate: '2026-01-01' }).returning();
    foreign = { categoryId: category!.id, accountId: account!.id };
    const ownCategory = json<{ id: string }>(await app.inject({ method: 'POST', url: '/api/categories', payload: { name: 'Moja kategoria do testu odwołań', direction: 'expense' } }));
    const ownAccount = (await app.inject({ url: '/api/options' })).body;
    own = { categoryId: ownCategory.id, accountId: json<OptionsResponse>({ body: ownAccount }).accounts[0]!.id };
  });

  it('operacja: cudza lub nieistniejąca kategoria i konto to 400 z błędem przy polu, i nic się nie zapisuje', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    for (const [field, value] of [['categoryId', foreign.categoryId], ['accountId', foreign.accountId], ['categoryId', missing], ['accountId', missing]] as const) {
      const res = await app.inject({ method: 'POST', url: '/api/transactions', payload: txBody({ [field]: value }) });
      expect(res.statusCode, `${field}=${value}`).toBe(400);
      expect(json<{ errors: Record<string, string> }>(res).errors[field]).toBeDefined();
    }
    const ledger = json<TransactionsResponse>(await app.inject({ url: '/api/transactions?month=2034-05' }));
    expect(ledger.items.map((i) => i.name)).not.toContain('Operacja z obcym odwołaniem');
  });

  it('edycja operacji nie pozwala podmienić odwołania na cudze', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/transactions', payload: txBody({ description: 'Własna operacja', categoryId: own.categoryId, accountId: own.accountId }) });
    expect(created.statusCode).toBe(201);
    const id = json<{ id: string }>(created).id;
    const res = await app.inject({ method: 'PUT', url: `/api/transactions/${id}`, payload: txBody({ description: 'Własna operacja', categoryId: foreign.categoryId }) });
    expect(res.statusCode).toBe(400);
    const ledger = json<TransactionsResponse>(await app.inject({ url: '/api/transactions?month=2034-05' }));
    expect(ledger.items.find((i) => i.name === 'Własna operacja')).toMatchObject({ categoryId: own.categoryId });
  });

  it('płatność cykliczna: cudza kategoria lub konto to 400 przy tworzeniu i edycji', async () => {
    for (const [field, value] of [['categoryId', foreign.categoryId], ['accountId', foreign.accountId]] as const) {
      const res = await app.inject({ method: 'POST', url: '/api/recurring', payload: ruleBody({ [field]: value }) });
      expect(res.statusCode, field).toBe(400);
      expect(json<{ errors: Record<string, string> }>(res).errors[field]).toBeDefined();
    }
    const created = await app.inject({ method: 'POST', url: '/api/recurring', payload: ruleBody({ name: 'Własna reguła', categoryId: own.categoryId, accountId: own.accountId }) });
    expect(created.statusCode).toBe(201);
    const id = json<{ id: string }>(created).id;
    const edit = await app.inject({ method: 'PUT', url: `/api/recurring/${id}`, payload: ruleBody({ name: 'Własna reguła', accountId: foreign.accountId }) });
    expect(edit.statusCode).toBe(400);
    const rules = json<RecurringListResponse>(await app.inject({ url: '/api/recurring' })).rules;
    expect(rules.find((r) => r.name === 'Własna reguła')).toMatchObject({ accountId: own.accountId });
    expect(rules.map((r) => r.name)).not.toContain('Reguła z obcym odwołaniem');
  });

  it('własna kategoria, konto i brak odwołań nadal przechodzą', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/transactions', payload: txBody({ description: 'Poprawna własna', categoryId: own.categoryId, accountId: own.accountId }) })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/api/transactions', payload: txBody({ description: 'Poprawna bez odwołań' }) })).statusCode).toBe(201);
  });
});
