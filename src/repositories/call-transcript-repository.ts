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
   * Finds all transcripts for a given call.
   *
   * @param callId - The call id.
   * @param tx - Optional transaction to run within.
   * @returns Array of transcript rows for the call.
   */
  async findByCallId(callId: number, tx?: Transaction) {
    return (tx ?? this.db)
      .select()
      .from(callTranscripts)
      .where(eq(callTranscripts.callId, callId));
  }

  /**
   * Finds all transcripts for a set of call ids.
   *
   * @param callIds - The call ids to look up.
   * @param tx - Optional transaction to run within.
   * @returns Array of transcript rows.
   */
  async findByCallIds(callIds: number[], tx?: Transaction) {
    if (callIds.length === 0) return [];
    const { inArray } = await import('drizzle-orm');
    return (tx ?? this.db)
      .select()
      .from(callTranscripts)
      .where(inArray(callTranscripts.callId, callIds));
  }
}
