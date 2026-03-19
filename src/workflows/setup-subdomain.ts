import { DBOS, WorkflowQueue } from '@dbos-inc/dbos-sdk';
import { container } from 'tsyringe';
import type { SubdomainRepository } from '../repositories/subdomain-repository.js';
import type { ResendDomainService, DnsRecord } from '../services/resend-domain-service.js';
import type { GoDaddyDnsService } from '../services/godaddy-dns-service.js';
import type { SubdomainStatus } from '../db/schema/enums.js';

export const setupSubdomainQueue = new WorkflowQueue('setup-subdomain');

const MAX_POLL_ATTEMPTS = 10;
const POLL_INTERVAL_SECONDS = 30;
const TERMINAL_STATUSES = new Set<string>(['verified', 'failed', 'partially_failed']);

/**
 * DBOS workflow that sets up a subdomain: creates a Resend domain,
 * configures DNS via GoDaddy, and polls for verification.
 */
export class SetupSubdomain {
  /**
   * Orchestrates subdomain setup: create domain, store ID, configure each
   * DNS record individually, trigger verification, poll until done.
   *
   * @precondition A subdomain row must exist in the database.
   * @postcondition The subdomain status reflects the Resend domain status.
   * @param subdomainId - The subdomain row id.
   */
  @DBOS.workflow()
  static async run(subdomainId: number): Promise<void> {
    const { id: domainId, records } = await SetupSubdomain.createResendDomain(subdomainId);
    await SetupSubdomain.storeResendDomainId(subdomainId, domainId);

    for (const record of records) {
      await SetupSubdomain.configureDnsRecord(record);
    }

    await SetupSubdomain.triggerVerification(domainId);

    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      const finished = await SetupSubdomain.checkVerificationStatus(subdomainId, domainId);
      if (finished) return;
      await DBOS.sleepSeconds(POLL_INTERVAL_SECONDS);
    }

    await SetupSubdomain.updateStatus(subdomainId, 'failed');
  }

  /**
   * Step: creates a Resend domain for the subdomain.
   *
   * @param subdomainId - The subdomain row id.
   * @returns The Resend domain ID and required DNS records.
   */
  @DBOS.step()
  static async createResendDomain(subdomainId: number): Promise<{ id: string; records: DnsRecord[] }> {
    const subdomainRepo = container.resolve<SubdomainRepository>('SubdomainRepository');
    const resendDomainService = container.resolve<ResendDomainService>('ResendDomainService');
    const sub = await subdomainRepo.findById(subdomainId);
    if (!sub) throw new Error(`Subdomain ${subdomainId} not found`);
    return resendDomainService.createDomain(sub.subdomain);
  }

  /**
   * Step: stores the Resend domain ID on the subdomain row.
   *
   * @param subdomainId - The subdomain row id.
   * @param domainId - The Resend domain ID.
   */
  @DBOS.step()
  static async storeResendDomainId(subdomainId: number, domainId: string): Promise<void> {
    const subdomainRepo = container.resolve<SubdomainRepository>('SubdomainRepository');
    await subdomainRepo.update(subdomainId, { resendDomainId: domainId });
  }

  /**
   * Step: configures a single DNS record via GoDaddy.
   *
   * @param record - The DNS record to configure.
   */
  @DBOS.step()
  static async configureDnsRecord(record: DnsRecord): Promise<void> {
    const goDaddyDnsService = container.resolve<GoDaddyDnsService>('GoDaddyDnsService');
    await goDaddyDnsService.configureDnsRecord(record);
  }

  /**
   * Step: triggers DNS verification in Resend.
   *
   * @param domainId - The Resend domain ID.
   */
  @DBOS.step()
  static async triggerVerification(domainId: string): Promise<void> {
    const resendDomainService = container.resolve<ResendDomainService>('ResendDomainService');
    await resendDomainService.triggerVerification(domainId);
  }

  /**
   * Step: polls Resend for domain status and persists it. Returns true
   * when a terminal status is reached.
   *
   * @param subdomainId - The subdomain row id.
   * @param domainId - The Resend domain ID.
   * @returns True if the domain has reached a terminal status.
   */
  @DBOS.step()
  static async checkVerificationStatus(subdomainId: number, domainId: string): Promise<boolean> {
    const resendDomainService = container.resolve<ResendDomainService>('ResendDomainService');
    const subdomainRepo = container.resolve<SubdomainRepository>('SubdomainRepository');
    const status = await resendDomainService.checkVerification(domainId);
    await subdomainRepo.update(subdomainId, { status: status as SubdomainStatus });
    return TERMINAL_STATUSES.has(status);
  }

  /**
   * Step: persists the domain status on the subdomain row.
   *
   * @param subdomainId - The subdomain row id.
   * @param status - The domain status to persist.
   */
  @DBOS.step()
  static async updateStatus(subdomainId: number, status: SubdomainStatus): Promise<void> {
    const subdomainRepo = container.resolve<SubdomainRepository>('SubdomainRepository');
    await subdomainRepo.update(subdomainId, { status });
  }
}
