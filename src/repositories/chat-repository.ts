import { injectable, inject } from 'tsyringe';
import { eq, and, lt, desc } from 'drizzle-orm';
import { chats } from '../db/schema/chats.js';
import type { Database, Transaction } from '../db/index.js';
import type { ChatChannel, ChatStatus } from '../db/schema/enums.js';

const DEFAULT_PAGE_SIZE = 20;

/**
 * Data access layer for chat conversations.
 */
@injectable()
export class ChatRepository {
  constructor(@inject('Database') private db: Database) {}

  /**
   * Persists a new chat record.
   *
   * @param data - Fields for the new chat.
   * @param tx - Optional transaction to run within.
   * @returns The created chat row.
   */
  async create(
    data: {
      companyId: number;
      endUserId: number;
      channel: ChatChannel;
      emailAddressId?: number;
      subject?: string;
    },
    tx?: Transaction,
  ) {
    const [row] = await (tx ?? this.db).insert(chats).values(data).returning();
    return row;
  }

  /**
   * Finds a chat by primary key.
   *
   * @param id - The chat id.
   * @param tx - Optional transaction to run within.
   * @returns The chat row, or undefined.
   */
  async findById(id: number, tx?: Transaction) {
    const [row] = await (tx ?? this.db).select().from(chats).where(eq(chats.id, id));
    return row;
  }

  /**
   * Finds an open chat between an end user and a company.
   *
   * @param endUserId - The end user id.
   * @param companyId - The company id.
   * @param tx - Optional transaction to run within.
   * @returns The open chat row, or undefined.
   */
  async findOpenByEndUserAndCompany(endUserId: number, companyId: number, tx?: Transaction) {
    const [row] = await (tx ?? this.db)
      .select()
      .from(chats)
      .where(and(eq(chats.endUserId, endUserId), eq(chats.companyId, companyId), eq(chats.status, 'open')));
    return row;
  }

  /**
   * Returns a page of chats for a company using cursor-based pagination.
   *
   * @param companyId - The company id.
   * @param opts - Pagination and filter options.
   * @param opts.channel - Optional channel filter.
   * @param opts.pageToken - Chat id to start before (exclusive).
   * @param opts.limit - Maximum rows to return. Defaults to 20.
   * @returns An array of chat rows ordered by updated_at descending.
   */
  async findAllByCompanyId(
    companyId: number,
    opts?: { channel?: ChatChannel; pageToken?: number; limit?: number },
  ) {
    const limit = opts?.limit ?? DEFAULT_PAGE_SIZE;
    const conditions = [eq(chats.companyId, companyId)];
    if (opts?.channel) conditions.push(eq(chats.channel, opts.channel));
    if (opts?.pageToken) conditions.push(lt(chats.id, opts.pageToken));

    return this.db
      .select()
      .from(chats)
      .where(and(...conditions))
      .orderBy(desc(chats.updatedAt))
      .limit(limit);
  }

  /**
   * Updates mutable chat fields.
   *
   * @param id - The chat id.
   * @param data - The fields to update.
   * @param tx - Optional transaction to run within.
   * @returns The updated chat row, or undefined.
   */
  async update(
    id: number,
    data: { botEnabled?: boolean; subject?: string; summary?: string; status?: ChatStatus; updatedAt?: Date },
    tx?: Transaction,
  ) {
    const [row] = await (tx ?? this.db).update(chats).set(data).where(eq(chats.id, id)).returning();
    return row;
  }
}
