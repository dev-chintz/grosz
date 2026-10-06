import type { FastifyInstance } from 'fastify';
import { today } from '@grosz/shared/dates';
import type { Db } from '../db/client.ts';
import { buildReport } from '../domain/reports.ts';

export function registerReportRoutes(app: FastifyInstance, db: Db, requireHousehold: () => Promise<string>) {
  app.get<{ Querystring: { month?: string; months?: '3' | '6' | '12' } }>(
    '/api/reports',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            month: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' },
            months: { enum: ['3', '6', '12'] },
          },
        },
      },
    },
    async (request) => {
      const now = today();
      return buildReport(db, await requireHousehold(), request.query.month ?? now.slice(0, 7), Number(request.query.months ?? 6), now);
    },
  );
}
