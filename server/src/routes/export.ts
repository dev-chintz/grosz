import type { FastifyInstance } from 'fastify';
import { today } from '@grosz/shared/dates';
import { ledgerToCsv } from '@grosz/shared/export';
import { isCalendarDate } from '@grosz/shared/settings';
import type { Db } from '../db/client.ts';
import { buildBackup, exportLedger } from '../domain/export.ts';

const isoDate = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;

export function registerExportRoutes(app: FastifyInstance, db: Db, requireHousehold: () => Promise<string>) {
  app.get('/api/export/backup', async (_request, reply) => {
    const now = new Date();
    const backup = await buildBackup(db, await requireHousehold(), now);
    return reply
      .header('content-disposition', `attachment; filename="grosz-kopia-${today()}.json"`)
      .header('cache-control', 'no-store')
      .type('application/json; charset=utf-8')
      .send(JSON.stringify(backup, null, 2));
  });

  app.get<{ Querystring: { from?: string; to?: string } }>(
    '/api/export/transactions',
    { schema: { querystring: { type: 'object', additionalProperties: false, properties: { from: isoDate, to: isoDate } } } },
    async (request, reply) => {
      const from = request.query.from ?? null;
      const to = request.query.to ?? null;
      if ((from && !isCalendarDate(from)) || (to && !isCalendarDate(to))) return reply.code(400).send({ error: 'Podaj poprawne daty zakresu.' });
      if (from && to && from > to) return reply.code(400).send({ error: 'Data „od” nie może być późniejsza niż „do”.' });

      const items = await exportLedger(db, await requireHousehold(), { from, to }, today());
      return reply
        .header('content-disposition', `attachment; filename="grosz-operacje-${from ?? 'poczatek'}_${to ?? 'koniec'}.csv"`)
        .header('cache-control', 'no-store')
        .type('text/csv; charset=utf-8')
        .send(ledgerToCsv(items));
    },
  );
}
