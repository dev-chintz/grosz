import { asc } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { households } from '../db/schema.ts';

/**
 * Na razie aplikacja ma jedno gospodarstwo i nie ma logowania, więc bierzemy pierwsze.
 * Gdy dojdą konta użytkowników, ta funkcja zacznie czytać gospodarstwo z sesji —
 * reszta kodu już filtruje po householdId i nie będzie wymagała zmian.
 */
export async function currentHouseholdId(db: Db): Promise<string | null> {
  const [first] = await db.select({ id: households.id }).from(households).orderBy(asc(households.createdAt)).limit(1);
  return first?.id ?? null;
}
