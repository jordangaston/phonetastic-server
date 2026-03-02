import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { getTestApp, getTestDb, closeTestApp, getStubOtpProvider } from '../../helpers/test-app.js';
import { cleanDatabase } from '../../helpers/db-cleaner.js';
import type { FastifyInstance } from 'fastify';

describe('OTP Controller', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await getTestApp();
  });

  beforeEach(async () => {
    await cleanDatabase(getTestDb());
    const provider = getStubOtpProvider();
    provider.sent.length = 0;
    provider.approvedCodes.clear();
  });

  afterAll(async () => {
    await closeTestApp();
  });

  describe('POST /v1/otps', () => {
    it('initiates OTP delivery and returns pending status', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/otps',
        payload: { otp: { phone_number: '+15551234567' } },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().otp).toEqual({ status: 'pending' });
      expect(getStubOtpProvider().sent).toContain('+15551234567');
    });
  });

  describe('POST /v1/otps/verify', () => {
    it('returns 400 for an invalid code', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/otps/verify',
        payload: { otp: { phone_number: '+15551234567', code: '000000' } },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns verified true for a valid code', async () => {
      getStubOtpProvider().approvedCodes.set('+15551234567', '123456');

      const response = await app.inject({
        method: 'POST',
        url: '/v1/otps/verify',
        payload: { otp: { phone_number: '+15551234567', code: '123456' } },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().otp).toEqual({ verified: true, phoneNumberE164: '+15551234567' });
    });
  });
});
