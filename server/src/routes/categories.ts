import type { FastifyInstance } from 'fastify';
import type { SaveCategoryRequest } from '@grosz/shared/api';
import { today } from '@grosz/shared/dates';
import type { Db } from '../db/client.ts';
import { createCategory, deleteCategory, listCategories, reorderCategories, updateCategory } from '../domain/categories.ts';

const uuid = { type: 'string', format: 'uuid' } as const;
const idParams = { type: 'object', properties: { id: uuid }, required: ['id'] } as const;
const limit = { anyOf: [{ type: 'integer' }, { type: 'null' }] } as const;

export function registerCategoryRoutes(app: FastifyInstance, db: Db, requireHousehold: () => Promise<string>) {
  app.get<{ Querystring: { month?: string } }>(
    '/api/categories',
    { schema: { querystring: { type: 'object', properties: { month: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' } } } } },
    async (request) => {
      const now = today();
      return listCategories(db, await requireHousehold(), request.query.month ?? now.slice(0, 7), now);
    },
  );

  app.post<{ Body: SaveCategoryRequest }>(
    '/api/categories',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'direction'],
          properties: { name: { type: 'string' }, direction: { enum: ['expense', 'income'] }, monthlyLimit: limit },
        },
      },
    },
    async (request, reply) => {
      const id = await createCategory(db, await requireHousehold(), { ...request.body, monthlyLimit: request.body.monthlyLimit ?? null });
      return reply.code(201).send({ id });
    },
  );

  app.put<{ Params: { id: string }; Body: { name: string; monthlyLimit?: number | null } }>(
    '/api/categories/:id',
    {
      schema: {
        params: idParams,
        body: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string' }, monthlyLimit: limit } },
      },
    },
    async (request) => {
      await updateCategory(db, await requireHousehold(), request.params.id, { name: request.body.name, monthlyLimit: request.body.monthlyLimit ?? null });
      return { ok: true };
    },
  );

  app.post<{ Body: { ids: string[] } }>(
    '/api/categories/reorder',
    { schema: { body: { type: 'object', required: ['ids'], properties: { ids: { type: 'array', items: uuid, minItems: 1, maxItems: 200 } } } } },
    async (request) => {
      await reorderCategories(db, await requireHousehold(), request.body.ids);
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string }; Querystring: { moveTo?: string } }>(
    '/api/categories/:id',
    { schema: { params: idParams, querystring: { type: 'object', properties: { moveTo: uuid } } } },
    async (request) => {
      await deleteCategory(db, await requireHousehold(), request.params.id, request.query.moveTo ?? null);
      return { ok: true };
    },
  );
}
