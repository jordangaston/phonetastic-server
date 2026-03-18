import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompanyService } from '../../../src/services/company-service.js';
import type { CompanyData } from '../../../src/workflows/company-onboarding/parsers/parser-utils.js';

const makeCompanyData = (overrides: Partial<CompanyData> = {}): CompanyData => ({
  name: 'Acme Corp',
  email: 'info@acme.com',
  address: null,
  operationHours: [],
  phoneNumbers: [],
  ...overrides,
});

describe('CompanyService', () => {
  let db: any;
  let companyRepo: any;
  let addressRepo: any;
  let operationHourRepo: any;
  let phoneNumberRepo: any;
  let userRepo: any;
  let service: CompanyService;

  beforeEach(() => {
    db = { transaction: vi.fn().mockImplementation(async (cb: any) => cb({})) };
    companyRepo = { create: vi.fn().mockResolvedValue({ id: 42, name: 'Acme Corp', website: 'https://acme.com', businessType: null }) };
    addressRepo = { createMany: vi.fn().mockResolvedValue([]) };
    operationHourRepo = { createMany: vi.fn().mockResolvedValue([]) };
    phoneNumberRepo = { createMany: vi.fn().mockResolvedValue([]) };
    userRepo = { update: vi.fn().mockResolvedValue({ id: 1, companyId: 42 }) };
    service = new CompanyService(db, companyRepo, addressRepo, operationHourRepo, phoneNumberRepo, userRepo);
  });

  describe('create', () => {
    it('creates the company with parsed data and links the user', async () => {
      const company = await service.create(makeCompanyData(), null, 'https://acme.com', 1);

      expect(companyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Acme Corp', website: 'https://acme.com' }),
        expect.any(Object),
      );
      expect(userRepo.update).toHaveBeenCalledWith(1, { companyId: 42 }, expect.any(Object));
      expect(company).toMatchObject({ id: 42, name: 'Acme Corp' });
    });

    it('passes businessType to companyRepo when provided', async () => {
      await service.create(makeCompanyData(), 'Restaurant', 'https://acme.com', 1);

      expect(companyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ businessType: 'Restaurant' }),
        expect.any(Object),
      );
    });

    it('falls back to hostname when companyData is null', async () => {
      await service.create(null, null, 'https://acme.com', 1);

      expect(companyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'acme.com' }),
        expect.any(Object),
      );
    });

    it('inserts address when present', async () => {
      const data = makeCompanyData({
        address: { streetAddress: '123 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US', label: 'main' },
      });

      await service.create(data, null, 'https://acme.com', 1);

      expect(addressRepo.createMany).toHaveBeenCalledWith(
        [expect.objectContaining({ companyId: 42, streetAddress: '123 Main St' })],
        expect.any(Object),
      );
    });

    it('skips address insert when absent', async () => {
      await service.create(makeCompanyData({ address: null }), 'https://acme.com', 1);

      expect(addressRepo.createMany).not.toHaveBeenCalled();
    });

    it('inserts operation hours when present', async () => {
      const data = makeCompanyData({
        operationHours: [{ dayOfWeek: 1, openTime: '09:00', closeTime: '17:00' }],
      });

      await service.create(data, null, 'https://acme.com', 1);

      expect(operationHourRepo.createMany).toHaveBeenCalledWith(
        [expect.objectContaining({ companyId: 42, dayOfWeek: 1 })],
        expect.any(Object),
      );
    });

    it('skips operation hours insert when empty', async () => {
      await service.create(makeCompanyData({ operationHours: [] }), 'https://acme.com', 1);

      expect(operationHourRepo.createMany).not.toHaveBeenCalled();
    });

    it('inserts phone numbers when present', async () => {
      const data = makeCompanyData({
        phoneNumbers: [{ phoneNumberE164: '+15121234567', label: 'main' }],
      });

      await service.create(data, null, 'https://acme.com', 1);

      expect(phoneNumberRepo.createMany).toHaveBeenCalledWith(
        [expect.objectContaining({ companyId: 42, phoneNumberE164: '+15121234567', label: 'main' })],
        expect.any(Object),
      );
    });

    it('skips phone numbers insert when empty', async () => {
      await service.create(makeCompanyData({ phoneNumbers: [] }), 'https://acme.com', 1);

      expect(phoneNumberRepo.createMany).not.toHaveBeenCalled();
    });

    it('uses the provided tx without starting a new transaction', async () => {
      const tx = {} as any;
      await service.create(makeCompanyData(), null, 'https://acme.com', 1, tx);

      expect(db.transaction).not.toHaveBeenCalled();
      expect(companyRepo.create).toHaveBeenCalledWith(expect.any(Object), tx);
    });
  });
});
