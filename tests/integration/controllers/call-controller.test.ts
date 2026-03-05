import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { getTestApp, getTestDb, closeTestApp } from '../../helpers/test-app.js';
import { cleanDatabase } from '../../helpers/db-cleaner.js';
import { createTestUser } from '../../helpers/auth-helper.js';
import { users } from '../../../src/db/schema/users.js';
import { eq } from 'drizzle-orm';
import { companyFactory, callFactory, callTranscriptFactory } from '../../factories/index.js';
import type { FastifyInstance } from 'fastify';

describe('Call Controller', () => {
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

  describe('GET /v1/calls', () => {
    it('returns 401 without auth', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/calls' });
      expect(response.statusCode).toBe(401);
    });

    it('returns 400 when user has no company', async () => {
      const { accessToken } = await createTestUser(app);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/calls',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns calls with page_token', async () => {
      const { user, accessToken } = await createTestUser(app);
      const company = await companyFactory.create({ name: 'Test Co' });
      await getTestDb().update(users).set({ companyId: company.id }).where(eq(users.id, user.id));

      await callFactory.create({ companyId: company.id, fromPhoneNumberId: user.phone_number_id, toPhoneNumberId: user.phone_number_id });
      await callFactory.create({ companyId: company.id, fromPhoneNumberId: user.phone_number_id, toPhoneNumberId: user.phone_number_id });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/calls',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const body = response.json();
      expect(response.statusCode).toBe(200);
      expect(body.calls).toHaveLength(2);
      expect(body.page_token).toBeDefined();
    });

    it('paginates using page_token', async () => {
      const { user, accessToken } = await createTestUser(app);
      const company = await companyFactory.create({ name: 'Test Co' });
      await getTestDb().update(users).set({ companyId: company.id }).where(eq(users.id, user.id));

      const c1 = await callFactory.create({ companyId: company.id, fromPhoneNumberId: user.phone_number_id, toPhoneNumberId: user.phone_number_id });
      const c2 = await callFactory.create({ companyId: company.id, fromPhoneNumberId: user.phone_number_id, toPhoneNumberId: user.phone_number_id });
      const c3 = await callFactory.create({ companyId: company.id, fromPhoneNumberId: user.phone_number_id, toPhoneNumberId: user.phone_number_id });

      const response = await app.inject({
        method: 'GET',
        url: `/v1/calls?sort=asc&page_token=${c1.id}&limit=1`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const body = response.json();
      expect(response.statusCode).toBe(200);
      expect(body.calls).toHaveLength(1);
      expect(body.calls[0].id).toBe(c2.id);
    });

    it('sorts by id in ascending order', async () => {
      const { user, accessToken } = await createTestUser(app);
      const company = await companyFactory.create({ name: 'Test Co' });
      await getTestDb().update(users).set({ companyId: company.id }).where(eq(users.id, user.id));

      const c1 = await callFactory.create({ companyId: company.id, fromPhoneNumberId: user.phone_number_id, toPhoneNumberId: user.phone_number_id });
      const c2 = await callFactory.create({ companyId: company.id, fromPhoneNumberId: user.phone_number_id, toPhoneNumberId: user.phone_number_id });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/calls?sort=asc',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const body = response.json();
      expect(body.calls[0].id).toBe(c1.id);
      expect(body.calls[1].id).toBe(c2.id);
    });

    it('sorts by id in descending order by default', async () => {
      const { user, accessToken } = await createTestUser(app);
      const company = await companyFactory.create({ name: 'Test Co' });
      await getTestDb().update(users).set({ companyId: company.id }).where(eq(users.id, user.id));

      const c1 = await callFactory.create({ companyId: company.id, fromPhoneNumberId: user.phone_number_id, toPhoneNumberId: user.phone_number_id });
      const c2 = await callFactory.create({ companyId: company.id, fromPhoneNumberId: user.phone_number_id, toPhoneNumberId: user.phone_number_id });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/calls',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const body = response.json();
      expect(body.calls[0].id).toBe(c2.id);
      expect(body.calls[1].id).toBe(c1.id);
    });

    it('expands transcripts when requested', async () => {
      const { user, accessToken } = await createTestUser(app);
      const company = await companyFactory.create({ name: 'Test Co' });
      await getTestDb().update(users).set({ companyId: company.id }).where(eq(users.id, user.id));

      const call = await callFactory.create({ companyId: company.id, fromPhoneNumberId: user.phone_number_id, toPhoneNumberId: user.phone_number_id });
      await callTranscriptFactory.create({ callId: call.id, transcript: 'Hello from caller' });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/calls?expand=transcripts',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const body = response.json();
      expect(response.statusCode).toBe(200);
      expect(body.calls[0].transcripts).toHaveLength(1);
      expect(body.calls[0].transcripts[0].transcript).toBe('Hello from caller');
    });

    it('does not include transcripts when expand is omitted', async () => {
      const { user, accessToken } = await createTestUser(app);
      const company = await companyFactory.create({ name: 'Test Co' });
      await getTestDb().update(users).set({ companyId: company.id }).where(eq(users.id, user.id));

      const call = await callFactory.create({ companyId: company.id, fromPhoneNumberId: user.phone_number_id, toPhoneNumberId: user.phone_number_id });
      await callTranscriptFactory.create({ callId: call.id, transcript: 'Should not appear' });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/calls',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const body = response.json();
      expect(body.calls[0].transcripts).toBeUndefined();
    });
  });

  describe('POST /v1/calls', () => {
    it('creates a test call and returns auth with access token', async () => {
      const { user, accessToken } = await createTestUser(app);
      const company = await companyFactory.create({ name: 'Test Co' });
      await getTestDb().update(users).set({ companyId: company.id }).where(eq(users.id, user.id));

      const response = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { call: { test_mode: true } },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.call.external_call_id).toMatch(/^test-/);
      expect(body.call.state).toBe('connecting');
      expect(body.call.test_mode).toBe(true);
      expect(body.auth.access_token).toBeDefined();
    });

    it('returns 400 when test_mode is false', async () => {
      const { user, accessToken } = await createTestUser(app);
      const company = await companyFactory.create({ name: 'Test Co' });
      await getTestDb().update(users).set({ companyId: company.id }).where(eq(users.id, user.id));

      const response = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { call: { test_mode: false } },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when user has no company', async () => {
      const { accessToken } = await createTestUser(app);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { call: { test_mode: true } },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: { call: { test_mode: true } },
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
