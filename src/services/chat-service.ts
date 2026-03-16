import { injectable, inject } from 'tsyringe';
import { ChatRepository } from '../repositories/chat-repository.js';
import { EmailRepository } from '../repositories/email-repository.js';
import { AttachmentRepository } from '../repositories/attachment-repository.js';
import { EmailAddressRepository } from '../repositories/email-address-repository.js';
import { EndUserRepository } from '../repositories/end-user-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import { BadRequestError, NotFoundError } from '../lib/errors.js';
import type { Database } from '../db/index.js';
import type { ChatChannel } from '../db/schema/enums.js';
import type { ReceivedEmail } from './resend-service.js';

/**
 * Orchestrates chat operations: listing, toggling bot, receiving email, and viewing emails.
 */
@injectable()
export class ChatService {
  constructor(
    @inject('Database') private db: Database,
    @inject('ChatRepository') private chatRepo: ChatRepository,
    @inject('EmailRepository') private emailRepo: EmailRepository,
    @inject('AttachmentRepository') private attachmentRepo: AttachmentRepository,
    @inject('EmailAddressRepository') private emailAddressRepo: EmailAddressRepository,
    @inject('EndUserRepository') private endUserRepo: EndUserRepository,
    @inject('UserRepository') private userRepo: UserRepository,
  ) {}

  /**
   * Returns a paginated list of chats for the authenticated user's company.
   *
   * @precondition The user must belong to a company.
   * @param userId - The authenticated user's id.
   * @param opts - Pagination and filter options.
   * @param opts.channel - Optional channel filter (e.g. 'email').
   * @param opts.pageToken - Chat id cursor for pagination.
   * @param opts.limit - Maximum rows to return.
   * @returns An array of chat rows.
   * @throws {BadRequestError} If the user has no company.
   */
  async listChats(userId: number, opts?: { channel?: ChatChannel; pageToken?: number; limit?: number }) {
    const companyId = await this.requireCompanyId(userId);
    return this.chatRepo.findAllByCompanyId(companyId, opts);
  }

  /**
   * Toggles the bot_enabled flag on a chat.
   *
   * @precondition The user must belong to the chat's company.
   * @param userId - The authenticated user's id.
   * @param chatId - The chat id.
   * @param botEnabled - The new bot_enabled value.
   * @returns The updated chat row.
   * @throws {BadRequestError} If the user has no company.
   * @throws {NotFoundError} If the chat is not found or belongs to another company.
   */
  async toggleBot(userId: number, chatId: number, botEnabled: boolean) {
    const companyId = await this.requireCompanyId(userId);
    const chat = await this.chatRepo.findById(chatId);
    if (!chat || chat.companyId !== companyId) throw new NotFoundError('Chat not found');
    return this.chatRepo.update(chatId, { botEnabled });
  }

  /**
   * Persists an inbound email and its attachment metadata, linking to a chat.
   *
   * @precondition The `to` address must match an email_addresses row.
   * @postcondition An email row and attachment metadata rows exist. Chat subject is set from first email.
   * @param emailData - The received email content from Resend.
   * @param externalEmailId - The Resend email ID for dedup.
   * @returns The created email row, chat row, and whether a workflow should be started.
   */
  async receiveInboundEmail(emailData: ReceivedEmail, externalEmailId: string) {
    const existing = await this.emailRepo.findByExternalEmailId(externalEmailId);
    if (existing) return { email: existing, chat: await this.chatRepo.findById(existing.chatId), isDuplicate: true };

    const toAddress = emailData.to[0];
    const emailAddress = await this.emailAddressRepo.findByAddress(toAddress);
    if (!emailAddress) return null;

    const endUser = await this.findOrCreateEndUser(emailData.from, emailAddress.companyId);
    const chat = await this.findOrCreateChat(endUser.id, emailAddress.companyId, emailAddress.id, emailData);

    return this.db.transaction(async (tx) => {
      const email = await this.emailRepo.create({
        chatId: chat.id,
        direction: 'inbound',
        endUserId: endUser.id,
        subject: emailData.subject,
        bodyText: emailData.text,
        bodyHtml: emailData.html,
        externalEmailId,
        messageId: emailData.messageId,
        inReplyTo: emailData.inReplyTo,
        referenceIds: emailData.references,
        status: 'received',
      }, tx);

      for (const att of emailData.attachments) {
        await this.attachmentRepo.create({
          emailId: email.id,
          externalAttachmentId: att.id,
          filename: att.filename,
          contentType: att.contentType,
        }, tx);
      }

      if (!chat.subject && emailData.subject) {
        await this.chatRepo.update(chat.id, { subject: emailData.subject, updatedAt: new Date() }, tx);
      } else {
        await this.chatRepo.update(chat.id, { updatedAt: new Date() }, tx);
      }

      return { email, chat, isDuplicate: false };
    });
  }

  /**
   * Returns a paginated list of emails in a chat with attachment metadata.
   *
   * @precondition The user must belong to the chat's company.
   * @param userId - The authenticated user's id.
   * @param chatId - The chat id.
   * @param opts - Pagination options.
   * @param opts.pageToken - Email id cursor for pagination.
   * @param opts.limit - Maximum rows to return.
   * @returns An array of email rows with nested attachments.
   * @throws {BadRequestError} If the user has no company.
   * @throws {NotFoundError} If the chat is not found or belongs to another company.
   */
  async listEmails(userId: number, chatId: number, opts?: { pageToken?: number; limit?: number }) {
    const companyId = await this.requireCompanyId(userId);
    const chat = await this.chatRepo.findById(chatId);
    if (!chat || chat.companyId !== companyId) throw new NotFoundError('Chat not found');

    return this.emailRepo.findAllByChatId(chatId, { ...opts, expand: ['attachments'] });
  }

  /**
   * Finds or creates an end user by sender email and company.
   *
   * @param senderEmail - The sender's email address.
   * @param companyId - The company id.
   * @returns The end user row.
   */
  private async findOrCreateEndUser(senderEmail: string, companyId: number) {
    const existing = await this.endUserRepo.findByEmailAndCompanyId(senderEmail, companyId);
    if (existing) return existing;
    return this.endUserRepo.create({ companyId, email: senderEmail });
  }

  /**
   * Finds an open chat or creates a new one. Uses in_reply_to for threading.
   *
   * @param endUserId - The end user id.
   * @param companyId - The company id.
   * @param emailAddressId - The email address id.
   * @param emailData - The received email data for threading.
   * @returns The chat row.
   */
  private async findOrCreateChat(
    endUserId: number,
    companyId: number,
    emailAddressId: number,
    emailData: ReceivedEmail,
  ) {
    if (emailData.inReplyTo) {
      const parent = await this.emailRepo.findByMessageId(emailData.inReplyTo);
      if (parent) {
        const chat = await this.chatRepo.findById(parent.chatId);
        if (chat) return chat;
      }
    }

    const openChat = await this.chatRepo.findOpenByEndUserAndCompany(endUserId, companyId);
    if (openChat) return openChat;

    return this.chatRepo.create({ companyId, endUserId, channel: 'email', emailAddressId });
  }

  /**
   * Resolves the company id for a user, throwing if not found.
   *
   * @param userId - The user id.
   * @returns The company id.
   * @throws {BadRequestError} If the user has no company.
   */
  private async requireCompanyId(userId: number): Promise<number> {
    const user = await this.userRepo.findById(userId);
    if (!user?.companyId) throw new BadRequestError('User has no company');
    return user.companyId;
  }
}
