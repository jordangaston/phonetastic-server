import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResendServiceImpl, StubResendService } from '../../../src/services/resend-service.js';

const mockReceivingGet = vi.fn();
const mockReceivingAttachmentsGet = vi.fn();
const mockEmailsSend = vi.fn();

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: {
      receiving: {
        get: mockReceivingGet,
        attachments: { get: mockReceivingAttachmentsGet },
      },
      send: mockEmailsSend,
    },
  })),
}));

const mockWebhookVerify = vi.fn();

vi.mock('svix', () => ({
  Webhook: vi.fn().mockImplementation(() => ({
    verify: mockWebhookVerify,
  })),
}));

describe('ResendServiceImpl', () => {
  let service: ResendServiceImpl;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ResendServiceImpl('re_test_key', 'whsec_test');
  });

  describe('verifyWebhookSignature', () => {
    it('returns true when Svix verification succeeds', () => {
      mockWebhookVerify.mockReturnValue(undefined);

      const result = service.verifyWebhookSignature('{}', {
        svixId: 'msg_1',
        svixTimestamp: '123',
        svixSignature: 'v1,sig',
      });

      expect(result).toBe(true);
      expect(mockWebhookVerify).toHaveBeenCalledWith('{}', {
        'svix-id': 'msg_1',
        'svix-timestamp': '123',
        'svix-signature': 'v1,sig',
      });
    });

    it('returns false when Svix verification throws', () => {
      mockWebhookVerify.mockImplementation(() => { throw new Error('bad sig'); });

      const result = service.verifyWebhookSignature('{}', {
        svixId: 'msg_1',
        svixTimestamp: '123',
        svixSignature: 'v1,bad',
      });

      expect(result).toBe(false);
    });
  });

  describe('getReceivedEmail', () => {
    it('returns mapped email with headers parsed', async () => {
      mockReceivingGet.mockResolvedValue({
        data: {
          from: 'user@example.com',
          to: ['support@acme.resend.app'],
          subject: 'Help',
          text: 'Hello',
          html: '<p>Hello</p>',
          message_id: '<abc@resend.dev>',
          headers: {
            'in-reply-to': '<parent@resend.dev>',
            'references': '<ref1@resend.dev> <ref2@resend.dev>',
          },
          attachments: [{ id: 'att_1', filename: 'doc.pdf', content_type: 'application/pdf' }],
        },
        error: null,
      });

      const result = await service.getReceivedEmail('email_1');

      expect(result.from).toBe('user@example.com');
      expect(result.messageId).toBe('<abc@resend.dev>');
      expect(result.inReplyTo).toBe('<parent@resend.dev>');
      expect(result.references).toEqual(['<ref1@resend.dev>', '<ref2@resend.dev>']);
      expect(result.attachments).toEqual([{ id: 'att_1', filename: 'doc.pdf', contentType: 'application/pdf' }]);
    });

    it('extracts forwardedTo from X-Forwarded-To header', async () => {
      mockReceivingGet.mockResolvedValue({
        data: {
          from: 'user@example.com', to: ['support@acme.com'], subject: 'Hi',
          text: '', html: '', message_id: '<m1>', attachments: [],
          headers: { 'x-forwarded-to': 'catch-all@sub.mail.phonetastic.ai' },
        },
        error: null,
      });

      const result = await service.getReceivedEmail('email_fwd');
      expect(result.forwardedTo).toBe('catch-all@sub.mail.phonetastic.ai');
    });

    it('falls back to Delivered-To when X-Forwarded-To absent', async () => {
      mockReceivingGet.mockResolvedValue({
        data: {
          from: 'user@example.com', to: ['support@acme.com'], subject: 'Hi',
          text: '', html: '', message_id: '<m1>', attachments: [],
          headers: { 'delivered-to': 'inbox@sub.mail.phonetastic.ai' },
        },
        error: null,
      });

      const result = await service.getReceivedEmail('email_dlv');
      expect(result.forwardedTo).toBe('inbox@sub.mail.phonetastic.ai');
    });

    it('sets forwardedTo to undefined when neither header present', async () => {
      mockReceivingGet.mockResolvedValue({
        data: {
          from: 'user@example.com', to: ['support@acme.com'], subject: 'Hi',
          text: '', html: '', message_id: '<m1>', attachments: [],
          headers: {},
        },
        error: null,
      });

      const result = await service.getReceivedEmail('email_none');
      expect(result.forwardedTo).toBeUndefined();
    });

    it('throws on API error', async () => {
      mockReceivingGet.mockResolvedValue({ data: null, error: { message: 'Not found' } });
      await expect(service.getReceivedEmail('bad_id')).rejects.toThrow('Resend getReceivedEmail failed');
    });
  });

  describe('getAttachmentContent', () => {
    it('downloads content from signed URL', async () => {
      const fileBytes = new Uint8Array([1, 2, 3]);
      mockReceivingAttachmentsGet.mockResolvedValue({
        data: { download_url: 'https://resend.dev/dl/att_1' },
        error: null,
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(fileBytes.buffer),
      }));

      const result = await service.getAttachmentContent('email_1', 'att_1');

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBe(3);
      expect(mockReceivingAttachmentsGet).toHaveBeenCalledWith({ emailId: 'email_1', id: 'att_1' });

      vi.unstubAllGlobals();
    });

    it('throws on API error', async () => {
      mockReceivingAttachmentsGet.mockResolvedValue({ data: null, error: { message: 'Not found' } });
      await expect(service.getAttachmentContent('e1', 'a1')).rejects.toThrow('Resend getAttachmentContent failed');
    });
  });

  describe('sendEmail', () => {
    it('sends email with threading headers and returns generated message ID', async () => {
      mockEmailsSend.mockResolvedValue({ data: { id: 'resend_123' }, error: null });

      const result = await service.sendEmail({
        from: 'bot@acme.resend.app',
        to: 'user@example.com',
        subject: 'Re: Help',
        text: 'Here is the answer.',
        inReplyTo: '<parent@resend.dev>',
        references: ['<parent@resend.dev>'],
      });

      expect(result.id).toBe('resend_123');
      expect(result.messageId).toMatch(/^<.+@mail\.phonetastic\.ai>$/);

      const sendCall = mockEmailsSend.mock.calls[0][0];
      expect(sendCall.headers['In-Reply-To']).toBe('<parent@resend.dev>');
      expect(sendCall.headers['References']).toBe('<parent@resend.dev>');
      expect(sendCall.headers['Message-ID']).toBe(result.messageId);
    });

    it('throws on API error', async () => {
      mockEmailsSend.mockResolvedValue({ data: null, error: { message: 'Rate limited' } });

      await expect(service.sendEmail({
        from: 'bot@acme.resend.app',
        to: 'user@example.com',
        subject: 'Test',
        text: 'Body',
      })).rejects.toThrow('Resend sendEmail failed');
    });
  });
});

describe('StubResendService', () => {
  let stub: StubResendService;

  beforeEach(() => { stub = new StubResendService(); });

  it('returns canned received emails', async () => {
    stub.setReceivedEmail('e1', {
      from: 'a@b.com', to: ['c@d.com'], subject: 'Hi',
      text: 'hi', html: '', messageId: '<m1>', attachments: [],
    });
    const email = await stub.getReceivedEmail('e1');
    expect(email.from).toBe('a@b.com');
  });

  it('returns canned attachment content', async () => {
    stub.setAttachmentContent('e1:a1', Buffer.from('pdf-data'));
    const content = await stub.getAttachmentContent('e1', 'a1');
    expect(content.toString()).toBe('pdf-data');
  });

  it('returns default stub attachment content when not canned', async () => {
    const content = await stub.getAttachmentContent('e1', 'a1');
    expect(content.toString()).toBe('stub-attachment-a1');
  });

  it('records sent emails', async () => {
    const result = await stub.sendEmail({ from: 'a@b', to: 'c@d', subject: 'S', text: 'T' });
    expect(result.id).toBe('resend-1');
    expect(stub.sentEmails).toHaveLength(1);
  });
});
