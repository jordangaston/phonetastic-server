import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { getTestApp, getTestDb, closeTestApp } from '../../helpers/test-app.js';
import { cleanDatabase } from '../../helpers/db-cleaner.js';
import { createTestUser } from '../../helpers/auth-helper.js';
import { users } from '../../../src/db/schema/users.js';
import { eq } from 'drizzle-orm';
import { companyFactory, callFactory, phoneNumberFactory, callTranscriptFactory } from '../../factories/index.js';
import { callTranscriptEntries } from '../../../src/db/schema/call-transcript-entries.js';
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

    it('returns calls for the user company with page_token', async () => {
      const { user, accessToken } = await createTestUser(app);
      const company = await companyFactory.create({ name: 'Test Co' });
      await getTestDb().update(users).set({ companyId: company.id }).where(eq(users.id, user.id));
      const phone = await phoneNumberFactory.create();

      await callFactory.create({ companyId: company.id, fromPhoneNumberId: phone.id, toPhoneNumberId: phone.id });
      await callFactory.create({ companyId: company.id, fromPhoneNumberId: phone.id, toPhoneNumberId: phone.id });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/calls',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const body = response.json();
      expect(response.statusCode).toBe(200);
      expect(body.calls).toHaveLength(2);
      expect(body.page_token).toBe(body.calls[1].id);
    });

    it('paginates using page_token with desc sort', async () => {
      const { user, accessToken } = await createTestUser(app);
      const company = await companyFactory.create({ name: 'Test Co' });
      await getTestDb().update(users).set({ companyId: company.id }).where(eq(users.id, user.id));
      const phone = await phoneNumberFactory.create();

      const callA = await callFactory.create({ companyId: company.id, fromPhoneNumberId: phone.id, toPhoneNumberId: phone.id });
      const callB = await callFactory.create({ companyId: company.id, fromPhoneNumberId: phone.id, toPhoneNumberId: phone.id });
      await callFactory.create({ companyId: company.id, fromPhoneNumberId: phone.id, toPhoneNumberId: phone.id });

      const response = await app.inject({
        method: 'GET',
        url: `/v1/calls?page_token=${callB.id + 1}&limit=2&sort=desc`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const body = response.json();
      expect(response.statusCode).toBe(200);
      expect(body.calls).toHaveLength(2);
      expect(body.calls[0].id).toBe(callB.id);
      expect(body.calls[1].id).toBe(callA.id);
    });

    it('sorts by id ascending when sort=asc', async () => {
      const { user, accessToken } = await createTestUser(app);
      const company = await companyFactory.create({ name: 'Test Co' });
      await getTestDb().update(users).set({ companyId: company.id }).where(eq(users.id, user.id));
      const phone = await phoneNumberFactory.create();

      const callA = await callFactory.create({ companyId: company.id, fromPhoneNumberId: phone.id, toPhoneNumberId: phone.id });
      const callB = await callFactory.create({ companyId: company.id, fromPhoneNumberId: phone.id, toPhoneNumberId: phone.id });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/calls?sort=asc',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const body = response.json();
      expect(response.statusCode).toBe(200);
      expect(body.calls[0].id).toBe(callA.id);
      expect(body.calls[1].id).toBe(callB.id);
    });

    it('expands transcript with entries', async () => {
      const { user, accessToken } = await createTestUser(app);
      const company = await companyFactory.create({ name: 'Test Co' });
      await getTestDb().update(users).set({ companyId: company.id }).where(eq(users.id, user.id));
      const phone = await phoneNumberFactory.create();

      const call = await callFactory.create({ companyId: company.id, fromPhoneNumberId: phone.id, toPhoneNumberId: phone.id });
      const transcript = await callTranscriptFactory.create({ callId: call.id });
      await getTestDb().insert(callTranscriptEntries).values({
        transcriptId: transcript.id, text: 'Hello', sequenceNumber: 0,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/calls?expand=transcript',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const body = response.json();
      expect(response.statusCode).toBe(200);
      expect(body.calls[0].transcript).toBeDefined();
      expect(body.calls[0].transcript.id).toBe(transcript.id);
      expect(body.calls[0].transcript.entries).toHaveLength(1);
      expect(body.calls[0].transcript.entries[0].text).toBe('Hello');
    });

    it('does not include transcript when expand is omitted', async () => {
      const { user, accessToken } = await createTestUser(app);
      const company = await companyFactory.create({ name: 'Test Co' });
      await getTestDb().update(users).set({ companyId: company.id }).where(eq(users.id, user.id));
      const phone = await phoneNumberFactory.create();

      await callFactory.create({ companyId: company.id, fromPhoneNumberId: phone.id, toPhoneNumberId: phone.id });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/calls',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const body = response.json();
      expect(response.statusCode).toBe(200);
      expect(body.calls[0].transcript).toBeUndefined();
    });
  });
});
