import { injectable, inject } from 'tsyringe';
import { eq, gt, and, asc } from 'drizzle-orm';
import { subdomains } from '../db/schema/subdomains.js';
import type { Database, Transaction } from '../db/index.js';
import type { SubdomainStatus } from '../db/schema/enums.js';

const DEFAULT_PAGE_SIZE = 20;

/**
 * Data access layer for company subdomains.
 */
@injectable()
export class SubdomainRepository {
  constructor(@inject('Database') private db: Database) {}

  /**
   * Persists a new subdomain record.
   *
   * @param data - Fields for the new subdomain.
   * @param data.companyId - FK to the owning company.
   * @param data.subdomain - The unique subdomain string.
   * @param tx - Optional transaction to run within.
   * @returns The created subdomain row.
   */
  async create(data: { companyId: number; subdomain: string }, tx?: Transaction) {
    const [row] = await (tx ?? this.db).insert(subdomains).values(data).returning();
    return row;
  }

  /**
   * Finds a subdomain by primary key.
   *
   * @param id - The subdomain id.
   * @returns The subdomain row, or undefined.
   */
  async findById(id: number) {
    const [row] = await this.db.select().from(subdomains).where(eq(subdomains.id, id));
    return row;
  }

  /**
   * Finds a subdomain by its unique subdomain string.
   *
   * @param subdomain - The subdomain string to look up.
   * @returns The subdomain row, or undefined.
   */
  async findBySubdomain(subdomain: string) {
    const [row] = await this.db.select().from(subdomains).where(eq(subdomains.subdomain, subdomain));
    return row;
  }

  /**
   * Finds subdomains belonging to a company with cursor-based pagination.
   *
   * @param companyId - The company id.
   * @param opts - Pagination options.
   * @param opts.pageToken - Subdomain id cursor; returns rows with id greater than this.
   * @param opts.limit - Maximum rows to return (default 20).
   * @returns An array of subdomain rows ordered by id ascending.
   */
  async findAllByCompanyId(companyId: number, opts?: { pageToken?: number; limit?: number }) {
    const limit = opts?.limit ?? DEFAULT_PAGE_SIZE;
    const where = opts?.pageToken
      ? and(eq(subdomains.companyId, companyId), gt(subdomains.id, opts.pageToken))
      : eq(subdomains.companyId, companyId);
    return this.db.select().from(subdomains).where(where).orderBy(asc(subdomains.id)).limit(limit);
  }

  /**
   * Updates mutable subdomain fields.
   *
   * @param id - The subdomain id.
   * @param data - The fields to update.
   * @param tx - Optional transaction to run within.
   * @returns The updated subdomain row, or undefined.
   */
  async update(id: number, data: { resendDomainId?: string; status?: SubdomainStatus }, tx?: Transaction) {
    const [row] = await (tx ?? this.db).update(subdomains).set(data).where(eq(subdomains.id, id)).returning();
    return row;
  }
}
