// Uruchamiane osobno przed startem nowej wersji (na NAS: `docker compose run --rm migrate`).
// Gdy migracja się nie uda, stara wersja aplikacji działa dalej.

import { connect, MIGRATIONS_FOLDER } from './db/client.ts';

const connection = await connect();
try {
  if (connection.kind === 'pglite') {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    await migrate(connection.db as never, { migrationsFolder: MIGRATIONS_FOLDER });
  } else {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    await migrate(connection.db, { migrationsFolder: MIGRATIONS_FOLDER });
  }
  console.log(`Migracje zastosowane (${connection.kind}).`);
} finally {
  await connection.close();
}
