import type { DnsRecord } from './resend-domain-service.js';

/**
 * Abstraction over GoDaddy's DNS API for configuring DNS records.
 */
export interface GoDaddyDnsService {
  /**
   * Creates or updates a single DNS record on the managed domain.
   *
   * @param record - The DNS record to create/update.
   */
  configureDnsRecord(record: DnsRecord): Promise<void>;
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
   * @param domain - The managed domain (e.g. "phonetastic.ai").
   */
  constructor(apiKey: string, apiSecret: string, domain: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.domain = domain;
  }

  /** {@inheritDoc GoDaddyDnsService.configureDnsRecord} */
  async configureDnsRecord(record: DnsRecord): Promise<void> {
    const body = [{ data: record.value, ttl: 600, priority: record.priority }];

    const response = await fetch(
      `https://api.godaddy.com/v1/domains/${this.domain}/records/${record.type}/${record.name}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `sso-key ${this.apiKey}:${this.apiSecret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GoDaddy DNS update failed for ${record.type} ${record.name}: ${text}`);
    }
  }
}

/**
 * Stub implementation of GoDaddyDnsService for testing.
 */
export class StubGoDaddyDnsService implements GoDaddyDnsService {
  configuredRecords: DnsRecord[] = [];

  async configureDnsRecord(record: DnsRecord): Promise<void> {
    this.configuredRecords.push(record);
  }
}
