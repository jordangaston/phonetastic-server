import { DBOS, WorkflowQueue } from '@dbos-inc/dbos-sdk';
import { container } from 'tsyringe';
import type { SubdomainRepository } from '../repositories/subdomain-repository.js';
import type { ResendDomainService, DnsRecord } from '../services/resend-domain-service.js';
import type { GoDaddyDnsService } from '../services/godaddy-dns-service.js';

export const setupSubdomainQueue = new WorkflowQueue('setup-subdomain');

const MAX_POLL_ATTEMPTS = 10;

/**
 * DBOS workflow that sets up a subdomain: creates a Resend domain,
 * configures DNS via GoDaddy, and polls for verification.
 */
export class SetupSubdomain {
  /**
   * Orchestrates subdomain setup: create domain, store ID, configure DNS,
   * trigger and poll verification, mark verified.
   *
   * @precondition A subdomain row must exist in the database.
   * @postcondition The subdomain is verified and ready for email routing.
   * @param subdomainId - The subdomain row id.
   */
  @DBOS.workflow()
  static async run(subdomainId: number): Promise<void> {
    const { id: domainId, records } = await SetupSubdomain.createResendDomain(subdomainId);
    await SetupSubdomain.storeResendDomainId(subdomainId, domainId);
    await SetupSubdomain.configureDns(records);
    await SetupSubdomain.triggerVerification(domainId);
    await SetupSubdomain.pollVerification(domainId);
    await SetupSubdomain.markVerified(subdomainId);
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
   * Step: configures DNS records via GoDaddy.
   *
   * @param records - The DNS records to configure.
   */
  @DBOS.step()
  static async configureDns(records: DnsRecord[]): Promise<void> {
    const goDaddyDnsService = container.resolve<GoDaddyDnsService>('GoDaddyDnsService');
    await goDaddyDnsService.configureDns(records);
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
   * Step: polls Resend for domain verification with bounded retries.
   *
   * @param domainId - The Resend domain ID.
   * @throws {Error} If verification does not succeed after MAX_POLL_ATTEMPTS.
   */
  @DBOS.step({ retriesAllowed: true, maxAttempts: MAX_POLL_ATTEMPTS, intervalSeconds: 10, backoffRate: 2 })
  static async pollVerification(domainId: string): Promise<void> {
    const resendDomainService = container.resolve<ResendDomainService>('ResendDomainService');
    const verified = await resendDomainService.checkVerification(domainId);
    if (!verified) throw new Error('Domain not yet verified');
  }

  /**
   * Step: marks the subdomain as verified in the database.
   *
   * @param subdomainId - The subdomain row id.
   */
  @DBOS.step()
  static async markVerified(subdomainId: number): Promise<void> {
    const subdomainRepo = container.resolve<SubdomainRepository>('SubdomainRepository');
    await subdomainRepo.update(subdomainId, { verified: true });
  }
}
