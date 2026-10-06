import type { FastifyInstance } from 'fastify';
import type { SaveAccountRequest, SaveHouseholdRequest } from '@grosz/shared/api';
import type { Db } from '../db/client.ts';
import { createAccount, getSettings, setAccountArchived, updateAccount, updateHousehold } from '../domain/settings.ts';

const idParams = { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] } as const;

const accountBody = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'openingBalance', 'openingDate'],
  properties: {
    name: { type: 'string' },
    openingBalance: { type: 'integer' },
    openingDate: { type: 'string' },
  },
} as const;

export function registerSettingsRoutes(app: FastifyInstance, db: Db, requireHousehold: () => Promise<string>) {
  app.get('/api/settings', async () => getSettings(db, await requireHousehold()));

  app.put<{ Body: SaveHouseholdRequest }>(
    '/api/settings/household',
    { schema: { body: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string' } } } } },
    async (request) => {
      await updateHousehold(db, await requireHousehold(), request.body);
      return { ok: true };
    },
  );

  app.post<{ Body: SaveAccountRequest }>('/api/accounts', { schema: { body: accountBody } }, async (request, reply) => {
    const id = await createAccount(db, await requireHousehold(), request.body);
    return reply.code(201).send({ id });
  });

  app.put<{ Params: { id: string }; Body: SaveAccountRequest }>('/api/accounts/:id', { schema: { params: idParams, body: accountBody } }, async (request) => {
    await updateAccount(db, await requireHousehold(), request.params.id, request.body);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/accounts/:id/archive', { schema: { params: idParams } }, async (request) => {
    await setAccountArchived(db, await requireHousehold(), request.params.id, true);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/accounts/:id/restore', { schema: { params: idParams } }, async (request) => {
    await setAccountArchived(db, await requireHousehold(), request.params.id, false);
    return { ok: true };
  });
}
