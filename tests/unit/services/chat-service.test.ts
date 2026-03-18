import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatService } from '../../../src/services/chat-service.js';
import { BadRequestError, NotFoundError } from '../../../src/lib/errors.js';

describe('ChatService', () => {
  let db: any;
  let chatRepo: any;
  let emailRepo: any;
  let attachmentRepo: any;
  let emailAddressRepo: any;
  let subdomainRepo: any;
  let companyRepo: any;
  let endUserRepo: any;
  let userRepo: any;
  let service: ChatService;

  beforeEach(() => {
    db = { transaction: vi.fn((fn: any) => fn(db)) };
    chatRepo = {
      create: vi.fn(),
      findById: vi.fn(),
      findOpenByEndUserAndCompany: vi.fn(),
      findAllByCompanyId: vi.fn(),
      update: vi.fn(),
    };
    emailRepo = {
      create: vi.fn(),
      findById: vi.fn(),
      findByExternalEmailId: vi.fn(),
      findByMessageId: vi.fn(),
      findAllByChatId: vi.fn(),
    };
    attachmentRepo = { create: vi.fn(), findAllByEmailId: vi.fn() };
    emailAddressRepo = { findByAddress: vi.fn() };
    subdomainRepo = { findBySubdomain: vi.fn() };
    companyRepo = { findById: vi.fn(), findByEmailAddress: vi.fn() };
    endUserRepo = { findByEmailAndCompanyId: vi.fn(), create: vi.fn() };
    userRepo = { findById: vi.fn() };
    service = new ChatService(db, chatRepo, emailRepo, attachmentRepo, emailAddressRepo, subdomainRepo, companyRepo, endUserRepo, userRepo);
  });

  describe('receiveInboundEmail', () => {
    const emailData = {
      from: 'sender@example.com',
      to: ['acme@mail.phonetastic.ai'],
      subject: 'Help',
      text: 'I need help',
      html: '<p>I need help</p>',
      messageId: '<msg-1@example.com>',
      attachments: [],
    };

    it('returns null when neither subdomain nor email address matches', async () => {
      emailRepo.findByExternalEmailId.mockResolvedValue(null);
      subdomainRepo.findBySubdomain.mockResolvedValue(null);
      companyRepo.findByEmailAddress.mockResolvedValue(null);
      const result = await service.receiveInboundEmail(emailData, 'ext-1');
      expect(result).toBeNull();
    });

    it('deduplicates by external email id', async () => {
      const existing = { id: 1, chatId: 10 };
      emailRepo.findByExternalEmailId.mockResolvedValue(existing);
      chatRepo.findById.mockResolvedValue({ id: 10 });

      const result = await service.receiveInboundEmail(emailData, 'ext-1');

      expect(result!.isDuplicate).toBe(true);
      expect(result!.email.id).toBe(1);
    });

    it('routes via subdomain when forwardedTo matches a subdomain', async () => {
      const emailDataFwd = {
        ...emailData,
        forwardedTo: 'catch-all@acme-sub.mail.phonetastic.ai',
      };
      emailRepo.findByExternalEmailId.mockResolvedValue(null);
      subdomainRepo.findBySubdomain.mockResolvedValue({ id: 1, companyId: 5 });
      companyRepo.findById.mockResolvedValue({ id: 5, emails: ['support@acme.com'] });
      endUserRepo.findByEmailAndCompanyId.mockResolvedValue(null);
      endUserRepo.create.mockResolvedValue({ id: 100 });
      chatRepo.findOpenByEndUserAndCompany.mockResolvedValue(null);
      chatRepo.create.mockResolvedValue({ id: 20, subject: null });
      emailRepo.create.mockResolvedValue({ id: 30 });
      chatRepo.update.mockResolvedValue({ id: 20, subject: 'Help' });

      const result = await service.receiveInboundEmail(emailDataFwd, 'ext-1');

      expect(subdomainRepo.findBySubdomain).toHaveBeenCalledWith('acme-sub');
      expect(result!.isDuplicate).toBe(false);
    });

    it('falls back to companyRepo.findByEmailAddress when no subdomain match', async () => {
      emailRepo.findByExternalEmailId.mockResolvedValue(null);
      subdomainRepo.findBySubdomain.mockResolvedValue(null);
      companyRepo.findByEmailAddress.mockResolvedValue({ id: 5, emails: ['acme@mail.phonetastic.ai'] });
      endUserRepo.findByEmailAndCompanyId.mockResolvedValue(null);
      endUserRepo.create.mockResolvedValue({ id: 100 });
      chatRepo.findOpenByEndUserAndCompany.mockResolvedValue(null);
      chatRepo.create.mockResolvedValue({ id: 20, subject: null });
      emailRepo.create.mockResolvedValue({ id: 30 });
      chatRepo.update.mockResolvedValue({ id: 20, subject: 'Help' });

      const result = await service.receiveInboundEmail(emailData, 'ext-1');

      expect(companyRepo.findByEmailAddress).toHaveBeenCalledWith('acme@mail.phonetastic.ai');
      expect(result!.isDuplicate).toBe(false);
    });

    it('sets replyToAddress from matching company email address', async () => {
      const emailDataMulti = {
        ...emailData,
        to: ['billing@acme.com', 'support@acme.com'],
      };
      emailRepo.findByExternalEmailId.mockResolvedValue(null);
      subdomainRepo.findBySubdomain.mockResolvedValue(null);
      companyRepo.findByEmailAddress.mockResolvedValue({ id: 5, emails: ['support@acme.com', 'billing@acme.com'] });
      endUserRepo.findByEmailAndCompanyId.mockResolvedValue(null);
      endUserRepo.create.mockResolvedValue({ id: 100 });
      chatRepo.findOpenByEndUserAndCompany.mockResolvedValue(null);
      chatRepo.create.mockResolvedValue({ id: 20, subject: null });
      emailRepo.create.mockResolvedValue({ id: 30 });
      chatRepo.update.mockResolvedValue({ id: 20 });

      await service.receiveInboundEmail(emailDataMulti, 'ext-1');

      expect(emailRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ replyToAddress: 'support@acme.com' }),
        db,
      );
    });

    it('stores forwardedTo on email row', async () => {
      const emailDataFwd = {
        ...emailData,
        forwardedTo: 'catch-all@sub.mail.phonetastic.ai',
      };
      emailRepo.findByExternalEmailId.mockResolvedValue(null);
      subdomainRepo.findBySubdomain.mockResolvedValue({ id: 1, companyId: 5 });
      companyRepo.findById.mockResolvedValue({ id: 5, emails: [] });
      endUserRepo.findByEmailAndCompanyId.mockResolvedValue({ id: 100 });
      chatRepo.findOpenByEndUserAndCompany.mockResolvedValue({ id: 20, subject: 'test' });
      emailRepo.create.mockResolvedValue({ id: 30 });
      chatRepo.update.mockResolvedValue({ id: 20 });

      await service.receiveInboundEmail(emailDataFwd, 'ext-1');

      expect(emailRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ forwardedTo: 'catch-all@sub.mail.phonetastic.ai' }),
        db,
      );
    });

    it('threads by in_reply_to', async () => {
      const emailDataWithReply = { ...emailData, inReplyTo: '<parent@example.com>' };
      emailRepo.findByExternalEmailId.mockResolvedValue(null);
      subdomainRepo.findBySubdomain.mockResolvedValue(null);
      companyRepo.findByEmailAddress.mockResolvedValue({ id: 5, emails: ['acme@mail.phonetastic.ai'] });
      endUserRepo.findByEmailAndCompanyId.mockResolvedValue({ id: 100 });
      emailRepo.findByMessageId.mockResolvedValue({ id: 5, chatId: 20 });
      chatRepo.findById.mockResolvedValue({ id: 20, subject: 'Existing' });
      emailRepo.create.mockResolvedValue({ id: 31 });
      chatRepo.update.mockResolvedValue({ id: 20 });

      await service.receiveInboundEmail(emailDataWithReply, 'ext-2');

      expect(chatRepo.create).not.toHaveBeenCalled();
    });

    it('persists attachment metadata', async () => {
      const emailDataWithAttachments = {
        ...emailData,
        attachments: [{ id: 'att-1', filename: 'file.pdf', contentType: 'application/pdf' }],
      };
      emailRepo.findByExternalEmailId.mockResolvedValue(null);
      subdomainRepo.findBySubdomain.mockResolvedValue(null);
      companyRepo.findByEmailAddress.mockResolvedValue({ id: 5, emails: ['acme@mail.phonetastic.ai'] });
      endUserRepo.findByEmailAndCompanyId.mockResolvedValue({ id: 100 });
      chatRepo.findOpenByEndUserAndCompany.mockResolvedValue({ id: 20, subject: 'test' });
      emailRepo.create.mockResolvedValue({ id: 32 });
      chatRepo.update.mockResolvedValue({ id: 20 });

      await service.receiveInboundEmail(emailDataWithAttachments, 'ext-3');

      expect(attachmentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ emailId: 32, filename: 'file.pdf' }),
        db,
      );
    });
  });

  describe('sendOwnerReply', () => {
    it('throws when chat not found', async () => {
      userRepo.findById.mockResolvedValue({ id: 1, companyId: 5 });
      chatRepo.findById.mockResolvedValue(null);
      await expect(service.sendOwnerReply(1, 999, 'hi')).rejects.toThrow(NotFoundError);
    });

    it('throws when chat belongs to different company', async () => {
      userRepo.findById.mockResolvedValue({ id: 1, companyId: 5 });
      chatRepo.findById.mockResolvedValue({ id: 10, companyId: 99 });
      await expect(service.sendOwnerReply(1, 10, 'hi')).rejects.toThrow(NotFoundError);
    });

    it('creates pending email and disables bot', async () => {
      userRepo.findById.mockResolvedValue({ id: 1, companyId: 5 });
      chatRepo.findById.mockResolvedValue({ id: 10, companyId: 5 });
      emailRepo.create.mockResolvedValue({ id: 50, direction: 'outbound', status: 'pending' });
      chatRepo.update.mockResolvedValue({ id: 10, botEnabled: false });

      const result = await service.sendOwnerReply(1, 10, 'Thanks!');

      expect(emailRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ direction: 'outbound', userId: 1, status: 'pending' }),
        db,
      );
      expect(chatRepo.update).toHaveBeenCalledWith(10, expect.objectContaining({ botEnabled: false }), db);
    });
  });

  describe('toggleBot', () => {
    it('throws when chat not found', async () => {
      userRepo.findById.mockResolvedValue({ id: 1, companyId: 5 });
      chatRepo.findById.mockResolvedValue(null);
      await expect(service.toggleBot(1, 999, false)).rejects.toThrow(NotFoundError);
    });

    it('updates bot_enabled on the chat', async () => {
      userRepo.findById.mockResolvedValue({ id: 1, companyId: 5 });
      chatRepo.findById.mockResolvedValue({ id: 10, companyId: 5 });
      chatRepo.update.mockResolvedValue({ id: 10, botEnabled: false });

      const result = await service.toggleBot(1, 10, false);

      expect(chatRepo.update).toHaveBeenCalledWith(10, { botEnabled: false });
    });
  });

  describe('listEmails', () => {
    it('returns emails with attachments via expand join', async () => {
      userRepo.findById.mockResolvedValue({ id: 1, companyId: 5 });
      chatRepo.findById.mockResolvedValue({ id: 10, companyId: 5 });
      emailRepo.findAllByChatId.mockResolvedValue([
        { id: 1, bodyText: 'hi', attachments: [{ id: 1, filename: 'f.pdf' }] },
      ]);

      const result = await service.listEmails(1, 10);

      expect(result).toHaveLength(1);
      expect(result[0].attachments).toHaveLength(1);
    });
  });
});
