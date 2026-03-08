import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { getTestApp, getTestDb, closeTestApp } from '../../helpers/test-app.js';
import { cleanDatabase } from '../../helpers/db-cleaner.js';
import { container } from 'tsyringe';
import { CalendarRepository } from '../../../src/repositories/calendar-repository.js';
import { companyFactory, phoneNumberFactory } from '../../factories/index.js';
import { users } from '../../../src/db/schema/users.js';

describe('CalendarRepository', () => {
  let repo: CalendarRepository;

  beforeAll(async () => {
    await getTestApp();
    repo = container.resolve<CalendarRepository>('CalendarRepository');
  });

  beforeEach(async () => {
    await cleanDatabase(getTestDb());
  });

  afterAll(async () => {
    await closeTestApp();
  });

  async function makeUser(companyId: number) {
    const phone = await phoneNumberFactory.create();
    const [user] = await getTestDb().insert(users).values({
      phoneNumberId: phone.id,
      companyId,
      firstName: 'Test',
      jwtPrivateKey: 'pk',
      jwtPublicKey: 'pub',
    }).returning();
    return user;
  }

  async function makeCalendar(userId: number, companyId: number) {
    return repo.create({
      userId,
      companyId,
      provider: 'google',
      externalId: 'ext-cal-id',
      name: 'Test Calendar',
      description: 'A test calendar',
      email: 'test@example.com',
      accessToken: 'access-123',
      refreshToken: 'refresh-123',
      tokenExpiresAt: new Date('2026-12-31'),
    });
  }

  describe('create', () => {
    it('persists calendar metadata fields', async () => {
      const company = await companyFactory.create();
      const user = await makeUser(company.id);
      const calendar = await makeCalendar(user.id, company.id);

      expect(calendar.externalId).toBe('ext-cal-id');
      expect(calendar.name).toBe('Test Calendar');
      expect(calendar.description).toBe('A test calendar');
    });
  });

  describe('findByCompanyId', () => {
    it('returns the calendar for the given company', async () => {
      const company = await companyFactory.create();
      const user = await makeUser(company.id);
      await makeCalendar(user.id, company.id);

      const found = await repo.findByCompanyId(company.id);

      expect(found).toBeDefined();
      expect(found!.email).toBe('test@example.com');
    });

    it('returns undefined when no calendar exists', async () => {
      const company = await companyFactory.create();
      const found = await repo.findByCompanyId(company.id);
      expect(found).toBeUndefined();
    });
  });

  describe('updateTokens', () => {
    it('persists new token values', async () => {
      const company = await companyFactory.create();
      const user = await makeUser(company.id);
      const calendar = await makeCalendar(user.id, company.id);

      const newExpiry = new Date('2027-06-15');
      const updated = await repo.updateTokens(calendar.id, {
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        tokenExpiresAt: newExpiry,
      });

      expect(updated!.accessToken).toBe('new-access');
      expect(updated!.refreshToken).toBe('new-refresh');
      expect(updated!.tokenExpiresAt).toEqual(newExpiry);
    });
  });
});
