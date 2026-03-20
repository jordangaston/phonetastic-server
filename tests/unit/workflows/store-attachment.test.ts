import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@dbos-inc/dbos-sdk', () => ({
  DBOS: {
    step: () => (_t: unknown, _k: string, d: PropertyDescriptor) => d,
    workflow: () => (_t: unknown, _k: string, d: PropertyDescriptor) => d,
    transaction: () => (_t: unknown, _k: string, d: PropertyDescriptor) => d,
    drizzleClient: { update: vi.fn() },
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}));

const mockContainer = vi.hoisted(() => ({
  container: { resolve: vi.fn() },
}));
vi.mock('tsyringe', () => mockContainer);

import { StoreAttachment } from '../../../src/workflows/store-attachment.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StoreAttachment.loadMetadata', () => {
  it('returns metadata when attachment exists', async () => {
    const mockRepo = {
      findById: vi.fn().mockResolvedValue({
        id: 1,
        externalAttachmentId: 'ext-123',
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
      }),
    };
    mockContainer.container.resolve.mockReturnValue(mockRepo);

    const result = await StoreAttachment.loadMetadata(1);

    expect(result).toEqual({
      externalAttachmentId: 'ext-123',
      filename: 'invoice.pdf',
      contentType: 'application/pdf',
    });
  });

  it('returns null when attachment not found', async () => {
    const mockRepo = { findById: vi.fn().mockResolvedValue(undefined) };
    mockContainer.container.resolve.mockReturnValue(mockRepo);

    const result = await StoreAttachment.loadMetadata(999);

    expect(result).toBeNull();
  });

  it('defaults externalAttachmentId to empty string when null', async () => {
    const mockRepo = {
      findById: vi.fn().mockResolvedValue({
        id: 1,
        externalAttachmentId: null,
        filename: 'file.txt',
        contentType: 'text/plain',
      }),
    };
    mockContainer.container.resolve.mockReturnValue(mockRepo);

    const result = await StoreAttachment.loadMetadata(1);

    expect(result!.externalAttachmentId).toBe('');
  });
});

describe('StoreAttachment.downloadAndUpload', () => {
  it('downloads from Resend, uploads to storage, and returns key and size', async () => {
    const content = Buffer.from('file-content');
    const mockResend = { getAttachmentContent: vi.fn().mockResolvedValue(content) };
    const mockStorage = { putObject: vi.fn().mockResolvedValue(undefined) };
    mockContainer.container.resolve
      .mockReturnValueOnce(mockResend)
      .mockReturnValueOnce(mockStorage);

    const result = await StoreAttachment.downloadAndUpload(1, 'email-ext-1', 5, {
      externalAttachmentId: 'att-ext-1',
      filename: 'report.pdf',
      contentType: 'application/pdf',
    });

    expect(mockResend.getAttachmentContent).toHaveBeenCalledWith('email-ext-1', 'att-ext-1');
    expect(mockStorage.putObject).toHaveBeenCalledWith(
      expect.stringContaining('5/attachments/email-ext-1/'),
      content,
      'application/pdf',
    );
    expect(result.storageKey).toContain('5/attachments/email-ext-1/');
    expect(result.storageKey).toMatch(/\.pdf$/);
    expect(result.sizeBytes).toBe(content.length);
  });
});

describe('StoreAttachment.buildStorageKey', () => {
  it('produces a key with company id, email id, and correct extension', () => {
    const key = StoreAttachment.buildStorageKey(7, 'resend-abc', 'photo.png');

    expect(key).toMatch(/^7\/attachments\/resend-abc\/[a-f0-9-]+\.png$/);
  });

  it('falls back to .bin when filename has no extension', () => {
    const key = StoreAttachment.buildStorageKey(1, 'e1', 'noext');

    expect(key).toMatch(/\.bin$/);
  });
});

describe('StoreAttachment.run', () => {
  it('skips download when metadata is null', async () => {
    const mockRepo = { findById: vi.fn().mockResolvedValue(undefined) };
    mockContainer.container.resolve.mockReturnValue(mockRepo);

    await StoreAttachment.run(999, 'ext-email', 1);

    expect(mockContainer.container.resolve).toHaveBeenCalledTimes(1);
  });
});
