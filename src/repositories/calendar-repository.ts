import { injectable, inject } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { calendars } from '../db/schema/calendars.js';
import type { Database, Transaction } from '../db/index.js';

/**
 * Data access layer for calendars.
 */
@injectable()
export class CalendarRepository {
  constructor(@inject('Database') private db: Database) {}

  /**
   * Persists a new calendar record.
   *
   * @precondition The referenced userId and companyId must exist.
   * @postcondition A new calendar row is inserted with provider metadata.
   * @param data - The calendar fields including externalId, name, and description.
   * @param tx - Optional transaction to run within.
   * @returns The created calendar row.
   */
  async create(data: {
    userId: number;
    companyId: number;
    provider: 'google';
    externalId: string;
    name: string;
    description: string | null;
    email: string;
    accessToken: string;
    refreshToken: string;
    tokenExpiresAt: Date;
  }, tx?: Transaction) {
    const [row] = await (tx ?? this.db).insert(calendars).values(data).returning();
    return row;
  }

  /**
   * Finds a calendar by user id.
   *
   * @param userId - The user id.
   * @param tx - Optional transaction to run within.
   * @returns The calendar row, or undefined.
   */
  async findByUserId(userId: number, tx?: Transaction) {
    const [row] = await (tx ?? this.db).select().from(calendars).where(eq(calendars.userId, userId));
    return row;
  }

  /**
   * Finds a calendar by company id.
   *
   * @param companyId - The company id.
   * @param tx - Optional transaction to run within.
   * @returns The calendar row, or undefined.
   */
  async findByCompanyId(companyId: number, tx?: Transaction) {
    const [row] = await (tx ?? this.db).select().from(calendars).where(eq(calendars.companyId, companyId));
    return row;
  }

  /**
   * Updates the OAuth tokens for a calendar record.
   *
   * @precondition A calendar with the given id must exist.
   * @postcondition The access token, refresh token, and expiry are updated.
   * @param id - The calendar row id.
   * @param data - The new token values.
   * @param tx - Optional transaction to run within.
   * @returns The updated calendar row, or undefined.
   */
  async updateTokens(id: number, data: {
    accessToken: string;
    refreshToken: string;
    tokenExpiresAt: Date;
  }, tx?: Transaction) {
    const [row] = await (tx ?? this.db).update(calendars).set(data).where(eq(calendars.id, id)).returning();
    return row;
  }
}
