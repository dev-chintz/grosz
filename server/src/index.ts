import { buildApp } from './app.ts';
import { connect } from './db/client.ts';

const connection = await connect();
const app = buildApp(connection);

const shutdown = async () => {
  await app.close();
  await connection.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '0.0.0.0' });
