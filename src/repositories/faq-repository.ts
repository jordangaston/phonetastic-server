import { injectable, inject } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { faqs } from '../db/schema/faqs.js';
import type { Database, Transaction } from '../db/index.js';

/**
 * Data access layer for company FAQs.
 */
@injectable()
export class FaqRepository {
  constructor(@inject('Database') private db: Database) {}

  /**
   * Inserts multiple FAQ rows for a company.
   *
   * @precondition `rows` must be non-empty and each row must reference a valid company.
   * @postcondition All rows are persisted in a single insert.
   * @param rows - The FAQ records to insert.
   * @param tx - Optional transaction to run within.
   * @returns The inserted FAQ rows.
   */
  async createMany(
    rows: Array<{ companyId: number; question: string; answer: string }>,
    tx?: Transaction,
  ) {
    return (tx ?? this.db).insert(faqs).values(rows).returning();
  }

  /**
   * Finds all FAQs belonging to a company.
   *
   * @param companyId - The company id.
   * @param tx - Optional transaction to run within.
   * @returns Array of FAQ rows.
   */
  async findByCompanyId(companyId: number, tx?: Transaction) {
    return (tx ?? this.db)
      .select()
      .from(faqs)
      .where(eq(faqs.companyId, companyId));
  }

  /**
   * Deletes all FAQs for a company.
   *
   * @param companyId - The company whose FAQs to delete.
   * @param tx - Optional transaction to run within.
   */
  async deleteByCompanyId(companyId: number, tx?: Transaction) {
    return (tx ?? this.db).delete(faqs).where(eq(faqs.companyId, companyId));
  }
}
