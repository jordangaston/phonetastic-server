import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { getTestApp, getTestDb, closeTestApp } from '../../helpers/test-app.js';
import { cleanDatabase } from '../../helpers/db-cleaner.js';
import { createTestUser } from '../../helpers/auth-helper.js';
import { users } from '../../../src/db/schema/users.js';
import { eq } from 'drizzle-orm';
import {
  companyFactory,
  endUserFactory,
  emailAddressFactory,
  chatFactory,
  emailFactory,
  attachmentFactory,
} from '../../factories/index.js';
import type { FastifyInstance } from 'fastify';

describe('Chat Controller', () => {
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

  describe('GET /v1/chats', () => {
    it('returns 401 without auth', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/chats' });
      expect(response.statusCode).toBe(401);
    });

    it('returns empty list when no chats exist', async () => {
      const { user, accessToken } = await createTestUser(app);
      const company = await companyFactory.create({ name: 'Chat Co' });
      await getTestDb().update(users).set({ companyId: company.id }).where(eq(users.id, user.id));

      const response = await app.inject({
        method: 'GET',
        url: '/v1/chats',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().chats).toHaveLength(0);
    });

    it('returns chats for the company with pagination', async () => {
      const { user, accessToken } = await createTestUser(app);
      const company = await companyFactory.create({ name: 'Chat Co' });
      await getTestDb().update(users).set({ companyId: company.id }).where(eq(users.id, user.id));
      const endUser = await endUserFactory.create({ companyId: company.id, email: 'test@example.com' });

      await chatFactory.create({ companyId: company.id, endUserId: endUser.id, subject: 'Chat 1' });
      await chatFactory.create({ companyId: company.id, endUserId: endUser.id, subject: 'Chat 2' });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/chats',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.chats).toHaveLength(2);
      expect(body.page_token).toBeDefined();
    });

    it('filters by channel', async () => {
      const { user, accessToken } = await createTestUser(app);
      const company = await companyFactory.create({ name: 'Filter Co' });
      await getTestDb().update(users).set({ companyId: company.id }).where(eq(users.id, user.id));
      const endUser = await endUserFactory.create({ companyId: company.id, email: 'filter@example.com' });
      await chatFactory.create({ companyId: company.id, endUserId: endUser.id });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/chats?channel=email',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().chats).toHaveLength(1);
    });
  });

  describe('PATCH /v1/chats/:id', () => {
    it('toggles bot on and off', async () => {
      const { user, accessToken } = await createTestUser(app);
      const company = await companyFactory.create({ name: 'Toggle Co' });
      await getTestDb().update(users).set({ companyId: company.id }).where(eq(users.id, user.id));
      const endUser = await endUserFactory.create({ companyId: company.id, email: 'toggle@example.com' });
      const chat = await chatFactory.create({ companyId: company.id, endUserId: endUser.id });

      const offResponse = await app.inject({
        method: 'PATCH',
        url: `/v1/chats/${chat.id}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { chat: { bot_enabled: false } },
      });

      expect(offResponse.statusCode).toBe(200);
      expect(offResponse.json().chat.bot_enabled).toBe(false);

      const onResponse = await app.inject({
        method: 'PATCH',
        url: `/v1/chats/${chat.id}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { chat: { bot_enabled: true } },
      });

      expect(onResponse.statusCode).toBe(200);
      expect(onResponse.json().chat.bot_enabled).toBe(true);
    });

    it('returns 404 for wrong company', async () => {
      const { accessToken } = await createTestUser(app);
      const otherCompany = await companyFactory.create({ name: 'Other Co' });
      const endUser = await endUserFactory.create({ companyId: otherCompany.id, email: 'other@example.com' });
      const chat = await chatFactory.create({ companyId: otherCompany.id, endUserId: endUser.id });

      const response = await app.inject({
        method: 'PATCH',
        url: `/v1/chats/${chat.id}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { chat: { bot_enabled: false } },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /v1/chats/:id/emails', () => {
    it('returns emails with attachment metadata', async () => {
      const { user, accessToken } = await createTestUser(app);
      const company = await companyFactory.create({ name: 'Email Co' });
      await getTestDb().update(users).set({ companyId: company.id }).where(eq(users.id, user.id));
      const endUser = await endUserFactory.create({ companyId: company.id, email: 'emails@example.com' });
      const chat = await chatFactory.create({ companyId: company.id, endUserId: endUser.id });
      const email = await emailFactory.create({
        chatId: chat.id,
        endUserId: endUser.id,
        direction: 'inbound',
        subject: 'Test email',
        bodyText: 'Hello',
      });
      await attachmentFactory.create({
        emailId: email.id,
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
      });

      const response = await app.inject({
        method: 'GET',
        url: `/v1/chats/${chat.id}/emails`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.emails).toHaveLength(1);
      expect(body.emails[0].subject).toBe('Test email');
      expect(body.emails[0].attachments).toHaveLength(1);
      expect(body.emails[0].attachments[0].filename).toBe('invoice.pdf');
    });

    it('returns 404 for chat not in company', async () => {
      const { accessToken } = await createTestUser(app);
      const otherCompany = await companyFactory.create({ name: 'Other Co' });
      const endUser = await endUserFactory.create({ companyId: otherCompany.id, email: 'nope@example.com' });
      const chat = await chatFactory.create({ companyId: otherCompany.id, endUserId: endUser.id });

      const response = await app.inject({
        method: 'GET',
        url: `/v1/chats/${chat.id}/emails`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
