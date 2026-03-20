import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('instrumentation', () => {
  const originalEnv = { ...process.env };
  let mockStart: ReturnType<typeof vi.fn>;
  let mockShutdown: ReturnType<typeof vi.fn>;
  let mockNodeSDK: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    mockStart = vi.fn();
    mockShutdown = vi.fn();
    mockNodeSDK = vi.fn().mockReturnValue({ start: mockStart, shutdown: mockShutdown });
    vi.doMock('@opentelemetry/sdk-node', () => ({ NodeSDK: mockNodeSDK }));
    vi.doMock('@opentelemetry/exporter-trace-otlp-proto', () => ({ OTLPTraceExporter: vi.fn() }));
    vi.doMock('@opentelemetry/exporter-logs-otlp-proto', () => ({ OTLPLogExporter: vi.fn() }));
    vi.doMock('@opentelemetry/sdk-logs', () => ({ BatchLogRecordProcessor: vi.fn() }));
    vi.doMock('@opentelemetry/resources', () => ({ resourceFromAttributes: vi.fn().mockReturnValue({}) }));
    vi.doMock('@opentelemetry/instrumentation-http', () => ({ HttpInstrumentation: vi.fn() }));
    vi.doMock('@opentelemetry/instrumentation-pino', () => ({ PinoInstrumentation: vi.fn() }));
    vi.doMock('@opentelemetry/instrumentation-fastify', () => ({ FastifyInstrumentation: vi.fn() }));
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('starts SDK when OTEL_EXPORTER_OTLP_ENDPOINT is set', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
    await import('../../src/instrumentation.js');
    expect(mockNodeSDK).toHaveBeenCalledOnce();
    expect(mockStart).toHaveBeenCalledOnce();
  });

  it('skips SDK when OTEL_EXPORTER_OTLP_ENDPOINT is absent', async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await import('../../src/instrumentation.js');
    expect(mockNodeSDK).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledWith('OTLP not configured, skipping\n');
  });

  it('excludes web instrumentations when service name lacks "web"', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
    process.env.OTEL_SERVICE_NAME = 'phonetastic-agent';
    await import('../../src/instrumentation.js');
    const config = mockNodeSDK.mock.calls[0][0];
    expect(config.instrumentations).toEqual([]);
  });

  it('registers SIGTERM handler that calls sdk.shutdown', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
    const listeners: Array<() => void> = [];
    const onSpy = vi.spyOn(process, 'on').mockImplementation((event, fn) => {
      if (event === 'SIGTERM') listeners.push(fn as () => void);
      return process;
    });
    await import('../../src/instrumentation.js');
    expect(listeners).toHaveLength(1);
    listeners[0]();
    expect(mockShutdown).toHaveBeenCalledOnce();
    onSpy.mockRestore();
  });
});
