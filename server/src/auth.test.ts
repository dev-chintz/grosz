// Logowanie: pierwsze uruchomienie z kodem, logowanie, blokada po nieudanych próbach, wylogowanie, zmiana hasła.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { buildApp } from './app.ts';
import { connectPglite, MIGRATIONS_FOLDER, type Connection } from './db/client.ts';
import { issueSetupCode, resetLoginFailures, SESSION_COOKIE } from './domain/auth.ts';
import { bootstrapBudget } from './domain/bootstrap.ts';

let connection: Connection;
let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
  connection = await connectPglite();
  await migrate(connection.db as never, { migrationsFolder: MIGRATIONS_FOLDER });
  await bootstrapBudget(connection.db, '2026-10-07');
  app = buildApp(connection);
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app.close();
  await connection.close();
});

beforeEach(() => resetLoginFailures());

const cookieFrom = (res: { headers: Record<string, unknown> }) => String(res.headers['set-cookie'] ?? '').split(';')[0]!;
const body = (res: { body: string }) => JSON.parse(res.body);
const credentials = { name: 'Ania', login: 'Ania', password: 'bardzo-tajne-1' };

describe('logowanie', () => {
  it('bez sesji API odpowiada 401, a health działa', async () => {
    expect((await app.inject({ url: '/api/dashboard' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/health' })).statusCode).toBe(200);
  });

  it('pierwsze uruchomienie wymaga właściwego kodu', async () => {
    issueSetupCode();
    const res = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { ...credentials, code: 'ZZZZ-ZZZZ' } });
    expect(res.statusCode).toBe(400);
    expect(body(res).errors.code).toMatch(/kod/i);
  });

  it('z kodem zakłada konto na osobie „Ja”, loguje i drugi raz już nie pozwala', async () => {
    const code = issueSetupCode();
    const res = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { ...credentials, code: code.toLowerCase() } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toMatch(new RegExp(`^${SESSION_COOKIE}=.+HttpOnly; SameSite=Strict`));
    const status = body(await app.inject({ url: '/api/auth/status', headers: { cookie: cookieFrom(res) } }));
    expect(status).toMatchObject({ authenticated: true, setupRequired: false, user: { name: 'Ania', login: 'ania' } });
    const settings = body(await app.inject({ url: '/api/settings', headers: { cookie: cookieFrom(res) } }));
    expect(settings.members).toHaveLength(1);

    const again = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { ...credentials, code: issueSetupCode() } });
    expect(again.statusCode).toBe(409);
  });

  it('złe hasło: 401 bez zdradzania, czy login istnieje; po 5 próbach blokada nawet dla dobrego hasła', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'ania', password: 'zle-haslo-xx' } });
      expect(res.statusCode).toBe(401);
      expect(body(res).error).toBe('Nieprawidłowy login lub hasło.');
    }
    const locked = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'ania', password: credentials.password } });
    expect(locked.statusCode).toBe(429);
  });

  it('logowanie, wylogowanie unieważnia sesję', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: ' ANIA ', password: credentials.password } });
    expect(res.statusCode).toBe(200);
    const cookie = cookieFrom(res);
    expect((await app.inject({ url: '/api/dashboard', headers: { cookie } })).statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect((await app.inject({ url: '/api/dashboard', headers: { cookie } })).statusCode).toBe(401);
  });

  it('zmiana hasła wymaga obecnego i wylogowuje inne urządzenia', async () => {
    const login = () => app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'ania', password: credentials.password } });
    const here = cookieFrom(await login());
    const other = cookieFrom(await login());
    const wrong = await app.inject({ method: 'POST', url: '/api/auth/password', headers: { cookie: here }, payload: { current: 'nie-to', next: 'nowe-haslo-123' } });
    expect(body(wrong).errors.current).toBeDefined();
    const ok = await app.inject({ method: 'POST', url: '/api/auth/password', headers: { cookie: here }, payload: { current: credentials.password, next: 'nowe-haslo-123' } });
    expect(ok.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/dashboard', headers: { cookie: here } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/dashboard', headers: { cookie: other } })).statusCode).toBe(401);
  });
});
