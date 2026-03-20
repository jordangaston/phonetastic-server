import { describe, it, expect, beforeAll } from 'vitest';
import type { z } from 'zod';

let envSchema: z.ZodObject<any>;

beforeAll(async () => {
  process.env.APP_KEY = 'test-key';
  const mod = await import('../../../src/config/env.js');
  envSchema = mod.envSchema;
});

const validBase = { APP_KEY: 'test-key' };

describe('envSchema OTEL variables', () => {
  it('accepts valid OTEL env vars', () => {
    const result = envSchema.parse({
      ...validBase,
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel.example.com:4318',
      OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer token123',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc',
      OTEL_SERVICE_NAME: 'my-service',
    });

    expect(result.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('https://otel.example.com:4318');
    expect(result.OTEL_EXPORTER_OTLP_HEADERS).toBe('Authorization=Bearer token123');
    expect(result.OTEL_EXPORTER_OTLP_PROTOCOL).toBe('grpc');
    expect(result.OTEL_SERVICE_NAME).toBe('my-service');
  });

  it('uses defaults when OTEL vars are missing', () => {
    const result = envSchema.parse(validBase);

    expect(result.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
    expect(result.OTEL_EXPORTER_OTLP_HEADERS).toBeUndefined();
    expect(result.OTEL_EXPORTER_OTLP_PROTOCOL).toBe('http/protobuf');
    expect(result.OTEL_SERVICE_NAME).toBe('phonetastic');
  });

  it('rejects an invalid endpoint URL', () => {
    expect(() =>
      envSchema.parse({ ...validBase, OTEL_EXPORTER_OTLP_ENDPOINT: 'not-a-url' }),
    ).toThrow();
  });

  it('rejects an invalid protocol', () => {
    expect(() =>
      envSchema.parse({ ...validBase, OTEL_EXPORTER_OTLP_PROTOCOL: 'websocket' }),
    ).toThrow();
  });
});
