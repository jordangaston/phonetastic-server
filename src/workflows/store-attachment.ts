import { DBOS } from '@dbos-inc/dbos-sdk';
import { eq } from 'drizzle-orm';
import { container } from 'tsyringe';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { attachments } from '../db/schema/attachments.js';
import type { AttachmentRepository } from '../repositories/attachment-repository.js';
import type { ResendService } from '../services/resend-service.js';
import type { StorageService } from '../services/storage-service.js';

const RETRY_CONFIG = {
  retriesAllowed: true,
  intervalSeconds: 2,
  maxAttempts: 3,
  backoffRate: 2,
};

/**
 * DBOS workflow that downloads an attachment from Resend and uploads it to Tigris.
 */
export class StoreAttachment {
  /**
   * Orchestrates attachment storage: download from Resend, upload to Tigris, update DB.
   *
   * @precondition An attachment row must exist with status 'pending'.
   * @postcondition The attachment row has storage_key, size_bytes, and status 'stored'.
   * @param attachmentId - The attachment row id.
   * @param externalEmailId - The Resend email ID for downloading.
   * @param companyId - The company ID for the storage key path.
   */
  @DBOS.workflow()
  static async run(attachmentId: number, externalEmailId: string, companyId: number): Promise<void> {
    const metadata = await StoreAttachment.loadMetadata(attachmentId);
    if (!metadata) return;

    const content = await StoreAttachment.downloadFromResend(externalEmailId, metadata.externalAttachmentId);
    const storageKey = StoreAttachment.buildStorageKey(companyId, externalEmailId, metadata.filename);
    await StoreAttachment.uploadToStorage(storageKey, content, metadata.contentType);
    await StoreAttachment.updateAttachmentRecord(attachmentId, storageKey, content.length);
  }

  /**
   * Step: loads attachment metadata from the database.
   *
   * @param attachmentId - The attachment id.
   * @returns The attachment metadata, or null if not found.
   */
  @DBOS.step()
  static async loadMetadata(attachmentId: number) {
    const attachmentRepo = container.resolve<AttachmentRepository>('AttachmentRepository');
    const attachment = await attachmentRepo.findById(attachmentId);
    if (!attachment) return null;

    return {
      externalAttachmentId: attachment.externalAttachmentId ?? '',
      filename: attachment.filename,
      contentType: attachment.contentType,
    };
  }

  /**
   * Step: downloads attachment content from Resend via signed URL.
   *
   * @param externalEmailId - The Resend email ID.
   * @param externalAttachmentId - The Resend attachment ID.
   * @returns The file content as a Buffer.
   */
  @DBOS.step(RETRY_CONFIG)
  static async downloadFromResend(externalEmailId: string, externalAttachmentId: string): Promise<Buffer> {
    const resendService = container.resolve<ResendService>('ResendService');
    return resendService.getAttachmentContent(externalEmailId, externalAttachmentId);
  }

  /**
   * Step: uploads content to object storage.
   *
   * @param storageKey - The storage key path.
   * @param content - The file content.
   * @param contentType - The MIME type.
   */
  @DBOS.step(RETRY_CONFIG)
  static async uploadToStorage(storageKey: string, content: Buffer, contentType: string): Promise<void> {
    const storageService = container.resolve<StorageService>('StorageService');
    await storageService.putObject(storageKey, content, contentType);
  }

  /**
   * Transaction: updates the attachment record with storage info.
   * Uses @DBOS.transaction to ensure workflow completion and DB write are atomic.
   *
   * @param attachmentId - The attachment id.
   * @param storageKey - The storage key where the file was uploaded.
   * @param sizeBytes - The file size in bytes.
   */
  @DBOS.transaction()
  static async updateAttachmentRecord(attachmentId: number, storageKey: string, sizeBytes: number): Promise<void> {
    const db = DBOS.drizzleClient as any;
    await db.update(attachments).set({ storageKey, sizeBytes, status: 'stored' }).where(eq(attachments.id, attachmentId));
  }

  /**
   * Builds a storage key path for an attachment.
   *
   * @param companyId - The company id.
   * @param emailId - The external email id.
   * @param filename - The original filename.
   * @returns The storage key string.
   */
  static buildStorageKey(companyId: number, emailId: string, filename: string): string {
    const ext = extname(filename) || '.bin';
    return `${companyId}/attachments/${emailId}/${randomUUID()}${ext}`;
  }
}
