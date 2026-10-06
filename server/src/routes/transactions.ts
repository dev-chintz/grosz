import type { FastifyInstance } from 'fastify';
import type { SaveTransactionRequest } from '@grosz/shared/api';
import { today } from '@grosz/shared/dates';
import type { Db } from '../db/client.ts';
import { createTransaction, deleteTransaction, listLedger, updateTransaction } from '../domain/transactions.ts';

const idParams = { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] } as const;
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });

const transactionBody = {
  type: 'object',
  additionalProperties: false,
  required: ['direction', 'amount', 'date', 'description'],
  properties: {
    direction: { enum: ['expense', 'income'] },
    amount: { type: 'integer' },
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    description: { type: 'string' },
    categoryId: nullable({ type: 'string', format: 'uuid' }),
    accountId: nullable({ type: 'string', format: 'uuid' }),
    note: nullable({ type: 'string' }),
  },
} as const;

const withDefaults = (body: SaveTransactionRequest): SaveTransactionRequest => ({
  ...body,
  categoryId: body.categoryId ?? null,
  accountId: body.accountId ?? null,
  note: body.note ?? null,
});

export function registerTransactionRoutes(app: FastifyInstance, db: Db, requireHousehold: () => Promise<string>) {
  app.get<{ Querystring: { month?: string; q?: string } }>(
    '/api/transactions',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { month: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' }, q: { type: 'string', maxLength: 100 } },
        },
      },
    },
    async (request) => listLedger(db, await requireHousehold(), { month: request.query.month ?? null, query: request.query.q ?? null }, today()),
  );

  app.post<{ Body: SaveTransactionRequest }>('/api/transactions', { schema: { body: transactionBody } }, async (request, reply) => {
    const id = await createTransaction(db, await requireHousehold(), withDefaults(request.body));
    return reply.code(201).send({ id });
  });

  app.put<{ Params: { id: string }; Body: SaveTransactionRequest }>(
    '/api/transactions/:id',
    { schema: { params: idParams, body: transactionBody } },
    async (request) => {
      await updateTransaction(db, await requireHousehold(), request.params.id, withDefaults(request.body));
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/transactions/:id', { schema: { params: idParams } }, async (request) => {
    await deleteTransaction(db, await requireHousehold(), request.params.id);
    return { ok: true };
  });
}
