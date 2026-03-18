import { injectable, inject } from 'tsyringe';
import { ChatRepository } from '../repositories/chat-repository.js';
import { EmailRepository } from '../repositories/email-repository.js';
import { AttachmentRepository } from '../repositories/attachment-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import { BadRequestError, NotFoundError } from '../lib/errors.js';
import type { ChatChannel } from '../db/schema/enums.js';

/**
 * Orchestrates chat operations: listing, toggling bot, and viewing emails.
 */
@injectable()
export class ChatService {
  constructor(
    @inject('ChatRepository') private chatRepo: ChatRepository,
    @inject('EmailRepository') private emailRepo: EmailRepository,
    @inject('AttachmentRepository') private attachmentRepo: AttachmentRepository,
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
