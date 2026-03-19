import type { DnsRecord } from './resend-domain-service.js';

/**
 * Abstraction over GoDaddy's DNS API for configuring DNS records.
 */
export interface GoDaddyDnsService {
  /**
   * Configures DNS records on the managed domain.
   *
   * @param records - The DNS records to create/update.
   */
  configureDns(records: DnsRecord[]): Promise<void>;
}

/**
 * Production GoDaddy DNS service backed by the GoDaddy API.
 *
 * @precondition Valid GoDaddy API key, secret, and domain.
 */
export class GoDaddyDnsServiceImpl implements GoDaddyDnsService {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly domain: string;

  /**
   * @param apiKey - GoDaddy API key.
   * @param apiSecret - GoDaddy API secret.
   * @param domain - The managed domain (e.g. "mail.phonetastic.ai").
   */
  constructor(apiKey: string, apiSecret: string, domain: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.domain = domain;
  }

  /** {@inheritDoc GoDaddyDnsService.configureDns} */
  async configureDns(records: DnsRecord[]): Promise<void> {
    for (const record of records) {
      await this.putRecord(record);
    }
  }

  /**
   * Sends a single DNS record to the GoDaddy API.
   *
   * @param record - The DNS record to create/update.
   * @throws {Error} If the API responds with a non-OK status.
   */
  private async putRecord(record: DnsRecord): Promise<void> {
    const name = record.name.replace(`.${this.domain}`, '') || '@';
    const body = [{ data: record.value, ttl: 600, priority: record.priority }];
    const url = `https://api.godaddy.com/v1/domains/${this.domain}/records/${record.type}/${name}`;

    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Authorization': `sso-key ${this.apiKey}:${this.apiSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GoDaddy DNS update failed for ${record.type} ${name}: ${text}`);
    }
  }
}

/**
 * Stub implementation of GoDaddyDnsService for testing.
 */
export class StubGoDaddyDnsService implements GoDaddyDnsService {
  configuredRecords: DnsRecord[] = [];

  async configureDns(records: DnsRecord[]): Promise<void> {
    this.configuredRecords.push(...records);
  }
}
