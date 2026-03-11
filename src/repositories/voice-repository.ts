import { injectable, inject } from 'tsyringe';
import { eq, gt, asc } from 'drizzle-orm';
import { voices } from '../db/schema/voices.js';
import { botSettings } from '../db/schema/bot-settings.js';
import type { Database, Transaction } from '../db/index.js';

const DEFAULT_PAGE_SIZE = 20;

/**
 * Data access layer for voices.
 */
@injectable()
export class VoiceRepository {
  constructor(@inject('Database') private db: Database) { }

  /**
   * Finds a voice by bot id.
   *
   * @param botId - The bot id.
   * @param tx - Optional transaction to run within.
   * @returns The voice row, or null if no voice is found.
   */
  async findByBotId(botId: number | undefined, tx?: Transaction) {
    if (!botId) {
      return null;
    }

    const botSettingRow = await (tx ?? this.db).query.botSettings.findFirst({
      where: eq(botSettings.botId, botId),
    });
    if (!botSettingRow) {
      return null;
    }

    return (tx ?? this.db).query.voices.findFirst({
      where: eq(voices.id, botSettingRow.voiceId),
    });
  }

  /**
   * Returns a page of voices (without snippet data) using cursor-based pagination.
   *
   * @param opts - Pagination options.
   * @param opts.pageToken - Voice id to start after (exclusive). Omit for the first page.
   * @param opts.limit - Maximum number of rows to return. Defaults to 20.
   * @param tx - Optional transaction to run within.
   * @returns Array of voice summaries ordered by id ascending.
   */
  async findAll(opts?: { pageToken?: number; limit?: number }, tx?: Transaction) {
    const limit = opts?.limit ?? DEFAULT_PAGE_SIZE;

    return (tx ?? this.db).select({
      id: voices.id,
      name: voices.name,
      supportedLanguages: voices.supportedLanguages,
    }).from(voices)
      .where(opts?.pageToken ? gt(voices.id, opts.pageToken) : undefined)
      .orderBy(asc(voices.id))
      .limit(limit);
  }

  /**
   * Finds a voice by primary key (includes snippet).
   *
   * @param id - The voice id.
   * @param tx - Optional transaction to run within.
   * @returns The voice row, or undefined.
   */
  async findById(id: number, tx?: Transaction) {
    const [row] = await (tx ?? this.db).select().from(voices).where(eq(voices.id, id));
    return row;
  }

  /**
   * Returns the first voice ordered by id.
   *
   * @param tx - Optional transaction to run within.
   * @returns The first voice row, or undefined.
   */
  async findFirst(tx?: Transaction) {
    const [row] = await (tx ?? this.db).select().from(voices).orderBy(voices.id).limit(1);
    return row;
  }
}
