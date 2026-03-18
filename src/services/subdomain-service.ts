import { injectable, inject } from 'tsyringe';
import { SubdomainRepository } from '../repositories/subdomain-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import { BadRequestError } from '../lib/errors.js';
import type { DBOSClientFactory } from './dbos-client-factory.js';

const ADJECTIVES = ['bright', 'calm', 'swift', 'bold', 'keen', 'warm', 'fresh', 'cool', 'soft', 'true'];
const NOUNS = ['fox', 'owl', 'elk', 'bee', 'ant', 'jay', 'yak', 'ram', 'emu', 'koi'];
const MAX_RETRIES = 5;

/**
 * Orchestrates subdomain creation and listing for the authenticated user's company.
 */
@injectable()
export class SubdomainService {
  constructor(
    @inject('SubdomainRepository') private subdomainRepo: SubdomainRepository,
    @inject('UserRepository') private userRepo: UserRepository,
    @inject('DBOSClientFactory') private dbosClientFactory: DBOSClientFactory,
  ) {}

  /**
   * Creates a unique subdomain for the user's company and enqueues the SetupSubdomain workflow.
   *
   * @precondition The user must belong to a company.
   * @postcondition A subdomain row exists and the SetupSubdomain workflow is enqueued.
   * @param userId - The authenticated user's id.
   * @returns The created subdomain row.
   * @throws {BadRequestError} If the user has no company.
   */
  async createSubdomain(userId: number) {
    const companyId = await this.requireCompanyId(userId);
    const subdomain = await this.generateUniqueSubdomain();
    const row = await this.subdomainRepo.create({ companyId, subdomain });

    const client = await this.dbosClientFactory.getInstance();
    await client.enqueue(
      { workflowClassName: 'SetupSubdomain', workflowName: 'run', queueName: 'setup-subdomain' },
      row.id,
    );

    return row;
  }

  /**
   * Returns all subdomains for the user's company.
   *
   * @precondition The user must belong to a company.
   * @param userId - The authenticated user's id.
   * @returns An array of subdomain rows.
   * @throws {BadRequestError} If the user has no company.
   */
  async listSubdomains(userId: number) {
    const companyId = await this.requireCompanyId(userId);
    return this.subdomainRepo.findAllByCompanyId(companyId);
  }

  /**
   * Generates a unique adjective-noun-number subdomain with retry.
   *
   * @returns A unique subdomain string.
   * @throws {Error} If uniqueness cannot be achieved after MAX_RETRIES.
   */
  private async generateUniqueSubdomain(): Promise<string> {
    for (let i = 0; i < MAX_RETRIES; i++) {
      const candidate = this.generateSubdomain();
      const existing = await this.subdomainRepo.findBySubdomain(candidate);
      if (!existing) return candidate;
    }
    throw new Error('Failed to generate unique subdomain');
  }

  /**
   * Generates a random adjective-noun-number subdomain.
   *
   * @returns A subdomain string like "bright-fox-42".
   */
  private generateSubdomain(): string {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const num = Math.floor(Math.random() * 100);
    return `${adj}-${noun}-${num}`;
  }

  /**
   * Resolves the company id for a user, throwing if not found.
   *
   * @param userId - The user id.
   * @returns The company id.
   * @throws {BadRequestError} If the user has no company.
   */
  private async requireCompanyId(userId: number): Promise<number> {
    const user = await this.userRepo.findById(userId);
    if (!user?.companyId) throw new BadRequestError('User has no company');
    return user.companyId;
  }
}
