import { injectable, inject } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { emailAddresses } from '../db/schema/email-addresses.js';
import type { Database, Transaction } from '../db/index.js';

/**
 * Data access layer for company email addresses.
 */
@injectable()
export class EmailAddressRepository {
  constructor(@inject('Database') private db: Database) {}

  /**
   * Persists a new email address record.
   *
   * @param data - Fields for the new email address.
   * @param data.companyId - FK to the owning company.
   * @param data.address - The full email address string.
   * @param tx - Optional transaction to run within.
   * @returns The created email address row.
   */
  async create(data: { companyId: number; address: string }, tx?: Transaction) {
    const [row] = await (tx ?? this.db).insert(emailAddresses).values(data).returning();
    return row;
  }

  /**
   * Finds an email address by primary key.
   *
   * @param id - The email address id.
   * @returns The email address row, or undefined.
   */
  async findById(id: number) {
    const [row] = await this.db.select().from(emailAddresses).where(eq(emailAddresses.id, id));
    return row;
  }

  /**
   * Finds an email address by its full address string.
   *
   * @param address - The email address to look up.
   * @returns The email address row, or undefined.
   */
  async findByAddress(address: string) {
    const [row] = await this.db.select().from(emailAddresses).where(eq(emailAddresses.address, address));
    return row;
  }

  /**
   * Finds all email addresses belonging to a company.
   *
   * @param companyId - The company id.
   * @returns An array of email address rows.
   */
  async findAllByCompanyId(companyId: number) {
    return this.db.select().from(emailAddresses).where(eq(emailAddresses.companyId, companyId));
  }
}
