import { DBOSClient } from '@dbos-inc/dbos-sdk';
import { buildDbUrl } from '../db/index.js';
import { injectable } from 'tsyringe';

/**
 * Factory for the DBOS external-process client.
 *
 * @remarks
 * Register as a singleton in the DI container and inject wherever a
 * `DBOSClient` is needed. Call `getInstance()` to obtain the lazily-created,
 * shared client.
 */
@injectable()
export class DBOSClientFactory {
  private client: Promise<DBOSClient> | null = null;

  /**
   * Returns the `DBOSClient`, creating it on first invocation.
   *
   * @postcondition The same promise is returned on every subsequent call.
   * @returns A promise resolving to the shared `DBOSClient` instance.
   */
  getInstance(): Promise<DBOSClient> {
    if (!this.client) {
      this.client = DBOSClient.create(buildDbUrl());
    }
    return this.client;
  }
}
