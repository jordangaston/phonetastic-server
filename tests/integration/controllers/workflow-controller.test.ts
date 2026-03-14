import 'reflect-metadata';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { container } from 'tsyringe';
import { createDb, type Database } from '../../../src/db/index.js';
import { StubOtpProvider } from '../../../src/services/otp-provider.js';
import { setupContainer } from '../../../src/config/container.js';
import { buildApp } from '../../../src/app.js';
import { cleanDatabase } from '../../helpers/db-cleaner.js';
import { createTestUser } from '../../helpers/auth-helper.js';
import { env } from '../../../src/config/env.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let db: Database;

beforeAll(async () => {
  db = createDb({ searchPath: 'test,public' });
  setupContainer({ db, otpProvider: new StubOtpProvider() });

  const auth = env.DB_PASSWORD ? `${env.DB_USER}:${env.DB_PASSWORD}` : env.DB_USER;
  const dbUrl = `postgresql://${auth}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_DATABASE}`;

  DBOS.setConfig({
    name: 'phonetastic-test',
    databaseUrl: dbUrl,
    runAdminServer: false,
  });

  app = await buildApp({ logger: false, dbos: true });
  await DBOS.launch();
  await app.ready();
}, 30000);

beforeEach(async () => {
  await cleanDatabase(db);
});

afterAll(async () => {
  await DBOS.shutdown();
  await app.close();
  container.clearInstances();
}, 60000);

describe('Workflow Controller', () => {
  describe('POST /v1/workflows', () => {
    it('starts a company_onboarding workflow and returns 202', async () => {
      const { accessToken } = await createTestUser(app);
      const response = await app.inject({
        method: 'POST',
        url: '/v1/workflows',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          workflow: {
            type: 'company_onboarding',
            params: { website: 'https://example.com' },
          },
        },
      });

      expect(response.statusCode).toBe(202);
      const body = response.json();
      expect(body.workflow.id).toBeDefined();
      expect(body.workflow.status).toBeDefined();
    });

    it('returns 400 for unknown workflow type', async () => {
      const { accessToken } = await createTestUser(app);
      const response = await app.inject({
        method: 'POST',
        url: '/v1/workflows',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          workflow: { type: 'unknown', params: {} },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/workflows',
        payload: {
          workflow: {
            type: 'company_onboarding',
            params: { website: 'https://example.com' },
          },
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /v1/workflows/:id/status', () => {
    it('returns workflow status after creation', async () => {
      const { accessToken } = await createTestUser(app);

      const createResponse = await app.inject({
        method: 'POST',
        url: '/v1/workflows',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          workflow: {
            type: 'company_onboarding',
            params: { website: 'https://example.com' },
          },
        },
      });

      const workflowId = createResponse.json().workflow.id;

      const statusResponse = await app.inject({
        method: 'GET',
        url: `/v1/workflows/${workflowId}/status`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(statusResponse.statusCode).toBe(200);
      expect(statusResponse.json().workflow.id).toBe(workflowId);
    });

    it('returns 404 for nonexistent workflow', async () => {
      const { accessToken } = await createTestUser(app);
      const response = await app.inject({
        method: 'GET',
        url: '/v1/workflows/nonexistent-id/status',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
