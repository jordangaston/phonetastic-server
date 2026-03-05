import { injectable, inject } from 'tsyringe';
import { asc, eq } from 'drizzle-orm';
import { callTranscriptEntries } from '../db/schema/call-transcript-entries.js';
import type { Database, Transaction } from '../db/index.js';

/**
 * Data access layer for call transcript entries.
 */
@injectable()
export class CallTranscriptEntryRepository {
  constructor(@inject('Database') private db: Database) {}

  /**
   * Persists a single transcript entry (one utterance from a speaker).
   *
   * @param data - The entry fields.
   * @param data.transcriptId - The parent transcript id.
   * @param data.text - The utterance text.
   * @param data.sequenceNumber - The position of this entry in the conversation.
   * @param data.endUserId - FK to end_users if the speaker is the end user.
   * @param data.botId - FK to bots if the speaker is the AI bot.
   * @param data.userId - FK to users if the speaker is a test agent user.
   * @param tx - Optional transaction to run within.
   * @returns The created entry row.
   */
  async create(data: {
    transcriptId: number;
    text: string;
    sequenceNumber: number;
    endUserId?: number;
    botId?: number;
    userId?: number;
  }, tx?: Transaction) {
    const [row] = await (tx ?? this.db).insert(callTranscriptEntries).values(data).returning();
    return row;
  }

  /**
   * Retrieves all entries for a transcript, ordered by sequence number.
   *
   * @param transcriptId - The transcript id.
   * @param tx - Optional transaction to run within.
   * @returns The entries in conversation order.
   */
  async findAllByTranscriptId(transcriptId: number, tx?: Transaction) {
    return (tx ?? this.db)
      .select()
      .from(callTranscriptEntries)
      .where(eq(callTranscriptEntries.transcriptId, transcriptId))
      .orderBy(asc(callTranscriptEntries.sequenceNumber));
  }
}
