import 'reflect-metadata';
import { container } from 'tsyringe';
import { createDb, type Database } from '../../src/db/index.js';
import { StubOtpProvider } from '../../src/services/otp-provider.js';
import { StubLiveKitService } from '../../src/services/livekit-service.js';
import { StubGoogleOAuthService } from '../../src/services/google-oauth-service.js';
import { StubGoogleCalendarClient } from '../../src/services/google-calendar-client.js';
import { StubFirecrawlService } from '../../src/services/firecrawl-service.js';
import { StubEmbeddingService } from '../../src/services/embedding-service.js';
import { setupContainer } from '../../src/config/container.js';
import { buildApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';

let db: Database | undefined;
let app: FastifyInstance | undefined;
let otpProvider: StubOtpProvider | undefined;

/**
 * Returns a shared test database instance configured to use the "test" schema.
 */
export function getTestDb(): Database {
  if (!db) {
    db = createDb({ searchPath: 'test,public' });
  }
  return db;
}

/**
 * Returns a shared stub OTP provider for assertions.
 */
export function getStubOtpProvider(): StubOtpProvider {
  if (!otpProvider) {
    otpProvider = new StubOtpProvider();
  }
  return otpProvider;
}

/**
 * Builds a test-configured Fastify app with the test database.
 * All external services use stubs to prevent real API calls.
 */
export async function getTestApp(): Promise<FastifyInstance> {
  if (!app) {
    setupContainer({
      db: getTestDb(),
      otpProvider: getStubOtpProvider(),
      livekitService: new StubLiveKitService(),
      googleOAuthService: new StubGoogleOAuthService(),
      googleCalendarClient: new StubGoogleCalendarClient(),
      firecrawlService: new StubFirecrawlService(),
      embeddingService: new StubEmbeddingService(),
    });
    app = await buildApp({ logger: false, dbos: false });
    await app.ready();
  }
  return app;
}

/**
 * Closes the test app. Call in afterAll.
 */
export async function closeTestApp(): Promise<void> {
  if (app) {
    await app.close();
    app = undefined;
  }
  container.clearInstances();
  db = undefined;
  otpProvider = undefined;
}
