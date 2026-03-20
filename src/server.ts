import 'reflect-metadata';
import type { FastifyInstance } from 'fastify';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { setupContainer } from './config/container.js';
import { buildApp } from './app.js';
import { buildDbUrl } from './db/index.js';
import { env } from './config/env.js';
import { createLogger } from './lib/logger.js';
import './workflows/summarize-call.js';
import './workflows/process-inbound-email.js';
import './workflows/store-attachment.js';
import './workflows/send-owner-email.js';
import './workflows/update-chat-summary.js';
import './workflows/setup-subdomain.js';

let app: FastifyInstance;

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  await app.close();
  await DBOS.shutdown();
  process.exit(0);
}

const logger = createLogger('web');

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

async function main() {
  setupContainer();

  DBOS.setConfig({
    name: 'phonetastic',
    databaseUrl: buildDbUrl(),
    runAdminServer: false,
  });

  app = await buildApp({ logger });
  await DBOS.launch();
  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
