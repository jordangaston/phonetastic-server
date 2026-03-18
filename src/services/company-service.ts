import { injectable, inject } from 'tsyringe';
import type { Database, Transaction } from '../db/index.js';
import type { CompanyRepository } from '../repositories/company-repository.js';
import type { AddressRepository } from '../repositories/address-repository.js';
import type { OperationHourRepository } from '../repositories/operation-hour-repository.js';
import type { PhoneNumberRepository } from '../repositories/phone-number-repository.js';
import type { UserRepository } from '../repositories/user-repository.js';
import type { CompanyData } from '../workflows/company-onboarding/parsers/parser-utils.js';
import { companies } from '../db/schema/companies.js';

export type Company = typeof companies.$inferSelect;

/**
 * Service for creating a company and all associated records in a single transaction.
 */
@injectable()
export class CompanyService {
  constructor(
    @inject('Database') private db: Database,
    @inject('CompanyRepository') private companyRepo: CompanyRepository,
    @inject('AddressRepository') private addressRepo: AddressRepository,
    @inject('OperationHourRepository') private operationHourRepo: OperationHourRepository,
    @inject('PhoneNumberRepository') private phoneNumberRepo: PhoneNumberRepository,
    @inject('UserRepository') private userRepo: UserRepository,
  ) {}

  /**
   * Creates a company with all associated records and links it to the user.
   *
   * @precondition The user identified by `userId` must exist.
   * @postcondition Company, addresses, operation hours, and phone numbers are persisted atomically.
   *   The user's `companyId` is set to the new company's id.
   * @param companyData - Parsed company data. May be null if extraction yielded no results.
   * @param businessType - Classified schema.org LocalBusiness type, or null.
   * @param siteUrl - The company's website URL; used as the company name fallback.
   * @param userId - The id of the user initiating onboarding.
   * @returns The created company row.
   * @boundary If `companyData` is null, only a minimal company record (name from hostname, website) is created.
   */
  async create(companyData: CompanyData | null, businessType: string | null, siteUrl: string, userId: number, tx?: Transaction): Promise<Company> {
    const run = async (tx: Transaction) => {
      const company = await this.companyRepo.create({
        name: companyData?.name ?? new URL(siteUrl).hostname,
        businessType: businessType ?? undefined,
        website: siteUrl,
      }, tx);

      if (companyData?.address) {
        await this.addressRepo.createMany([{ companyId: company.id, ...companyData.address }], tx);
      }

      if (companyData?.operationHours.length) {
        await this.operationHourRepo.createMany(
          companyData.operationHours.map(h => ({ companyId: company.id, ...h })),
          tx,
        );
      }

      if (companyData?.phoneNumbers.length) {
        await this.phoneNumberRepo.createMany(
          companyData.phoneNumbers.map(p => ({ companyId: company.id, phoneNumberE164: p.phoneNumberE164, label: p.label })),
          tx,
        );
      }

      await this.userRepo.update(userId, { companyId: company.id }, tx);
      return company;
    };
    return tx ? run(tx) : this.db.transaction(run);
  }
}
