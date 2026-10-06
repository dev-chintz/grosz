import type { FastifyInstance } from 'fastify';
import type { SaveRuleRequest } from '@grosz/shared/api';
import { today } from '@grosz/shared/dates';
import type { Db } from '../db/client.ts';
import { createRule, deleteRule, listOptions, listRules, pauseRule, resumeRule, updateRule } from '../domain/recurring.ts';

const idParams = { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] } as const;
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });

// Kształt sprawdza Fastify; reguły biznesowe (np. koniec po starcie) — validateRuleInput w domenie.
const ruleBody = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'direction', 'amount', 'unit', 'interval', 'startDate', 'weekendRule', 'endType'],
  properties: {
    name: { type: 'string' },
    direction: { enum: ['expense', 'income'] },
    categoryId: nullable({ type: 'string', format: 'uuid' }),
    accountId: nullable({ type: 'string', format: 'uuid' }),
    userId: nullable({ type: 'string', format: 'uuid' }),
    payee: nullable({ type: 'string', maxLength: 200 }),
    amount: { type: 'integer' },
    variableAmount: { type: 'boolean', default: false },
    unit: { enum: ['day', 'week', 'month', 'year'] },
    interval: { type: 'integer' },
    startDate: date,
    dayOfMonth: nullable({ type: 'integer' }),
    lastDayOfMonth: { type: 'boolean', default: false },
    weekendRule: { enum: ['next', 'previous', 'none'] },
    endType: { enum: ['never', 'until', 'count'] },
    endDate: nullable(date),
    endCount: nullable({ type: 'integer' }),
    remindDaysBefore: nullable({ type: 'integer' }),
    autoBook: { type: 'boolean', default: false },
    note: nullable({ type: 'string', maxLength: 2000 }),
    applyFrom: date,
  },
} as const;

export function registerRecurringRoutes(app: FastifyInstance, db: Db, requireHousehold: () => Promise<string>) {
  app.get('/api/options', async () => listOptions(db, await requireHousehold()));

  app.get('/api/recurring', async () => listRules(db, await requireHousehold(), today()));

  app.post<{ Body: SaveRuleRequest }>('/api/recurring', { schema: { body: ruleBody } }, async (request, reply) => {
    const id = await createRule(db, await requireHousehold(), withDefaults(request.body), today());
    return reply.code(201).send({ id });
  });

  app.put<{ Params: { id: string }; Body: SaveRuleRequest }>(
    '/api/recurring/:id',
    { schema: { params: idParams, body: ruleBody } },
    async (request) => {
      await updateRule(db, await requireHousehold(), request.params.id, withDefaults(request.body), today());
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string } }>('/api/recurring/:id/pause', { schema: { params: idParams } }, async (request) => {
    await pauseRule(db, await requireHousehold(), request.params.id, today());
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/recurring/:id/resume', { schema: { params: idParams } }, async (request) => {
    await resumeRule(db, await requireHousehold(), request.params.id, today());
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/recurring/:id', { schema: { params: idParams } }, async (request) => {
    await deleteRule(db, await requireHousehold(), request.params.id);
    return { ok: true };
  });
}

/** Pola opcjonalne w JSON → null, żeby domena dostawała pełny RuleInput. */
function withDefaults(body: SaveRuleRequest): SaveRuleRequest {
  return {
    ...body,
    categoryId: body.categoryId ?? null,
    accountId: body.accountId ?? null,
    userId: body.userId ?? null,
    payee: body.payee ?? null,
    dayOfMonth: body.dayOfMonth ?? null,
    endDate: body.endDate ?? null,
    endCount: body.endCount ?? null,
    remindDaysBefore: body.remindDaysBefore ?? null,
    note: body.note ?? null,
  };
}
