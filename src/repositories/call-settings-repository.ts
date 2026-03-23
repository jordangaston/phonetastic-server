import { injectable, inject } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { callSettings } from '../db/schema/call-settings.js';
import type { Database, Transaction } from '../db/index.js';
import type { AnswerCallsFrom } from '../db/schema/enums.js';

/**
 * Data access layer for call settings.
 */
@injectable()
export class CallSettingsRepository {
  constructor(@inject('Database') private db: Database) {}

  /**
   * Persists a new call settings record.
   *
   * @param data - The call settings fields.
   * @param tx - Optional transaction to run within.
   * @returns The created call settings row.
   */
  async create(data: {
    forwardedPhoneNumberId: number;
    companyPhoneNumberId: number;
    userId: number;
  }, tx?: Transaction) {
    const [row] = await (tx ?? this.db).insert(callSettings).values(data).returning();
    return row;
  }

  /**
   * Finds call settings by user id.
   *
   * @param userId - The user id.
   * @param tx - Optional transaction to run within.
   * @returns The call settings row, or undefined.
   */
  async findByUserId(userId: number, tx?: Transaction) {
    const [row] = await (tx ?? this.db).select().from(callSettings).where(eq(callSettings.userId, userId));
    return row;
  }

  /**
   * Updates call settings fields.
   *
   * @param id - The call settings id.
   * @param data - The fields to update.
   * @param tx - Optional transaction to run within.
   * @returns The updated row, or undefined.
   */
  async update(id: number, data: {
    forwardedPhoneNumberId?: number;
    companyPhoneNumberId?: number;
    isBotEnabled?: boolean;
    ringsBeforeBotAnswer?: number;
    answerCallsFrom?: AnswerCallsFrom;
    sipDispatchRuleId?: string;
  }, tx?: Transaction) {
    const [row] = await (tx ?? this.db).update(callSettings).set(data).where(eq(callSettings.id, id)).returning();
    return row;
  }
}
