import { injectable, inject } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { callParticipants } from '../db/schema/call-participants.js';
import type { CallState, ParticipantType } from '../db/schema/enums.js';
import type { Database, Transaction } from '../db/index.js';

/**
 * Data access layer for call participants.
 */
@injectable()
export class CallParticipantRepository {
  constructor(@inject('Database') private db: Database) {}

  /**
   * Persists a new call participant record.
   *
   * @param data - The participant fields.
   * @param data.callId - The call this participant belongs to.
   * @param data.type - The participant type (agent, bot, or end_user).
   * @param data.state - The participant's initial state.
   * @param data.botId - The bot id (required when type is bot).
   * @param data.userId - The user id. Indicates a test call between the user and their bot/agent.
   * @param data.endUserId - The end user id (required when type is end_user).
   * @param data.companyId - The company id.
   * @param tx - Optional transaction to run within.
   * @returns The created participant row.
   */
  async create(data: {
    callId: number;
    type: ParticipantType;
    state?: CallState;
    botId?: number;
    userId?: number;
    endUserId?: number;
    companyId?: number;
  }, tx?: Transaction) {
    const [row] = await (tx ?? this.db).insert(callParticipants).values(data).returning();
    return row;
  }

  /**
   * Updates the state of a call participant.
   *
   * @param id - The participant id.
   * @param state - The new state.
   * @param tx - Optional transaction to run within.
   */
  async updateState(id: number, state: CallState, tx?: Transaction): Promise<void> {
    await (tx ?? this.db).update(callParticipants).set({ state }).where(eq(callParticipants.id, id));
  }

  /**
   * Finds the first participant of a given type for a call.
   *
   * @param callId - The call id.
   * @param type - The participant type to look up.
   * @param tx - Optional transaction to run within.
   * @returns The participant row, or undefined.
   */
  async findByCallIdAndType(callId: number, type: ParticipantType, tx?: Transaction) {
    const [row] = await (tx ?? this.db)
      .select()
      .from(callParticipants)
      .where(and(eq(callParticipants.callId, callId), eq(callParticipants.type, type)));
    return row;
  }
}
