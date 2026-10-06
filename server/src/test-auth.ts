// Tylko dla testów: loguje aplikację testową, żeby istniejące testy API nie musiały dokładać ciasteczka do każdego wywołania.

import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { hashPassword } from './auth/password.ts';
import type { Connection } from './db/client.ts';
import { households, users } from './db/schema.ts';
import { createSession, SESSION_COOKIE } from './domain/auth.ts';

export const TEST_LOGIN = 'tester';
export const TEST_PASSWORD = 'haslo-testowe-123';

/** Nadaje pierwszej osobie pierwszego gospodarstwa login i hasło, tworzy sesję i dokleja ciasteczko do app.inject. */
export async function signIn(app: FastifyInstance, connection: Connection): Promise<string> {
  const { db } = connection;
  const [household] = await db.select({ id: households.id }).from(households).orderBy(asc(households.createdAt)).limit(1);
  if (!household) throw new Error('signIn: brak gospodarstwa w bazie testowej');
  let [user] = await db.select({ id: users.id }).from(users).where(eq(users.householdId, household.id)).orderBy(asc(users.createdAt)).limit(1);
  if (!user) {
    // Bez domowników w teście konto zakładamy w osobnym gospodarstwie, żeby nie zmieniać list osób, które testy sprawdzają.
    const [aside] = await db.insert(households).values({ name: 'Konto testowe' }).returning({ id: households.id });
    [user] = await db.insert(users).values({ householdId: aside!.id, name: 'Tester' }).returning({ id: users.id });
  }
  await db.update(users).set({ login: TEST_LOGIN, passwordHash: await hashPassword(TEST_PASSWORD) }).where(eq(users.id, user!.id));
  const cookie = `${SESSION_COOKIE}=${await createSession(db, user!.id)}`;

  const inject = app.inject.bind(app);
  (app as unknown as { inject: (o: InjectOptions | string) => Promise<unknown> }).inject = (options) =>
    typeof options === 'string'
      ? inject({ url: options, headers: { cookie } })
      : inject({ ...options, headers: { cookie, ...(options.headers ?? {}) } });
  return cookie;
}
