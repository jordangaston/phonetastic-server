import { injectable, inject } from 'tsyringe';
import { eq, sql, and, cosineDistance } from 'drizzle-orm';
import { faqs } from '../db/schema/faqs.js';
import type { Database, Transaction } from '../db/index.js';

/**
 * A FAQ row enriched with a cosine similarity score.
 */
export interface FaqSearchResult {
  id: number;
  companyId: number;
  question: string;
  answer: string;
  similarity: number;
}

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

  /**
   * Searches FAQs by cosine similarity against a query embedding.
   *
   * @precondition `queryEmbedding` must be a 1536-dimension vector.
   * @postcondition Results are ordered by descending similarity.
   * @param companyId - The company to search within.
   * @param queryEmbedding - The 1536-dim vector to compare against.
   * @param limit - Maximum results to return (default 5).
   * @returns FAQ rows with similarity scores, ordered by relevance.
   */
  async searchByEmbedding(
    companyId: number,
    queryEmbedding: number[],
    limit = 5,
  ): Promise<FaqSearchResult[]> {
    const distance = cosineDistance(faqs.embedding, queryEmbedding);
    const similarity = sql<number>`1 - (${distance})`.as('similarity');
    const rows = await this.db
      .select({
        id: faqs.id,
        companyId: faqs.companyId,
        question: faqs.question,
        answer: faqs.answer,
        similarity,
      })
      .from(faqs)
      .where(
        and(
          eq(faqs.companyId, companyId),
          sql`${faqs.embedding} IS NOT NULL`,
        ),
      )
      .orderBy(distance)
      .limit(limit);

    return rows;
  }

  /**
   * Updates embeddings for existing FAQ rows.
   *
   * @precondition Each update must reference an existing FAQ id.
   * @postcondition The embedding column is set for each referenced row.
   * @param updates - Array of `{ id, embedding }` pairs.
   * @param tx - Optional transaction to run within.
   */
  async updateEmbeddings(
    updates: Array<{ id: number; embedding: number[] }>,
    tx?: Transaction,
  ) {
    const db = tx ?? this.db;
    await Promise.all(
      updates.map((u) =>
        db
          .update(faqs)
          .set({ embedding: u.embedding })
          .where(eq(faqs.id, u.id)),
      ),
    );
  }
}
