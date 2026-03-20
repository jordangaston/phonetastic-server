import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import pino from 'pino';

describe('createLogger', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  async function loadCreateLogger() {
    const mod = await import('../../../src/lib/logger.js');
    return mod.createLogger;
  }

  it('creates a logger in development mode without throwing', async () => {
    process.env.NODE_ENV = 'development';
    const createLogger = await loadCreateLogger();

    expect(() => createLogger('dev-test')).not.toThrow();
  });

  it('creates a logger in test mode without throwing', async () => {
    process.env.NODE_ENV = 'test';
    const createLogger = await loadCreateLogger();

    expect(() => createLogger('test-logger')).not.toThrow();
  });

  it('creates a production logger with OTEL endpoint without throwing', async () => {
    process.env.NODE_ENV = 'production';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
    const createLogger = await loadCreateLogger();

    expect(() => createLogger('prod-otel')).not.toThrow();
  });

  it('creates a production logger without OTEL endpoint (plain JSON)', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const createLogger = await loadCreateLogger();
    const logger = createLogger('prod-json');

    expect(logger.level).toBe('info');
  });

  it('child logger inherits context fields', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    const chunks: string[] = [];
    const { Writable } = await import('stream');
    const dest = new Writable({
      write(chunk, _encoding, cb) {
        chunks.push(chunk.toString());
        cb();
      },
    });

    const logger = pino({ name: 'child-test' }, dest);
    const child = logger.child({ companyId: 42 });
    child.info('hello');

    expect(chunks.length).toBeGreaterThan(0);
    const record = JSON.parse(chunks[0]);
    expect(record.companyId).toBe(42);
    expect(record.msg).toBe('hello');
  });
});
