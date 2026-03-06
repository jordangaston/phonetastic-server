import { injectable, inject } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { operationHours } from '../db/schema/operation-hours.js';
import type { Database, Transaction } from '../db/index.js';

/**
 * Data access layer for company operation hours.
 */
@injectable()
export class OperationHourRepository {
  constructor(@inject('Database') private db: Database) {}

  /**
   * Inserts multiple operation hour rows for a company.
   *
   * @param rows - The operation hour records to insert.
   * @param tx - Optional transaction to run within.
   * @returns The inserted operation hour rows.
   */
  async createMany(
    rows: Array<{ companyId: number; dayOfWeek: number; openTime: string; closeTime: string }>,
    tx?: Transaction,
  ) {
    return (tx ?? this.db).insert(operationHours).values(rows).returning();
  }

  /**
   * Finds all operation hours for a company.
   *
   * @param companyId - The company whose hours to find.
   * @param tx - Optional transaction to run within.
   * @returns The operation hour rows.
   */
  async findByCompanyId(companyId: number, tx?: Transaction) {
    return (tx ?? this.db).select().from(operationHours).where(eq(operationHours.companyId, companyId));
  }

  /**
   * Deletes all operation hours for a company.
   *
   * @param companyId - The company whose hours to delete.
   * @param tx - Optional transaction to run within.
   */
  async deleteByCompanyId(companyId: number, tx?: Transaction) {
    return (tx ?? this.db).delete(operationHours).where(eq(operationHours.companyId, companyId));
  }
}
