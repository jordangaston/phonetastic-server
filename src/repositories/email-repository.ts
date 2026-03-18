import { injectable, inject } from 'tsyringe';
import { eq, and, lt, asc, desc } from 'drizzle-orm';
import { emails } from '../db/schema/emails.js';
import type { Database, Transaction } from '../db/index.js';
import type { EmailDirection, EmailStatus } from '../db/schema/enums.js';

const DEFAULT_PAGE_SIZE = 20;

/**
 * Data access layer for email messages within chats.
 */
@injectable()
export class EmailRepository {
  constructor(@inject('Database') private db: Database) {}

  /**
   * Persists a new email record.
   *
   * @param data - Fields for the new email.
   * @param tx - Optional transaction to run within.
   * @returns The created email row.
   */
  async create(
    data: {
      chatId: number;
      direction: EmailDirection;
      endUserId?: number;
      botId?: number;
      userId?: number;
      subject?: string;
      bodyText?: string;
      bodyHtml?: string;
      externalEmailId?: string;
      messageId?: string;
      inReplyTo?: string;
      referenceIds?: string[];
      fromAddress?: string;
      toAddresses?: string[];
      forwardedTo?: string;
      replyToAddress?: string;
      status?: EmailStatus;
    },
    tx?: Transaction,
  ) {
    const [row] = await (tx ?? this.db).insert(emails).values(data).returning();
    return row;
  }

  /**
   * Finds an email by primary key.
   *
   * @param id - The email id.
   * @param tx - Optional transaction to run within.
   * @returns The email row, or undefined.
   */
  async findById(id: number, tx?: Transaction) {
    const [row] = await (tx ?? this.db).select().from(emails).where(eq(emails.id, id));
    return row;
  }

  /**
   * Finds an email by its external Resend email ID.
   *
   * @param externalEmailId - The Resend email ID.
   * @returns The email row, or undefined.
   */
  async findByExternalEmailId(externalEmailId: string) {
    const [row] = await this.db.select().from(emails).where(eq(emails.externalEmailId, externalEmailId));
    return row;
  }

  /**
   * Finds an email by its RFC Message-ID header.
   *
   * @param inReplyTo - The in_reply_to message ID to search for.
   * @returns The email row, or undefined.
   */
  async findByMessageId(messageId: string) {
    const [row] = await this.db.select().from(emails).where(eq(emails.messageId, messageId));
    return row;
  }

  /**
   * Returns a page of emails for a chat using cursor-based pagination.
   *
   * @param chatId - The chat id.
   * @param opts - Pagination and expand options.
   * @param opts.pageToken - Email id to start after (exclusive).
   * @param opts.limit - Maximum rows to return. Defaults to 20.
   * @param opts.expand - Optional list of relations to include via left join (e.g. ['attachments']).
   * @returns An array of email rows, with nested attachments when expanded.
   */
  async findAllByChatId(
    chatId: number,
    opts?: { pageToken?: number; limit?: number; expand?: ('attachments')[] },
  ) {
    const limit = opts?.limit ?? DEFAULT_PAGE_SIZE;

    if (opts?.expand?.includes('attachments')) {
      return this.db.query.emails.findMany({
        where: and(eq(emails.chatId, chatId), opts.pageToken ? lt(emails.id, opts.pageToken) : undefined),
        with: { attachments: true },
        orderBy: asc(emails.createdAt),
        limit,
      });
    }

    const conditions = [eq(emails.chatId, chatId)];
    if (opts?.pageToken) conditions.push(lt(emails.id, opts.pageToken));

    return this.db
      .select()
      .from(emails)
      .where(and(...conditions))
      .orderBy(asc(emails.createdAt))
      .limit(limit);
  }

  /**
   * Finds the most recent email in a chat.
   *
   * @param chatId - The chat id.
   * @returns The latest email row, or undefined.
   */
  async findLatestByChatId(chatId: number) {
    const [row] = await this.db
      .select()
      .from(emails)
      .where(eq(emails.chatId, chatId))
      .orderBy(desc(emails.createdAt))
      .limit(1);
    return row;
  }

  /**
   * Updates the status of an email.
   *
   * @param id - The email id.
   * @param status - The new status.
   * @param tx - Optional transaction to run within.
   * @returns The updated email row, or undefined.
   */
  async updateStatus(id: number, status: EmailStatus, tx?: Transaction) {
    const [row] = await (tx ?? this.db).update(emails).set({ status }).where(eq(emails.id, id)).returning();
    return row;
  }

  /**
   * Marks an email as sent with its RFC Message-ID.
   *
   * @param id - The email id.
   * @param messageId - The RFC Message-ID header value.
   * @param tx - Optional transaction to run within.
   * @returns The updated email row, or undefined.
   */
  async markSent(id: number, messageId: string, tx?: Transaction) {
    const [row] = await (tx ?? this.db)
      .update(emails)
      .set({ status: 'sent' as EmailStatus, messageId })
      .where(eq(emails.id, id))
      .returning();
    return row;
  }
}
