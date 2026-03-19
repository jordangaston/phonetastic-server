import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubdomainService } from '../../../src/services/subdomain-service.js';
import { BadRequestError } from '../../../src/lib/errors.js';

describe('SubdomainService', () => {
  let subdomainRepo: any;
  let userRepo: any;
  let dbosClientFactory: any;
  let service: SubdomainService;

  beforeEach(() => {
    subdomainRepo = {
      create: vi.fn(),
      findBySubdomain: vi.fn(),
      findAllByCompanyId: vi.fn(),
    };
    userRepo = { findById: vi.fn() };
    dbosClientFactory = {
      getInstance: vi.fn().mockResolvedValue({ enqueue: vi.fn() }),
    };
    service = new SubdomainService(subdomainRepo, userRepo, dbosClientFactory);
  });

  describe('createSubdomain', () => {
    it('throws when user has no company', async () => {
      userRepo.findById.mockResolvedValue({ id: 1, companyId: null });
      await expect(service.createSubdomain(1)).rejects.toThrow(BadRequestError);
    });

    it('creates subdomain with adjective-noun-number pattern', async () => {
      userRepo.findById.mockResolvedValue({ id: 1, companyId: 5 });
      subdomainRepo.findBySubdomain.mockResolvedValue(null);
      subdomainRepo.create.mockResolvedValue({ id: 1, subdomain: 'bright-fox-42', companyId: 5 });

      const result = await service.createSubdomain(1);

      expect(result.companyId).toBe(5);
      expect(subdomainRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: 5, subdomain: expect.stringMatching(/^\w+-\w+-\d+$/) }),
      );
    });

    it('retries on subdomain collision', async () => {
      userRepo.findById.mockResolvedValue({ id: 1, companyId: 5 });
      subdomainRepo.findBySubdomain
        .mockResolvedValueOnce({ id: 99 })
        .mockResolvedValueOnce(null);
      subdomainRepo.create.mockResolvedValue({ id: 1, subdomain: 'calm-owl-7', companyId: 5 });

      await service.createSubdomain(1);

      expect(subdomainRepo.findBySubdomain).toHaveBeenCalledTimes(2);
    });

    it('enqueues SetupSubdomain workflow', async () => {
      userRepo.findById.mockResolvedValue({ id: 1, companyId: 5 });
      subdomainRepo.findBySubdomain.mockResolvedValue(null);
      subdomainRepo.create.mockResolvedValue({ id: 10, subdomain: 'keen-bee-3', companyId: 5 });
      const mockEnqueue = vi.fn();
      dbosClientFactory.getInstance.mockResolvedValue({ enqueue: mockEnqueue });

      await service.createSubdomain(1);

      expect(mockEnqueue).toHaveBeenCalledWith(
        { workflowClassName: 'SetupSubdomain', workflowName: 'run', queueName: 'setup-subdomain' },
        10,
      );
    });
  });

  describe('listSubdomains', () => {
    it('throws when user has no company', async () => {
      userRepo.findById.mockResolvedValue({ id: 1, companyId: null });
      await expect(service.listSubdomains(1)).rejects.toThrow(BadRequestError);
    });

    it('returns subdomains for the company', async () => {
      userRepo.findById.mockResolvedValue({ id: 1, companyId: 5 });
      subdomainRepo.findAllByCompanyId.mockResolvedValue([{ id: 1, subdomain: 'a-b-1' }]);

      const result = await service.listSubdomains(1);

      expect(result).toHaveLength(1);
      expect(subdomainRepo.findAllByCompanyId).toHaveBeenCalledWith(5, undefined);
    });

    it('passes pagination options through', async () => {
      userRepo.findById.mockResolvedValue({ id: 1, companyId: 5 });
      subdomainRepo.findAllByCompanyId.mockResolvedValue([]);

      await service.listSubdomains(1, { pageToken: 10, limit: 5 });

      expect(subdomainRepo.findAllByCompanyId).toHaveBeenCalledWith(5, { pageToken: 10, limit: 5 });
    });
  });
});
