import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmailAddressService } from '../../../src/services/email-address-service.js';
import { BadRequestError, ConflictError } from '../../../src/lib/errors.js';

describe('EmailAddressService', () => {
  let emailAddressRepo: any;
  let userRepo: any;
  let companyRepo: any;
  let service: EmailAddressService;

  beforeEach(() => {
    emailAddressRepo = {
      create: vi.fn(),
      findByAddress: vi.fn(),
      findAllByCompanyId: vi.fn(),
    };
    userRepo = { findById: vi.fn() };
    companyRepo = { findById: vi.fn() };
    service = new EmailAddressService(emailAddressRepo, userRepo, companyRepo);
  });

  describe('createEmailAddress', () => {
    it('throws when user has no company', async () => {
      userRepo.findById.mockResolvedValue({ id: 1, companyId: null });
      await expect(service.createEmailAddress(1)).rejects.toThrow(BadRequestError);
    });

    it('throws when company already has an email address', async () => {
      userRepo.findById.mockResolvedValue({ id: 1, companyId: 5 });
      emailAddressRepo.findAllByCompanyId.mockResolvedValue([{ id: 1 }]);
      await expect(service.createEmailAddress(1)).rejects.toThrow(ConflictError);
    });

    it('generates slug from company name and creates address', async () => {
      userRepo.findById.mockResolvedValue({ id: 1, companyId: 5 });
      emailAddressRepo.findAllByCompanyId.mockResolvedValue([]);
      companyRepo.findById.mockResolvedValue({ id: 5, name: 'Acme Auto' });
      emailAddressRepo.findByAddress.mockResolvedValue(null);
      emailAddressRepo.create.mockResolvedValue({ id: 1, address: 'acme-auto@mail.phonetastic.ai' });

      const result = await service.createEmailAddress(1);

      expect(emailAddressRepo.create).toHaveBeenCalledWith({
        companyId: 5,
        address: 'acme-auto@mail.phonetastic.ai',
      });
      expect(result.address).toBe('acme-auto@mail.phonetastic.ai');
    });

    it('appends suffix when slug already taken', async () => {
      userRepo.findById.mockResolvedValue({ id: 1, companyId: 5 });
      emailAddressRepo.findAllByCompanyId.mockResolvedValue([]);
      companyRepo.findById.mockResolvedValue({ id: 5, name: 'Acme' });
      emailAddressRepo.findByAddress
        .mockResolvedValueOnce({ id: 1 })
        .mockResolvedValueOnce(null);
      emailAddressRepo.create.mockResolvedValue({ id: 2, address: 'acme-2@mail.phonetastic.ai' });

      await service.createEmailAddress(1);

      expect(emailAddressRepo.create).toHaveBeenCalledWith({
        companyId: 5,
        address: 'acme-2@mail.phonetastic.ai',
      });
    });
  });

  describe('listEmailAddresses', () => {
    it('throws when user has no company', async () => {
      userRepo.findById.mockResolvedValue({ id: 1, companyId: null });
      await expect(service.listEmailAddresses(1)).rejects.toThrow(BadRequestError);
    });

    it('returns addresses for the company', async () => {
      userRepo.findById.mockResolvedValue({ id: 1, companyId: 5 });
      emailAddressRepo.findAllByCompanyId.mockResolvedValue([{ id: 1, address: 'acme@mail.phonetastic.ai' }]);

      const result = await service.listEmailAddresses(1);

      expect(result).toHaveLength(1);
    });
  });
});
