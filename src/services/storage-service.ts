import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const PRESIGN_EXPIRES_SECONDS = 48 * 60 * 60;

/**
 * Abstraction over object storage (Tigris/S3) for attachment file storage.
 */
export interface StorageService {
  /**
   * Uploads a file to object storage.
   *
   * @param key - The storage key (path) for the object.
   * @param content - The file content as a Buffer.
   * @param contentType - The MIME type of the file.
   */
  putObject(key: string, content: Buffer, contentType: string): Promise<void>;

  /**
   * Downloads a file from object storage.
   *
   * @param key - The storage key (path) of the object.
   * @returns The file content as a Buffer.
   */
  getObject(key: string): Promise<Buffer>;

  /**
   * Generates a presigned download URL for an object.
   *
   * @param key - The storage key (path) of the object.
   * @returns A presigned URL string valid for 48 hours.
   */
  getPresignedUrl(key: string): Promise<string>;
}

/**
 * Tigris-backed storage service using the S3-compatible API.
 *
 * @precondition Valid AWS credentials and endpoint URL for Tigris.
 * @postcondition Objects can be uploaded to and downloaded from the configured bucket.
 */
export class TigrisStorageService implements StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  /**
   * @param bucket - The Tigris bucket name.
   * @param endpoint - The Tigris S3 endpoint URL.
   * @param region - The AWS region (typically 'auto' for Tigris).
   */
  constructor(bucket: string, endpoint: string, region: string) {
    this.bucket = bucket;
    this.client = new S3Client({ region, endpoint, forcePathStyle: false });
  }

  /** {@inheritDoc StorageService.putObject} */
  async putObject(key: string, content: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: content,
      ContentType: contentType,
    }));
  }

  /** {@inheritDoc StorageService.getObject} */
  async getObject(key: string): Promise<Buffer> {
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
    return Buffer.from(await response.Body!.transformToByteArray());
  }

  /** {@inheritDoc StorageService.getPresignedUrl} */
  async getPresignedUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: PRESIGN_EXPIRES_SECONDS });
  }
}

/**
 * In-memory stub implementation of StorageService for testing.
 */
export class StubStorageService implements StorageService {
  private store = new Map<string, { content: Buffer; contentType: string }>();

  async putObject(key: string, content: Buffer, contentType: string): Promise<void> {
    this.store.set(key, { content, contentType });
  }

  async getObject(key: string): Promise<Buffer> {
    const entry = this.store.get(key);
    if (!entry) throw new Error(`Object not found: ${key}`);
    return entry.content;
  }

  async getPresignedUrl(key: string): Promise<string> {
    return `https://stub-storage.test/${key}?presigned=true`;
  }

  /**
   * Clears all stored objects. For testing.
   */
  clear(): void {
    this.store.clear();
  }
}
