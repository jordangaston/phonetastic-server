import 'reflect-metadata';
import type { FastifyInstance } from 'fastify';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { setupContainer } from './config/container.js';
import { buildApp } from './app.js';
import { buildDbUrl } from './db/index.js';
import { env } from './config/env.js';
import './workflows/summarize-call.js';

let app: FastifyInstance;

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  await app.close();
  await DBOS.shutdown();
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

async function main() {
  setupContainer();

  DBOS.setConfig({
    name: 'phonetastic',
    databaseUrl: buildDbUrl(),
    runAdminServer: false,
  });

  app = await buildApp();
  await DBOS.launch();
  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
