import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TigrisStorageService, StubStorageService } from '../../../src/services/storage-service.js';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mockSend })),
  PutObjectCommand: vi.fn().mockImplementation((input) => ({ input })),
  GetObjectCommand: vi.fn().mockImplementation((input) => ({ input })),
}));

describe('TigrisStorageService', () => {
  let service: TigrisStorageService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TigrisStorageService('my-bucket', 'https://fly.storage.tigris.dev', 'auto');
  });

  describe('putObject', () => {
    it('sends PutObjectCommand with correct params', async () => {
      mockSend.mockResolvedValue({});

      await service.putObject('path/file.pdf', Buffer.from('data'), 'application/pdf');

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.Bucket).toBe('my-bucket');
      expect(cmd.input.Key).toBe('path/file.pdf');
      expect(cmd.input.ContentType).toBe('application/pdf');
    });
  });

  describe('getObject', () => {
    it('returns file content as Buffer', async () => {
      const bytes = new Uint8Array([10, 20, 30]);
      mockSend.mockResolvedValue({
        Body: { transformToByteArray: () => Promise.resolve(bytes) },
      });

      const result = await service.getObject('path/file.pdf');

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBe(3);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.Bucket).toBe('my-bucket');
      expect(cmd.input.Key).toBe('path/file.pdf');
    });
  });
});

describe('StubStorageService', () => {
  let stub: StubStorageService;

  beforeEach(() => { stub = new StubStorageService(); });

  it('stores and retrieves objects', async () => {
    await stub.putObject('k', Buffer.from('v'), 'text/plain');
    const result = await stub.getObject('k');
    expect(result.toString()).toBe('v');
  });

  it('throws on missing object', async () => {
    await expect(stub.getObject('missing')).rejects.toThrow('Object not found');
  });

  it('clears all objects', async () => {
    await stub.putObject('k', Buffer.from('v'), 'text/plain');
    stub.clear();
    await expect(stub.getObject('k')).rejects.toThrow();
  });
});
