import { injectable, inject } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { callTranscripts } from '../db/schema/call-transcripts.js';
import type { Database, Transaction } from '../db/index.js';

/**
 * Data access layer for call transcripts.
 */
@injectable()
export class CallTranscriptRepository {
  constructor(@inject('Database') private db: Database) {}

  /**
   * Persists a new call transcript record (summary is null until the summarization workflow completes).
   *
   * @param data - The transcript fields.
   * @param data.callId - The call this transcript belongs to.
   * @param tx - Optional transaction to run within.
   * @returns The created transcript row.
   */
  async create(data: { callId: number }, tx?: Transaction) {
    const [row] = await (tx ?? this.db).insert(callTranscripts).values(data).returning();
    return row;
  }

  /**
   * Finds a call transcript by its associated call id.
   *
   * @param callId - The call id.
   * @param tx - Optional transaction to run within.
   * @returns The transcript row, or undefined.
   */
  async findByCallId(callId: number, tx?: Transaction) {
    const [row] = await (tx ?? this.db).select().from(callTranscripts).where(eq(callTranscripts.callId, callId));
    return row;
  }

  /**
   * Updates the summary of a call transcript.
   *
   * @param id - The transcript id.
   * @param summary - The AI-generated summary text.
   * @param tx - Optional transaction to run within.
   */
  async updateSummary(id: number, summary: string, tx?: Transaction): Promise<void> {
    await (tx ?? this.db).update(callTranscripts).set({ summary }).where(eq(callTranscripts.id, id));
  }
}
