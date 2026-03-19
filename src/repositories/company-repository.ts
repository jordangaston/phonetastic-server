import { injectable, inject } from 'tsyringe';
import { eq, sql } from 'drizzle-orm';
import { companies } from '../db/schema/companies.js';
import type { Database, Transaction } from '../db/index.js';

/**
 * Data access layer for companies.
 */
@injectable()
export class CompanyRepository {
  constructor(@inject('Database') private db: Database) {}

  /**
   * Persists a new company record.
   *
   * @param data - The company fields.
   * @param tx - Optional transaction to run within.
   * @returns The created company row.
   */
  async create(data: { name: string; businessType?: string; website?: string }, tx?: Transaction) {
    const [row] = await (tx ?? this.db).insert(companies).values(data).returning();
    return row;
  }

  /**
   * Finds a company by name.
   *
   * @param name - The company name.
   * @returns The company row, or undefined.
   */
  async findByName(name: string) {
    const [row] = await this.db.select().from(companies).where(eq(companies.name, name));
    return row;
  }

  /**
   * Finds a company by primary key.
   *
   * @param id - The company id.
   * @param tx - Optional transaction to run within.
   * @returns The company row, or undefined.
   */
  async findById(id: number, tx?: Transaction) {
    const [row] = await (tx ?? this.db).select().from(companies).where(eq(companies.id, id));
    return row;
  }

  /**
   * Finds a company by primary key with its related addresses, operation hours, and phone numbers.
   *
   * @param id - The company id.
   * @returns The company row with nested relations, or undefined.
   */
  async findWithRelations(id: number) {
    return this.db.query.companies.findFirst({
      where: eq(companies.id, id),
      with: { addresses: true, operationHours: true, phoneNumbers: true, faqs: true, offerings: true },
    });
  }

  /**
   * Finds a company whose emails array contains the given address.
   *
   * @param address - The email address to search for.
   * @returns The company row, or undefined.
   */
  async findByEmailAddress(address: string) {
    const [row] = await this.db
      .select()
      .from(companies)
      .where(sql`${companies.emails} @> ARRAY[${address}]::varchar[]`);
    return row;
  }

  /**
   * Updates a company's mutable fields.
   *
   * @param id - The company id.
   * @param data - The fields to update.
   * @param tx - Optional transaction to run within.
   * @returns The updated company row, or undefined.
   */
  async update(id: number, data: { name?: string; businessType?: string; website?: string; emails?: string[] }, tx?: Transaction) {
    const [row] = await (tx ?? this.db).update(companies).set(data).where(eq(companies.id, id)).returning();
    return row;
  }
}
