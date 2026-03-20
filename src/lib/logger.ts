import pino, { type Logger, type TransportTargetOptions } from 'pino';

/**
 * Creates a named Pino logger configured for the current environment.
 *
 * @param name - Identifier that appears in every log record (e.g. `"server"`, `"email-worker"`).
 *
 * @returns A {@link Logger} instance. Call `.child({ key: value })` to add context fields.
 *
 * Environment behaviour:
 * - `NODE_ENV=production` with `OTEL_EXPORTER_OTLP_ENDPOINT` set — logs are shipped
 *   to the OTLP endpoint via `pino-opentelemetry-transport`.
 * - `NODE_ENV=production` without `OTEL_EXPORTER_OTLP_ENDPOINT` — plain JSON to stdout.
 * - `NODE_ENV=development` or `NODE_ENV=test` — human-readable output via `pino-pretty`.
 *
 * Log level is read from `process.env.LOG_LEVEL` (default: `"info"`).
 */
export function createLogger(name: string): Logger {
  const level = process.env.LOG_LEVEL ?? 'info';
  const transport = resolveTransport();

  return pino({ name, level, ...(transport ? { transport } : {}) });
}

function resolveTransport(): pino.TransportSingleOptions | undefined {
  const env = process.env.NODE_ENV;

  if (env === 'production') return productionTransport();
  if (env === 'development' || env === 'test') return prettyTransport();
  return undefined;
}

function productionTransport(): pino.TransportSingleOptions | undefined {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return undefined;

  return { target: 'pino-opentelemetry-transport' };
}

function prettyTransport(): pino.TransportSingleOptions {
  return { target: 'pino-pretty', options: { colorize: process.env.NODE_ENV !== 'test' } };
}
