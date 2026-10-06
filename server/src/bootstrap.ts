// Zakłada pusty budżet na świeżej bazie (na NAS po migracjach: `docker compose run --rm migrate node server/src/bootstrap.ts`).
// Idempotentne: gdy gospodarstwo już istnieje, nic nie robi. Dane przykładowe to osobny skrypt (`db:seed`).

import { today } from '@grosz/shared/dates';
import { connect } from './db/client.ts';
import { bootstrapBudget } from './domain/bootstrap.ts';

const connection = await connect();
try {
  const created = await bootstrapBudget(connection.db, today());
  console.log(created ? 'Założono pusty budżet (gospodarstwo, konto, domyślne kategorie).' : 'Budżet już istnieje — nic nie zmieniam.');
} finally {
  await connection.close();
}
