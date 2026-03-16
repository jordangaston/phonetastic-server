import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { getTestApp, getTestDb, closeTestApp } from '../../helpers/test-app.js';
import { cleanDatabase } from '../../helpers/db-cleaner.js';
import { createTestUser } from '../../helpers/auth-helper.js';
import { users } from '../../../src/db/schema/users.js';
import { eq } from 'drizzle-orm';
import { companyFactory } from '../../factories/index.js';
import type { FastifyInstance } from 'fastify';

describe('EmailAddress Controller', () => {
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

  describe('POST /v1/email-addresses', () => {
    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/email-addresses',
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 400 when user has no company', async () => {
      const { accessToken } = await createTestUser(app);
      const response = await app.inject({
        method: 'POST',
        url: '/v1/email-addresses',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(response.statusCode).toBe(400);
    });

    it('creates an email address for the company', async () => {
      const { user, accessToken } = await createTestUser(app);
      const company = await companyFactory.create({ name: 'Acme Auto' });
      await getTestDb().update(users).set({ companyId: company.id }).where(eq(users.id, user.id));

      const response = await app.inject({
        method: 'POST',
        url: '/v1/email-addresses',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.email_address.address).toBe('acme-auto@mail.phonetastic.ai');
      expect(body.email_address.company_id).toBe(company.id);
    });

    it('returns 409 when company already has an email address', async () => {
      const { user, accessToken } = await createTestUser(app);
      const company = await companyFactory.create({ name: 'Acme Auto' });
      await getTestDb().update(users).set({ companyId: company.id }).where(eq(users.id, user.id));

      await app.inject({
        method: 'POST',
        url: '/v1/email-addresses',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/email-addresses',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.message).toBe('Company already has an email address');
    });
  });

  describe('GET /v1/email-addresses', () => {
    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/email-addresses',
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns empty list when no addresses exist', async () => {
      const { user, accessToken } = await createTestUser(app);
      const company = await companyFactory.create({ name: 'Empty Co' });
      await getTestDb().update(users).set({ companyId: company.id }).where(eq(users.id, user.id));

      const response = await app.inject({
        method: 'GET',
        url: '/v1/email-addresses',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().email_addresses).toHaveLength(0);
    });

    it('returns company email addresses', async () => {
      const { user, accessToken } = await createTestUser(app);
      const company = await companyFactory.create({ name: 'List Co' });
      await getTestDb().update(users).set({ companyId: company.id }).where(eq(users.id, user.id));

      await app.inject({
        method: 'POST',
        url: '/v1/email-addresses',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/email-addresses',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.email_addresses).toHaveLength(1);
      expect(body.email_addresses[0].address).toBe('list-co@mail.phonetastic.ai');
    });
  });
});
