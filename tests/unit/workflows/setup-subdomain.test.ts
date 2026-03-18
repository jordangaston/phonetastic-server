import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbos = vi.hoisted(() => ({
  DBOS: {
    step: () => (_t: unknown, _k: string, d: PropertyDescriptor) => d,
    workflow: () => (_t: unknown, _k: string, d: PropertyDescriptor) => d,
  },
  WorkflowQueue: vi.fn(),
}));
vi.mock('@dbos-inc/dbos-sdk', () => mockDbos);

const mockContainer = vi.hoisted(() => ({
  container: { resolve: vi.fn() },
}));
vi.mock('tsyringe', () => mockContainer);

import { SetupSubdomain } from '../../../src/workflows/setup-subdomain.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SetupSubdomain.createResendDomain', () => {
  it('calls resendDomainService.createDomain with subdomain', async () => {
    const subdomainRepo = { findById: vi.fn().mockResolvedValue({ id: 1, subdomain: 'bright-fox-42' }) };
    const resendDomainService = {
      createDomain: vi.fn().mockResolvedValue({ id: 'dom-1', records: [{ type: 'MX', name: 'test', value: 'mx' }] }),
    };
    mockContainer.container.resolve
      .mockReturnValueOnce(subdomainRepo)
      .mockReturnValueOnce(resendDomainService);

    const result = await SetupSubdomain.createResendDomain(1);

    expect(resendDomainService.createDomain).toHaveBeenCalledWith('bright-fox-42');
    expect(result.id).toBe('dom-1');
  });

  it('throws when subdomain not found', async () => {
    const subdomainRepo = { findById: vi.fn().mockResolvedValue(undefined) };
    mockContainer.container.resolve.mockReturnValueOnce(subdomainRepo);

    await expect(SetupSubdomain.createResendDomain(999)).rejects.toThrow('Subdomain 999 not found');
  });
});

describe('SetupSubdomain.storeResendDomainId', () => {
  it('updates subdomain with domain id', async () => {
    const subdomainRepo = { update: vi.fn() };
    mockContainer.container.resolve.mockReturnValueOnce(subdomainRepo);

    await SetupSubdomain.storeResendDomainId(1, 'dom-1');

    expect(subdomainRepo.update).toHaveBeenCalledWith(1, { resendDomainId: 'dom-1' });
  });
});

describe('SetupSubdomain.configureDns', () => {
  it('delegates to goDaddyDnsService', async () => {
    const dnsService = { configureDns: vi.fn() };
    mockContainer.container.resolve.mockReturnValueOnce(dnsService);

    const records = [{ type: 'MX', name: 'test', value: 'mx' }];
    await SetupSubdomain.configureDns(records);

    expect(dnsService.configureDns).toHaveBeenCalledWith(records);
  });
});

describe('SetupSubdomain.triggerVerification', () => {
  it('delegates to resendDomainService', async () => {
    const resendDomainService = { triggerVerification: vi.fn() };
    mockContainer.container.resolve.mockReturnValueOnce(resendDomainService);

    await SetupSubdomain.triggerVerification('dom-1');

    expect(resendDomainService.triggerVerification).toHaveBeenCalledWith('dom-1');
  });
});

describe('SetupSubdomain.pollVerification', () => {
  it('resolves when domain is verified', async () => {
    const resendDomainService = { checkVerification: vi.fn().mockResolvedValue(true) };
    mockContainer.container.resolve.mockReturnValueOnce(resendDomainService);

    await expect(SetupSubdomain.pollVerification('dom-1')).resolves.toBeUndefined();
  });

  it('throws when domain is not yet verified', async () => {
    const resendDomainService = { checkVerification: vi.fn().mockResolvedValue(false) };
    mockContainer.container.resolve.mockReturnValueOnce(resendDomainService);

    await expect(SetupSubdomain.pollVerification('dom-1')).rejects.toThrow('Domain not yet verified');
  });
});

describe('SetupSubdomain.markVerified', () => {
  it('sets verified to true', async () => {
    const subdomainRepo = { update: vi.fn() };
    mockContainer.container.resolve.mockReturnValueOnce(subdomainRepo);

    await SetupSubdomain.markVerified(1);

    expect(subdomainRepo.update).toHaveBeenCalledWith(1, { verified: true });
  });
});
