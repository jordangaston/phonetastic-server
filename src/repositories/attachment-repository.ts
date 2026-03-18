import { injectable, inject } from 'tsyringe';
import { eq, inArray } from 'drizzle-orm';
import { attachments } from '../db/schema/attachments.js';
import type { Database, Transaction } from '../db/index.js';
import type { AttachmentStatus } from '../db/schema/enums.js';

/**
 * Data access layer for email attachments.
 */
@injectable()
export class AttachmentRepository {
  constructor(@inject('Database') private db: Database) {}

  /**
   * Persists a new attachment metadata record.
   *
   * @param data - Fields for the new attachment.
   * @param tx - Optional transaction to run within.
   * @returns The created attachment row.
   */
  async create(
    data: {
      emailId: number;
      externalAttachmentId?: string;
      filename: string;
      contentType: string;
      sizeBytes?: number;
      storageKey?: string;
      status?: AttachmentStatus;
    },
    tx?: Transaction,
  ) {
    const [row] = await (tx ?? this.db).insert(attachments).values(data).returning();
    return row;
  }

  /**
   * Finds an attachment by primary key.
   *
   * @param id - The attachment id.
   * @returns The attachment row, or undefined.
   */
  async findById(id: number) {
    const [row] = await this.db.select().from(attachments).where(eq(attachments.id, id));
    return row;
  }

  /**
   * Finds all attachments for an email.
   *
   * @param emailId - The email id.
   * @returns An array of attachment rows.
   */
  async findAllByEmailId(emailId: number) {
    return this.db.select().from(attachments).where(eq(attachments.emailId, emailId));
  }

  /**
   * Finds all attachments for multiple emails in a single query.
   *
   * @param emailIds - The email ids.
   * @returns An array of attachment rows.
   */
  async findAllByEmailIds(emailIds: number[]) {
    if (emailIds.length === 0) return [];
    return this.db.select().from(attachments).where(inArray(attachments.emailId, emailIds));
  }

  /**
   * Updates an attachment's storage fields after upload.
   *
   * @param id - The attachment id.
   * @param data - The fields to update.
   * @param tx - Optional transaction to run within.
   * @returns The updated attachment row, or undefined.
   */
  async update(
    id: number,
    data: { storageKey?: string; sizeBytes?: number; status?: AttachmentStatus; summary?: string },
    tx?: Transaction,
  ) {
    const [row] = await (tx ?? this.db).update(attachments).set(data).where(eq(attachments.id, id)).returning();
    return row;
  }
}
