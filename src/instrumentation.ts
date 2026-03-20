import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify';

/**
 * Returns the service name from `OTEL_SERVICE_NAME`, falling back to `"phonetastic"`.
 *
 * @returns The configured service name string.
 */
export function serviceName(): string {
  return process.env.OTEL_SERVICE_NAME ?? 'phonetastic';
}

/**
 * Returns `true` when the current service name contains `"web"`.
 *
 * @remarks
 * HTTP / Fastify instrumentations are only useful for the web process,
 * not for background agents.
 *
 * @returns Whether web-specific instrumentations should be enabled.
 */
export function isWebProcess(): boolean {
  return serviceName().includes('web');
}

/**
 * Builds the array of OpenTelemetry instrumentations for the current process.
 *
 * @remarks
 * `HttpInstrumentation`, `PinoInstrumentation`, and `FastifyInstrumentation`
 * are included only when {@link isWebProcess} returns `true`.
 *
 * @returns An array of OTEL instrumentation instances.
 */
export function buildInstrumentations() {
  if (!isWebProcess()) return [];
  return [new HttpInstrumentation(), new PinoInstrumentation(), new FastifyInstrumentation()];
}

/**
 * Initializes the OpenTelemetry NodeSDK and registers a SIGTERM shutdown hook.
 *
 * @remarks
 * If `OTEL_EXPORTER_OTLP_ENDPOINT` is not set, logs a skip message to stderr
 * and returns `undefined` without starting the SDK.
 *
 * @returns The started `NodeSDK` instance, or `undefined` if OTLP is not configured.
 */
export function initTelemetry(): NodeSDK | undefined {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    process.stderr.write('OTLP not configured, skipping\n');
    return undefined;
  }
  const sdk = createSdk();
  sdk.start();
  process.on('SIGTERM', () => sdk.shutdown());
  return sdk;
}

/**
 * Creates a configured `NodeSDK` instance with trace and log exporters.
 *
 * @returns A new `NodeSDK` ready to be started.
 */
export function createSdk(): NodeSDK {
  return new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    logRecordProcessor: new BatchLogRecordProcessor(new OTLPLogExporter()),
    instrumentations: buildInstrumentations(),
    resource: resourceFromAttributes({ 'service.name': serviceName() }),
  });
}

initTelemetry();
