import type { FastifyInstance } from 'fastify';
import type { ImportCommitRequest } from '@grosz/shared/api';
import type { ImportRow } from '@grosz/shared/import';
import type { Db } from '../db/client.ts';
import { commitImport, listImportBatches, previewImport, undoImportBatch } from '../domain/import.ts';

const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;
const uuid = { type: 'string', format: 'uuid' } as const;
const nullableUuid = { anyOf: [uuid, { type: 'null' }] } as const;
const rowBase = {
  key: { type: 'string', minLength: 1, maxLength: 1000 },
  date,
  direction: { enum: ['expense', 'income'] },
  amount: { type: 'integer', minimum: 1, maximum: 10_000_000_000 },
  description: { type: 'string', minLength: 1, maxLength: 200 },
} as const;

export function registerImportRoutes(app: FastifyInstance, db: Db, requireHousehold: () => Promise<string>) {
  app.post<{ Body: { rows: ImportRow[] } }>(
    '/api/import/preview',
    {
      bodyLimit: 5 * 1024 * 1024,
      schema: {
        body: {
          type: 'object',
          required: ['rows'],
          properties: {
            rows: {
              type: 'array',
              maxItems: 5000,
              items: { type: 'object', required: ['key', 'date', 'direction', 'amount', 'description', 'merchant'], properties: { ...rowBase, merchant: { type: 'string', maxLength: 200 } } },
            },
          },
        },
      },
    },
    async (request) => ({ rows: await previewImport(db, await requireHousehold(), request.body.rows) }),
  );

  app.post<{ Body: ImportCommitRequest }>(
    '/api/import/commit',
    {
      bodyLimit: 5 * 1024 * 1024,
      schema: {
        body: {
          type: 'object',
          required: ['bank', 'fileName', 'accountId', 'rows'],
          properties: {
            bank: { type: 'string', maxLength: 40 },
            fileName: { type: 'string', maxLength: 300 },
            accountId: nullableUuid,
            rows: {
              type: 'array',
              maxItems: 5000,
              items: {
                type: 'object',
                required: ['key', 'date', 'direction', 'amount', 'description', 'categoryId', 'action', 'occurrenceId'],
                properties: { ...rowBase, categoryId: nullableUuid, action: { enum: ['create', 'match', 'skip'] }, occurrenceId: nullableUuid },
              },
            },
          },
        },
      },
    },
    async (request) => commitImport(db, await requireHousehold(), request.body),
  );

  app.get('/api/import/batches', async () => listImportBatches(db, await requireHousehold()));

  app.delete<{ Params: { id: string } }>(
    '/api/import/batches/:id',
    { schema: { params: { type: 'object', properties: { id: uuid }, required: ['id'] } } },
    async (request) => {
      await undoImportBatch(db, await requireHousehold(), request.params.id);
      return { ok: true };
    },
  );
}
