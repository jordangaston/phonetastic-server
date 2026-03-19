import { Resend } from 'resend';

/**
 * Describes a DNS record required for domain verification.
 */
export interface DnsRecord {
  type: string;
  name: string;
  value: string;
  priority?: number;
}

/**
 * Abstraction over Resend's domain management API.
 */
export interface ResendDomainService {
  /**
   * Creates a new sending domain in Resend.
   *
   * @param subdomain - The subdomain to register (e.g. "acme").
   * @returns The Resend domain ID and required DNS records.
   */
  createDomain(subdomain: string): Promise<{ id: string; records: DnsRecord[] }>;

  /**
   * Triggers DNS verification for a domain.
   *
   * @param domainId - The Resend domain ID.
   */
  triggerVerification(domainId: string): Promise<void>;

  /**
   * Retrieves the current verification status of a domain.
   *
   * @param domainId - The Resend domain ID.
   * @returns The domain status string (e.g. 'verified', 'pending', 'failed').
   */
  checkVerification(domainId: string): Promise<string>;
}

/**
 * Production Resend domain service backed by the Resend SDK.
 *
 * @precondition Valid Resend API key with domain management permissions.
 */
export class ResendDomainServiceImpl implements ResendDomainService {
  private readonly client: Resend;

  /**
   * @param apiKey - Resend API key.
   */
  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  /** {@inheritDoc ResendDomainService.createDomain} */
  async createDomain(subdomain: string): Promise<{ id: string; records: DnsRecord[] }> {
    const { data, error } = await this.client.domains.create({ name: `${subdomain}.phonetastic.ai` });
    if (error) throw new Error(`Resend createDomain failed: ${error.message}`);
    const records = (data!.records ?? []).map((r: any) => ({
      type: r.type,
      name: r.name,
      value: r.value,
      priority: r.priority ?? undefined,
    }));
    return { id: data!.id, records };
  }

  /** {@inheritDoc ResendDomainService.triggerVerification} */
  async triggerVerification(domainId: string): Promise<void> {
    const { error } = await this.client.domains.verify(domainId);
    if (error) throw new Error(`Resend triggerVerification failed: ${error.message}`);
  }

  /** {@inheritDoc ResendDomainService.checkVerification} */
  async checkVerification(domainId: string): Promise<string> {
    const { data, error } = await this.client.domains.get(domainId);
    if (error) throw new Error(`Resend checkVerification failed: ${error.message}`);
    return data!.status;
  }
}

/**
 * Stub implementation of ResendDomainService for testing.
 */
export class StubResendDomainService implements ResendDomainService {
  domains: Map<string, { status: string; records: DnsRecord[] }> = new Map();
  private counter = 0;

  async createDomain(subdomain: string): Promise<{ id: string; records: DnsRecord[] }> {
    this.counter++;
    const id = `domain-${this.counter}`;
    const records: DnsRecord[] = [
      { type: 'MX', name: `${subdomain}.phonetastic.ai`, value: 'feedback-smtp.us-east-1.amazonses.com', priority: 10 },
      { type: 'TXT', name: `${subdomain}.phonetastic.ai`, value: 'v=spf1 include:amazonses.com ~all' },
    ];
    this.domains.set(id, { status: 'not_started', records });
    return { id, records };
  }

  async triggerVerification(_domainId: string): Promise<void> {}

  async checkVerification(domainId: string): Promise<string> {
    return this.domains.get(domainId)?.status ?? 'not_started';
  }
}
