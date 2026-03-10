import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { getTestApp, getTestDb, closeTestApp } from '../../helpers/test-app.js';
import { cleanDatabase } from '../../helpers/db-cleaner.js';
import { createTestUser } from '../../helpers/auth-helper.js';
import type { FastifyInstance } from 'fastify';

describe('Call Settings Controller', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await getTestApp();
  });

  beforeEach(async () => {
    await cleanDatabase(getTestDb());
  });

  afterAll(async () => {
    await closeTestApp();
  });

  describe('PATCH /v1/call_settings', () => {
    it('updates call settings for authenticated user', async () => {
      const { accessToken } = await createTestUser(app);

      const response = await app.inject({
        method: 'PATCH',
        url: '/v1/call_settings',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          call_settings: {
            is_bot_enabled: true,
            rings_before_bot_answer: 3,
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.call_settings.is_bot_enabled).toBe(true);
      expect(body.call_settings.rings_before_bot_answer).toBe(3);
      expect(body.call_settings.answer_calls_from).toBe('everyone');
    });

    it('updates answer_calls_from field', async () => {
      const { accessToken } = await createTestUser(app);

      const response = await app.inject({
        method: 'PATCH',
        url: '/v1/call_settings',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          call_settings: { answer_calls_from: 'contacts' },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.call_settings.answer_calls_from).toBe('contacts');
    });

    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/v1/call_settings',
        payload: { call_settings: { is_bot_enabled: true } },
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
