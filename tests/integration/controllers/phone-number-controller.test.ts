import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { getTestApp, getTestDb, closeTestApp } from '../../helpers/test-app.js';
import { cleanDatabase } from '../../helpers/db-cleaner.js';
import { createTestUser } from '../../helpers/auth-helper.js';
import type { FastifyInstance } from 'fastify';

describe('Phone Number Controller', () => {
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

  describe('POST /v1/phone_numbers', () => {
    it('purchases and returns a new phone number', async () => {
      const { accessToken } = await createTestUser(app);
      const response = await app.inject({
        method: 'POST',
        url: '/v1/phone_numbers',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { phone_number: { area_code: '212' } },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.phone_number.phone_number_e164).toMatch(/^\+1212/);
      expect(body.phone_number.is_verified).toBe(true);
    });

    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/phone_numbers',
        payload: { phone_number: {} },
      });

      expect(response.statusCode).toBe(401);
    });

    describe('development mode', () => {
      const originalNodeEnv = process.env.NODE_ENV;

      afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
      });

      it('returns the dev test phone number instead of calling LiveKit', async () => {
        process.env.NODE_ENV = 'development';
        const { accessToken } = await createTestUser(app);
        const response = await app.inject({
          method: 'POST',
          url: '/v1/phone_numbers',
          headers: { authorization: `Bearer ${accessToken}` },
          payload: { phone_number: {} },
        });

        expect(response.statusCode).toBe(201);
        const body = response.json();
        expect(body.phone_number.phone_number_e164).toBe('+15005550100');
        expect(body.phone_number.is_verified).toBe(true);
      });

      it('returns the same number on repeated purchases (idempotent)', async () => {
        process.env.NODE_ENV = 'development';
        const { accessToken } = await createTestUser(app);

        const first = await app.inject({
          method: 'POST',
          url: '/v1/phone_numbers',
          headers: { authorization: `Bearer ${accessToken}` },
          payload: { phone_number: {} },
        });

        const second = await app.inject({
          method: 'POST',
          url: '/v1/phone_numbers',
          headers: { authorization: `Bearer ${accessToken}` },
          payload: { phone_number: {} },
        });

        expect(first.statusCode).toBe(201);
        expect(second.statusCode).toBe(201);
        const firstBody = first.json();
        const secondBody = second.json();
        expect(firstBody.phone_number.id).toBe(secondBody.phone_number.id);
        expect(secondBody.phone_number.phone_number_e164).toBe('+15005550100');
      });
    });
  });
});
