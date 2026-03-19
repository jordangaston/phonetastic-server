import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { getTestApp, getTestDb, closeTestApp } from '../../helpers/test-app.js';
import { cleanDatabase } from '../../helpers/db-cleaner.js';
import { createTestUser } from '../../helpers/auth-helper.js';
import { users } from '../../../src/db/schema/users.js';
import { addresses, operationHours, phoneNumbers } from '../../../src/db/schema/index.js';
import { faqs } from '../../../src/db/schema/faqs.js';
import { offerings } from '../../../src/db/schema/offerings.js';
import { eq } from 'drizzle-orm';
import { companyFactory } from '../../factories/index.js';
import type { FastifyInstance } from 'fastify';

describe('Company Controller', () => {
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

  describe('GET /v1/companies/:company_id', () => {
    it('returns 404 for nonexistent company', async () => {
      const { accessToken } = await createTestUser(app);
      const response = await app.inject({
        method: 'GET',
        url: '/v1/companies/999',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns company data', async () => {
      const company = await companyFactory.create({
        name: 'Acme Corp',
        businessType: 'SaaS',
        website: 'https://acme.com',
      });

      const { accessToken } = await createTestUser(app);
      const response = await app.inject({
        method: 'GET',
        url: `/v1/companies/${company.id}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().company.name).toBe('Acme Corp');
    });

    it('returns addresses, operation hours, and phone numbers', async () => {
      const company = await companyFactory.create({ name: 'Acme Corp' });
      const db = getTestDb();

      await db.insert(addresses).values({ companyId: company.id, streetAddress: '123 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US', label: 'main' });
      await db.insert(operationHours).values({ companyId: company.id, dayOfWeek: 1, openTime: '09:00', closeTime: '17:00' });
      await db.insert(phoneNumbers).values({ companyId: company.id, phoneNumberE164: '+15121234567', label: 'main' });

      const { accessToken } = await createTestUser(app);
      const response = await app.inject({
        method: 'GET',
        url: `/v1/companies/${company.id}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const { company: body } = response.json();
      expect(body.addresses).toHaveLength(1);
      expect(body.addresses[0].street_address).toBe('123 Main St');
      expect(body.operation_hours).toHaveLength(1);
      expect(body.operation_hours[0].day_of_week).toBe(1);
      expect(body.phone_numbers).toHaveLength(1);
      expect(body.phone_numbers[0].phone_number_e164).toBe('+15121234567');
    });

    it('returns faqs and offerings', async () => {
      const company = await companyFactory.create({ name: 'Acme Corp' });
      const db = getTestDb();

      await db.insert(faqs).values({ companyId: company.id, question: 'What is Acme?', answer: 'A great company.' });
      await db.insert(offerings).values({ companyId: company.id, type: 'service', name: 'Consulting', description: 'Expert advice', priceAmount: '100.00', priceCurrency: 'USD', priceFrequency: 'hourly' });

      const { accessToken } = await createTestUser(app);
      const response = await app.inject({
        method: 'GET',
        url: `/v1/companies/${company.id}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const { company: body } = response.json();
      expect(body.faqs).toHaveLength(1);
      expect(body.faqs[0].question).toBe('What is Acme?');
      expect(body.faqs[0].answer).toBe('A great company.');
      expect(body.offerings).toHaveLength(1);
      expect(body.offerings[0].name).toBe('Consulting');
      expect(body.offerings[0].type).toBe('service');
      expect(body.offerings[0].price_amount).toBe(100);
    });
  });

  describe('PATCH /v1/companies/:id', () => {
    it('updates company fields', async () => {
      const company = await companyFactory.create({ name: 'Acme Corp' });

      const { user, accessToken } = await createTestUser(app);
      await getTestDb().update(users).set({ companyId: company.id }).where(eq(users.id, user.id));

      const response = await app.inject({
        method: 'PATCH',
        url: `/v1/companies/${company.id}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          company: { name: 'Updated Corp' },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().company.name).toBe('Updated Corp');
    });

    it('updates emails array', async () => {
      const company = await companyFactory.create({ name: 'Acme Corp' });

      const { user, accessToken } = await createTestUser(app);
      await getTestDb().update(users).set({ companyId: company.id }).where(eq(users.id, user.id));

      const response = await app.inject({
        method: 'PATCH',
        url: `/v1/companies/${company.id}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          company: { emails: ['support@acme.com', 'billing@acme.com'] },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().company.emails).toEqual(['support@acme.com', 'billing@acme.com']);
    });

    it('returns 403 when user does not belong to the company', async () => {
      const company = await companyFactory.create({ name: 'Other Corp' });

      const { accessToken } = await createTestUser(app);
      const response = await app.inject({
        method: 'PATCH',
        url: `/v1/companies/${company.id}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { company: { name: 'Hijacked' } },
      });

      expect(response.statusCode).toBe(403);
    });

  });
});
