import { injectable, inject } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { offerings } from '../db/schema/offerings.js';
import type { Database, Transaction } from '../db/index.js';

/**
 * Offering row shape accepted by {@link OfferingRepository.createMany}.
 */
export interface NewOffering {
  companyId: number;
  type: 'product' | 'service';
  name: string;
  description?: string;
  priceAmount?: string;
  priceCurrency?: string;
  priceFrequency?:
    | 'one_time'
    | 'hourly'
    | 'daily'
    | 'weekly'
    | 'monthly'
    | 'yearly';
}

/**
 * Data access layer for company offerings (products and services).
 */
@injectable()
export class OfferingRepository {
  constructor(@inject('Database') private db: Database) {}

  /**
   * Inserts multiple offering rows for a company.
   *
   * @precondition `rows` must be non-empty and each row must reference a valid company.
   * @postcondition All rows are persisted in a single insert.
   * @param rows - The offering records to insert.
   * @param tx - Optional transaction to run within.
   * @returns The inserted offering rows.
   */
  async createMany(rows: NewOffering[], tx?: Transaction) {
    return (tx ?? this.db).insert(offerings).values(rows).returning();
  }

  /**
   * Finds all offerings belonging to a company.
   *
   * @param companyId - The company id.
   * @param tx - Optional transaction to run within.
   * @returns Array of offering rows.
   */
  async findByCompanyId(companyId: number, tx?: Transaction) {
    return (tx ?? this.db)
      .select()
      .from(offerings)
      .where(eq(offerings.companyId, companyId));
  }

  /**
   * Deletes all offerings for a company.
   *
   * @param companyId - The company whose offerings to delete.
   * @param tx - Optional transaction to run within.
   */
  async deleteByCompanyId(companyId: number, tx?: Transaction) {
    return (tx ?? this.db).delete(offerings).where(eq(offerings.companyId, companyId));
  }
}
