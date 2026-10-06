import { existsSync } from 'node:fs';
import { registerAuth } from './routes/auth.ts';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { sql } from 'drizzle-orm';
import { today } from '@grosz/shared/dates';
import type { Connection } from './db/client.ts';
import { buildCalendar } from './domain/calendar.ts';
import { buildDashboard } from './domain/dashboard.ts';
import { currentHouseholdId } from './domain/household.ts';
import { setOccurrencePaid } from './domain/rules.ts';
import { registerCategoryRoutes } from './routes/categories.ts';
import { registerExportRoutes } from './routes/export.ts';
import { registerReportRoutes } from './routes/reports.ts';
import { registerSettingsRoutes } from './routes/settings.ts';
import { registerRecurringRoutes } from './routes/recurring.ts';
import { registerTransactionRoutes } from './routes/transactions.ts';

const WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));

export function buildApp(connection: Connection) {
  const { db } = connection;
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    // Domyślnie Fastify „dopasowuje” typy i zamienia null na 0 w polach liczbowych —
    // wtedy „bez limitu” albo „bez przypomnienia” zapisałoby się jako 0. Dane przyjmujemy dokładnie takie, jakie przyszły.
    ajv: { customOptions: { coerceTypes: false } },
  });
  // Logowanie najpierw: hak onRequest musi obejmować wszystkie trasy /api/*.
  registerAuth(app, db);

  const requireHousehold = async () => {
    const id = await currentHouseholdId(db);
    if (!id) throw Object.assign(new Error('Brak gospodarstwa — uruchom `npm run db:seed` albo załóż budżet.'), { statusCode: 409 });
    return id;
  };

  app.get('/api/health', async () => {
    await db.execute(sql`select 1`);
    return { ok: true, db: connection.kind };
  });

  app.get<{ Querystring: { month?: string } }>(
    '/api/dashboard',
    { schema: { querystring: { type: 'object', properties: { month: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' } } } } },
    async (request) => {
      const now = today();
      return buildDashboard(db, await requireHousehold(), request.query.month ?? now.slice(0, 7), now);
    },
  );

  app.get<{ Querystring: { month?: string } }>(
    '/api/calendar',
    { schema: { querystring: { type: 'object', properties: { month: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' } } } } },
    async (request) => {
      const now = today();
      return buildCalendar(db, await requireHousehold(), request.query.month ?? now.slice(0, 7), now);
    },
  );

  app.post<{ Params: { id: string }; Body: { amount?: number } | undefined }>(
    '/api/occurrences/:id/pay',
    {
      schema: {
        params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
        body: { type: ['object', 'null'], properties: { amount: { type: 'integer', minimum: 0 } } },
      },
    },
    async (request, reply) => {
      const ok = await setOccurrencePaid(db, await requireHousehold(), request.params.id, { on: today(), amount: request.body?.amount });
      return ok ? { ok } : reply.code(404).send({ error: 'Nie znaleziono płatności.' });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/occurrences/:id/unpay',
    { schema: { params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] } } },
    async (request, reply) => {
      const ok = await setOccurrencePaid(db, await requireHousehold(), request.params.id, null);
      return ok ? { ok } : reply.code(404).send({ error: 'Nie znaleziono płatności.' });
    },
  );

  registerRecurringRoutes(app, db, requireHousehold);
  registerTransactionRoutes(app, db, requireHousehold);
  registerCategoryRoutes(app, db, requireHousehold);
  registerReportRoutes(app, db, requireHousehold);
  registerSettingsRoutes(app, db, requireHousehold);
  registerExportRoutes(app, db, requireHousehold);

  app.setErrorHandler((error: Error & { statusCode?: number; errors?: unknown; validation?: unknown }, _request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) app.log.error(error);
    return reply.code(status).send({
      error: status >= 500 ? 'Wewnętrzny błąd serwera.' : error.validation ? 'Nieprawidłowe dane w zapytaniu.' : error.message,
      // Błędy walidacji domeny (i logowania) niosą komunikaty per pole.
      ...(status < 500 && error.errors ? { errors: error.errors } : {}),
    });
  });

  // Zbudowany frontend (produkcja). W developmencie serwuje go Vite.
  if (existsSync(WEB_DIST)) {
    app.register(fastifyStatic, { root: WEB_DIST });
    app.setNotFoundHandler((request, reply) => {
      // Ścieżki ekranów (/cykliczne) dostają index.html; brakujące pliki (np. stary .js po wdrożeniu) — 404.
      const path = request.url.split('?')[0]!;
      const isPage = !path.startsWith('/api/') && !/\.[a-z0-9]+$/i.test(path);
      if (request.method === 'GET' && isPage) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'Nie znaleziono.' });
    });
  }

  return app;
}
