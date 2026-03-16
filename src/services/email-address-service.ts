import { injectable, inject } from 'tsyringe';
import { EmailAddressRepository } from '../repositories/email-address-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import { CompanyRepository } from '../repositories/company-repository.js';
import { BadRequestError, ConflictError } from '../lib/errors.js';

const EMAIL_DOMAIN = 'mail.phonetastic.ai';

/**
 * Orchestrates email address creation and listing for companies.
 */
@injectable()
export class EmailAddressService {
  constructor(
    @inject('EmailAddressRepository') private emailAddressRepo: EmailAddressRepository,
    @inject('UserRepository') private userRepo: UserRepository,
    @inject('CompanyRepository') private companyRepo: CompanyRepository,
  ) {}

  /**
   * Creates a Phonetastic email address for the authenticated user's company.
   *
   * @precondition The user must belong to a company.
   * @postcondition The company has exactly one email address.
   * @param userId - The authenticated user's id.
   * @returns The created email address row.
   * @throws {BadRequestError} If the user has no company.
   * @throws {ConflictError} If the company already has an email address.
   */
  async createEmailAddress(userId: number) {
    const user = await this.userRepo.findById(userId);
    if (!user?.companyId) throw new BadRequestError('User has no company');

    const existing = await this.emailAddressRepo.findAllByCompanyId(user.companyId);
    if (existing.length > 0) throw new ConflictError('Company already has an email address');

    const company = await this.companyRepo.findById(user.companyId);
    const address = await this.generateUniqueAddress(company?.name ?? 'company');

    return this.emailAddressRepo.create({ companyId: user.companyId, address });
  }

  /**
   * Lists email addresses for the authenticated user's company.
   *
   * @precondition The user must belong to a company.
   * @param userId - The authenticated user's id.
   * @returns An array of email address rows.
   * @throws {BadRequestError} If the user has no company.
   */
  async listEmailAddresses(userId: number) {
    const user = await this.userRepo.findById(userId);
    if (!user?.companyId) throw new BadRequestError('User has no company');
    return this.emailAddressRepo.findAllByCompanyId(user.companyId);
  }

  /**
   * Generates a unique email address slug from a company name.
   *
   * @param companyName - The company name to slugify.
   * @returns A unique email address string.
   */
  private async generateUniqueAddress(companyName: string): Promise<string> {
    const slug = this.slugify(companyName);
    const candidate = `${slug}@${EMAIL_DOMAIN}`;

    const existing = await this.emailAddressRepo.findByAddress(candidate);
    if (!existing) return candidate;

    let suffix = 2;
    while (true) {
      const suffixed = `${slug}-${suffix}@${EMAIL_DOMAIN}`;
      const found = await this.emailAddressRepo.findByAddress(suffixed);
      if (!found) return suffixed;
      suffix++;
    }
  }

  /**
   * Converts a company name to a URL-safe slug.
   *
   * @param name - The company name.
   * @returns A lowercase, hyphenated slug.
   */
  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
