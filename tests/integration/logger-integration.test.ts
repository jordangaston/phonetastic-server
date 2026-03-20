import { describe, it, expect, afterAll } from 'vitest';
import { Writable } from 'stream';
import pino from 'pino';
import Fastify from 'fastify';
import { registerErrorHandler } from '../../src/middleware/error-handler.js';
import { buildApp } from '../../src/app.js';
import { getTestApp, closeTestApp } from '../helpers/test-app.js';
import type { FastifyInstance } from 'fastify';

describe('Fastify logger integration', () => {
  afterAll(async () => {
    await closeTestApp();
  });

  it('starts with a custom Pino logger and logs requests', async () => {
    const { logger, chunks } = createCapturingLogger('test-web');
    const app = Fastify({ loggerInstance: logger });
    app.get('/health', async () => ({ status: 'ok' }));
    await app.ready();

    await app.inject({ method: 'GET', url: '/health' });

    const records = chunks.map((c) => JSON.parse(c));
    const hasRequestLog = records.some((r) => r.reqId !== undefined);
    expect(hasRequestLog).toBe(true);
    await app.close();
  });

  it('starts with logger disabled when false is passed', async () => {
    const app = await getTestApp();

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
  });

  it('logs unhandled errors at error level', async () => {
    const { logger, chunks } = createCapturingLogger('error-test');
    const app = Fastify({ loggerInstance: logger });
    registerErrorHandler(app);
    app.get('/test-500', async () => {
      throw new Error('unexpected');
    });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/test-500' });

    expect(response.statusCode).toBe(500);
    const records = chunks.map((c) => JSON.parse(c));
    const errorLog = records.find((r) => r.level === 50 && r.msg === 'Unhandled error');
    expect(errorLog).toBeDefined();
    expect(errorLog.err.message).toBe('unexpected');
    await app.close();
  });
});

function createCapturingLogger(name: string) {
  const chunks: string[] = [];
  const dest = new Writable({
    write(chunk, _encoding, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return { logger: pino({ name, level: 'info' }, dest), chunks };
}
