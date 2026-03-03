import 'reflect-metadata';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { AgentServer, ServerOptions, initializeLogger } from '@livekit/agents';
import { setupContainer } from './config/container.js';
import { buildApp } from './app.js';
import { buildDbUrl } from './db/index.js';
import { env } from './config/env.js';
import { AGENT_NAME } from './services/livekit-service.js';

let app: FastifyInstance;
let agentServer: AgentServer | undefined;

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  if (agentServer) await agentServer.close();
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
  agentServer = await startAgentServer();
}

async function startAgentServer(): Promise<AgentServer> {
  initializeLogger({ pretty: true, level: 'info' });
  const agentPath = path.resolve(__dirname, 'agent.js');
  const server = new AgentServer(new ServerOptions({
    agent: agentPath,
    agentName: AGENT_NAME,
    wsURL: env.LIVEKIT_URL!,
    apiKey: env.LIVEKIT_API_KEY,
    apiSecret: env.LIVEKIT_API_SECRET,
  }));
  await server.run();
  return server;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
