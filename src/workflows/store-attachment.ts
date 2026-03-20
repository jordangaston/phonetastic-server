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
    DBOS.logger.info({ attachmentId, companyId }, 'StoreAttachment started');
    const metadata = await StoreAttachment.loadMetadata(attachmentId);
    if (!metadata) return;

    const result = await StoreAttachment.downloadAndUpload(attachmentId, externalEmailId, companyId, metadata);
    DBOS.logger.debug({ attachmentId, sizeBytes: result.sizeBytes }, 'Attachment uploaded');
    await StoreAttachment.updateAttachmentRecord(attachmentId, result.storageKey, result.sizeBytes);
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
   * Step: downloads from Resend, builds storage key, and uploads to Tigris
   * in a single step so the file content is never cached as step output.
   *
   * @param attachmentId - The attachment row id.
   * @param externalEmailId - The Resend email ID.
   * @param companyId - The company ID for the storage key path.
   * @param metadata - The attachment metadata (externalAttachmentId, filename, contentType).
   * @returns The storage key and file size.
   */
  @DBOS.step(RETRY_CONFIG)
  static async downloadAndUpload(
    attachmentId: number,
    externalEmailId: string,
    companyId: number,
    metadata: { externalAttachmentId: string; filename: string; contentType: string },
  ): Promise<{ storageKey: string; sizeBytes: number }> {
    const resendService = container.resolve<ResendService>('ResendService');
    const storageService = container.resolve<StorageService>('StorageService');

    const content = await resendService.getAttachmentContent(externalEmailId, metadata.externalAttachmentId);
    const storageKey = StoreAttachment.buildStorageKey(companyId, externalEmailId, metadata.filename);
    await storageService.putObject(storageKey, content, metadata.contentType);

    return { storageKey, sizeBytes: content.length };
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
