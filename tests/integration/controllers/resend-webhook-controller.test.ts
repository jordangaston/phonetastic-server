import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { getTestApp, getTestDb, getStubResendService, closeTestApp } from '../../helpers/test-app.js';
import { cleanDatabase } from '../../helpers/db-cleaner.js';
import { companyFactory } from '../../factories/index.js';
import { companies } from '../../../src/db/schema/companies.js';
import { emails } from '../../../src/db/schema/emails.js';
import { chats } from '../../../src/db/schema/chats.js';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

describe('Resend Webhook Controller', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await getTestApp();
  });

  beforeEach(async () => {
    await cleanDatabase(getTestDb());
    const stub = getStubResendService();
    stub.receivedEmails.clear();
    stub.sentEmails.length = 0;
    stub.signatureValid = true;
  });

  afterAll(async () => {
    await closeTestApp();
  });

  function webhookPayload(emailId: string, to: string) {
    return {
      type: 'email.received',
      data: { email_id: emailId, from: 'sender@example.com', to: [to], subject: 'Test' },
    };
  }

  function svixHeaders() {
    return { 'svix-id': 'msg_1', 'svix-timestamp': '1234567890', 'svix-signature': 'v1,sig' };
  }

  it('returns 401 for invalid signature', async () => {
    getStubResendService().signatureValid = false;

    const response = await app.inject({
      method: 'POST',
      url: '/v1/resend/webhook',
      headers: svixHeaders(),
      payload: webhookPayload('email-1', 'acme@mail.phonetastic.ai'),
    });

    expect(response.statusCode).toBe(401);
  });

  it('persists inbound email and creates chat', async () => {
    const company = await companyFactory.create({ name: 'Webhook Co' });
    await getTestDb().update(companies).set({ emails: ['webhook@mail.phonetastic.ai'] }).where(eq(companies.id, company.id));

    getStubResendService().setReceivedEmail('email-1', {
      from: 'customer@example.com',
      to: ['webhook@mail.phonetastic.ai'],
      subject: 'Help needed',
      text: 'I need help',
      html: '<p>I need help</p>',
      messageId: '<msg-1@example.com>',
      attachments: [],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/resend/webhook',
      headers: svixHeaders(),
      payload: webhookPayload('email-1', 'webhook@mail.phonetastic.ai'),
    });

    expect(response.statusCode).toBe(200);

    const [emailRow] = await getTestDb().select().from(emails).where(eq(emails.externalEmailId, 'email-1'));
    expect(emailRow).toBeDefined();
    expect(emailRow.bodyText).toBe('I need help');
    expect(emailRow.direction).toBe('inbound');

    const [chatRow] = await getTestDb().select().from(chats).where(eq(chats.companyId, company.id));
    expect(chatRow).toBeDefined();
    expect(chatRow.subject).toBe('Help needed');
  });

  it('is idempotent for duplicate email_id', async () => {
    const company = await companyFactory.create({ name: 'Dedup Co' });
    await getTestDb().update(companies).set({ emails: ['dedup@mail.phonetastic.ai'] }).where(eq(companies.id, company.id));

    getStubResendService().setReceivedEmail('email-dup', {
      from: 'customer@example.com',
      to: ['dedup@mail.phonetastic.ai'],
      subject: 'Dup test',
      text: 'Hello',
      html: '<p>Hello</p>',
      messageId: '<msg-dup@example.com>',
      attachments: [],
    });

    await app.inject({
      method: 'POST',
      url: '/v1/resend/webhook',
      headers: svixHeaders(),
      payload: webhookPayload('email-dup', 'dedup@mail.phonetastic.ai'),
    });

    const secondResponse = await app.inject({
      method: 'POST',
      url: '/v1/resend/webhook',
      headers: svixHeaders(),
      payload: webhookPayload('email-dup', 'dedup@mail.phonetastic.ai'),
    });

    expect(secondResponse.statusCode).toBe(200);

    const allEmails = await getTestDb().select().from(emails).where(eq(emails.externalEmailId, 'email-dup'));
    expect(allEmails).toHaveLength(1);
  });

  it('returns 200 no-op for unknown address', async () => {
    getStubResendService().setReceivedEmail('email-unknown', {
      from: 'someone@example.com',
      to: ['nobody@mail.phonetastic.ai'],
      subject: 'Unknown',
      text: 'Hello',
      html: '<p>Hello</p>',
      messageId: '<msg-unknown@example.com>',
      attachments: [],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/resend/webhook',
      headers: svixHeaders(),
      payload: webhookPayload('email-unknown', 'nobody@mail.phonetastic.ai'),
    });

    expect(response.statusCode).toBe(200);
  });
});
