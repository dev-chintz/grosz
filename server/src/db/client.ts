import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.ts';

export type Db = NodePgDatabase<typeof schema>;

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));
const LOCAL_DATA_DIR = fileURLToPath(new URL('../../../.data/pglite', import.meta.url));

export interface Connection {
  db: Db;
  kind: 'postgres' | 'pglite';
  close: () => Promise<void>;
}

/**
 * Produkcja (NAS): DATABASE_URL → PostgreSQL.
 * Development bez DATABASE_URL: PGlite (Postgres w procesie, dane w .data/pglite) —
 * żeby nigdy nie pracować na prawdziwym budżecie i nie potrzebować Dockera lokalnie.
 */
export async function connect(): Promise<Connection> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: url });
    return { db: drizzlePg(pool, { schema }), kind: 'postgres', close: () => pool.end() };
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Brak DATABASE_URL — na produkcji baza lokalna PGlite jest wyłączona.');
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle: drizzlePglite } = await import('drizzle-orm/pglite');
  mkdirSync(LOCAL_DATA_DIR, { recursive: true });
  const client = new PGlite(LOCAL_DATA_DIR);
  // API zapytań jest identyczne; typ z node-postgres upraszcza resztę kodu.
  const db = drizzlePglite(client, { schema }) as unknown as Db;
  return { db, kind: 'pglite', close: () => client.close() };
}
