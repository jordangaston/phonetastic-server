import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { getTestApp, getTestDb, closeTestApp } from '../../helpers/test-app.js';
import { cleanDatabase } from '../../helpers/db-cleaner.js';
import { createTestUser } from '../../helpers/auth-helper.js';
import { companyFactory } from '../../factories/index.js';
import { users } from '../../../src/db/schema/users.js';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

describe('Subdomain Controller', () => {
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

  describe('POST /v1/subdomains', () => {
    it('returns 202 with created subdomain', async () => {
      const company = await companyFactory.create({ name: 'Sub Co' });
      const { user, accessToken } = await createTestUser(app);
      await getTestDb().update(users).set({ companyId: company.id }).where(eq(users.id, user.id));

      const response = await app.inject({
        method: 'POST',
        url: '/v1/subdomains',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(202);
      const body = response.json();
      expect(body.subdomain.subdomain).toMatch(/^\w+-\w+-\d+$/);
      expect(body.subdomain.verified).toBe(false);
    });

    it('returns 400 when user has no company', async () => {
      const { accessToken } = await createTestUser(app);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/subdomains',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /v1/subdomains', () => {
    it('returns empty list when no subdomains', async () => {
      const company = await companyFactory.create({ name: 'Sub Co' });
      const { user, accessToken } = await createTestUser(app);
      await getTestDb().update(users).set({ companyId: company.id }).where(eq(users.id, user.id));

      const response = await app.inject({
        method: 'GET',
        url: '/v1/subdomains',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().subdomains).toEqual([]);
    });

    it('returns subdomains after creation', async () => {
      const company = await companyFactory.create({ name: 'Sub Co' });
      const { user, accessToken } = await createTestUser(app);
      await getTestDb().update(users).set({ companyId: company.id }).where(eq(users.id, user.id));

      await app.inject({
        method: 'POST',
        url: '/v1/subdomains',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/subdomains',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().subdomains).toHaveLength(1);
    });
  });
});
