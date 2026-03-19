import { injectable, inject } from 'tsyringe';
import { ChatRepository } from '../repositories/chat-repository.js';
import { EmailRepository } from '../repositories/email-repository.js';
import { AttachmentRepository } from '../repositories/attachment-repository.js';
import { EmailAddressRepository } from '../repositories/email-address-repository.js';
import { SubdomainRepository } from '../repositories/subdomain-repository.js';
import { CompanyRepository } from '../repositories/company-repository.js';
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
    @inject('SubdomainRepository') private subdomainRepo: SubdomainRepository,
    @inject('CompanyRepository') private companyRepo: CompanyRepository,
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

    const resolved = await this.resolveCompany(emailData);
    if (!resolved) return null;

    const endUser = await this.findOrCreateEndUser(emailData.from, resolved.companyId);
    const chat = await this.findOrCreateChat(endUser.id, resolved.companyId, emailData);

    return this.persistInboundEmail(emailData, externalEmailId, resolved, endUser, chat);
  }

  /**
   * Persists the inbound email, attachments, and chat update in a single transaction.
   *
   * @param emailData - The received email content.
   * @param externalEmailId - The Resend email ID for dedup.
   * @param resolved - The resolved company and reply-to address.
   * @param endUser - The end user row.
   * @param chat - The chat row.
   * @returns The created email, chat, and isDuplicate flag.
   */
  private async persistInboundEmail(
    emailData: ReceivedEmail,
    externalEmailId: string,
    resolved: { companyId: number; replyToAddress: string | undefined },
    endUser: { id: number },
    chat: { id: number; subject: string | null },
  ) {
    return this.db.transaction(async (tx) => {
      const email = await this.createInboundEmailRow(emailData, externalEmailId, resolved, endUser, chat, tx);
      await this.createAttachmentRows(email.id, emailData.attachments, tx);
      await this.touchChat(chat, emailData.subject, tx);
      return { email, chat, isDuplicate: false };
    });
  }

  /**
   * Creates the inbound email row.
   *
   * @param emailData - The received email content.
   * @param externalEmailId - The Resend email ID.
   * @param resolved - The resolved company and reply-to address.
   * @param endUser - The end user row.
   * @param chat - The chat row.
   * @param tx - The transaction.
   * @returns The created email row.
   */
  private async createInboundEmailRow(
    emailData: ReceivedEmail,
    externalEmailId: string,
    resolved: { replyToAddress: string | undefined },
    endUser: { id: number },
    chat: { id: number },
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  ) {
    return this.emailRepo.create({
      chatId: chat.id, direction: 'inbound', endUserId: endUser.id,
      subject: emailData.subject, bodyText: emailData.text, bodyHtml: emailData.html,
      externalEmailId, messageId: emailData.messageId, inReplyTo: emailData.inReplyTo,
      referenceIds: emailData.references, from: emailData.from, to: emailData.to,
      forwardedTo: emailData.forwardedTo, replyTo: resolved.replyToAddress, status: 'received',
    }, tx);
  }

  /**
   * Creates attachment rows for an email within a transaction.
   *
   * @param emailId - The parent email id.
   * @param attachments - The attachment metadata from the received email.
   * @param tx - The transaction.
   */
  private async createAttachmentRows(
    emailId: number,
    attachments: ReceivedEmail['attachments'],
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  ) {
    for (const att of attachments) {
      await this.attachmentRepo.create({ emailId, externalAttachmentId: att.id, filename: att.filename, contentType: att.contentType }, tx);
    }
  }

  /**
   * Updates the chat's timestamp and optionally sets the subject from the first email.
   *
   * @param chat - The chat row.
   * @param subject - The email subject.
   * @param tx - The transaction.
   */
  private async touchChat(
    chat: { id: number; subject: string | null },
    subject: string | undefined,
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  ) {
    const updates = !chat.subject && subject
      ? { subject, updatedAt: new Date() }
      : { updatedAt: new Date() };
    await this.chatRepo.update(chat.id, updates, tx);
  }

  /**
   * Persists an owner reply email with status 'pending' and disables the bot.
   *
   * @precondition The user must belong to the chat's company.
   * @postcondition An outbound email row exists with status 'pending'. Bot is disabled on the chat.
   * @param userId - The authenticated user's id.
   * @param chatId - The chat id.
   * @param bodyText - The reply text content.
   * @param attachmentData - Optional attachment data (base64-encoded content).
   * @returns The created email row with attachments.
   * @throws {BadRequestError} If the user has no company.
   * @throws {NotFoundError} If the chat is not found or belongs to another company.
   */
  async sendOwnerReply(
    userId: number,
    chatId: number,
    bodyText: string,
    attachmentData?: { filename: string; contentType: string; content: string }[],
  ) {
    const companyId = await this.requireCompanyId(userId);
    const chat = await this.chatRepo.findById(chatId);
    if (!chat || chat.companyId !== companyId) throw new NotFoundError('Chat not found');

    return this.db.transaction(async (tx) => {
      const email = await this.emailRepo.create({
        chatId: chat.id,
        direction: 'outbound',
        userId,
        bodyText,
        status: 'pending',
      }, tx);

      const createdAttachments = [];
      if (attachmentData) {
        for (const att of attachmentData) {
          const row = await this.attachmentRepo.create({
            emailId: email.id,
            filename: att.filename,
            contentType: att.contentType,
          }, tx);
          createdAttachments.push(row);
        }
      }

      await this.chatRepo.update(chat.id, { botEnabled: false, updatedAt: new Date() }, tx);

      return { ...email, attachments: createdAttachments };
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
   * @param emailData - The received email data for threading.
   * @returns The chat row.
   */
  private async findOrCreateChat(
    endUserId: number,
    companyId: number,
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

    return this.chatRepo.create({ companyId, endUserId, channel: 'email' });
  }

  /**
   * Resolves the company and reply-to address from an inbound email.
   * Priority: subdomain extraction → company email_addresses array fallback.
   *
   * @param emailData - The received email data.
   * @returns The company id and reply-to address, or null if unresolvable.
   */
  private async resolveCompany(emailData: ReceivedEmail): Promise<{ companyId: number; replyToAddress: string | undefined } | null> {
    const subdomainMatch = await this.resolveBySubdomain(emailData);
    if (subdomainMatch) return subdomainMatch;
    return this.resolveByEmailAddress(emailData);
  }

  /**
   * Attempts to resolve a company by extracting the subdomain from the routing address.
   *
   * @param emailData - The received email data.
   * @returns The company id and reply-to address, or null if no subdomain match.
   */
  private async resolveBySubdomain(emailData: ReceivedEmail): Promise<{ companyId: number; replyToAddress: string | undefined } | null> {
    const routingAddress = emailData.forwardedTo ?? emailData.to[0];
    const subdomain = (routingAddress.split('@')[1] ?? '').split('.')[0];
    if (!subdomain) return null;

    const subRow = await this.subdomainRepo.findBySubdomain(subdomain);
    if (!subRow) return null;

    const company = await this.companyRepo.findById(subRow.companyId);
    return { companyId: subRow.companyId, replyToAddress: this.pickReplyToAddress(company?.emails ?? [], emailData.to) };
  }

  /**
   * Attempts to resolve a company by matching the to address against company emails.
   *
   * @param emailData - The received email data.
   * @returns The company id and reply-to address, or null if no match.
   */
  private async resolveByEmailAddress(emailData: ReceivedEmail): Promise<{ companyId: number; replyToAddress: string | undefined } | null> {
    const company = await this.companyRepo.findByEmailAddress(emailData.to[0]);
    if (!company) return null;
    return { companyId: company.id, replyToAddress: this.pickReplyToAddress(company.emails ?? [], emailData.to) };
  }

  /**
   * Picks a reply-to address by finding the first company email address
   * that appears in the to list.
   *
   * @param companyAddresses - The company's configured email addresses.
   * @param toList - The email's to addresses.
   * @returns The matching address, or the first company address, or undefined.
   */
  private pickReplyToAddress(companyAddresses: string[], toList: string[]): string | undefined {
    const toSet = new Set(toList.map((a) => a.toLowerCase()));
    const match = companyAddresses.find((a) => toSet.has(a.toLowerCase()));
    return match ?? companyAddresses[0] ?? undefined;
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
