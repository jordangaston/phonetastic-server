import { injectable, inject } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { bots } from '../db/schema/bots.js';
import type { Database, Transaction } from '../db/index.js';

/**
 * Data access layer for bots.
 */
@injectable()
export class BotRepository {
  constructor(@inject('Database') private db: Database) {}

  /**
   * Persists a new bot record.
   *
   * @param data - The bot fields.
   * @param data.userId - The owning user's id.
   * @param data.name - The bot display name.
   * @param tx - Optional transaction to run within.
   * @returns The created bot row.
   */
  async create(data: { userId: number; name: string }, tx?: Transaction) {
    const [row] = await (tx ?? this.db).insert(bots).values(data).returning();
    return row;
  }

  /**
   * Finds a bot by primary key.
   *
   * @param id - The bot id.
   * @param tx - Optional transaction to run within.
   * @returns The bot row, or undefined.
   */
  async findById(id: number, tx?: Transaction) {
    const [row] = await (tx ?? this.db).select().from(bots).where(eq(bots.id, id));
    return row;
  }

  /**
   * Finds a bot by its owning user id.
   *
   * @param userId - The user id.
   * @param tx - Optional transaction to run within.
   * @returns The bot row, or undefined.
   */
  async findByUserId(userId: number, tx?: Transaction) {
    const [row] = await (tx ?? this.db).select().from(bots).where(eq(bots.userId, userId));
    return row;
  }
}
