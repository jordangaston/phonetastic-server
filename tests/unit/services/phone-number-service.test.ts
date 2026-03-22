import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PhoneNumberService } from '../../../src/services/phone-number-service.js';

describe('PhoneNumberService', () => {
  let phoneNumberRepo: any;
  let livekitService: any;
  let service: PhoneNumberService;

  beforeEach(() => {
    phoneNumberRepo = { create: vi.fn() };
    livekitService = { purchasePhoneNumber: vi.fn(), createSipDispatchRule: vi.fn() };
    service = new PhoneNumberService(phoneNumberRepo, livekitService);
  });

  describe('purchase', () => {
    it('purchases a number from LiveKit and persists it', async () => {
      livekitService.purchasePhoneNumber.mockResolvedValue('+15551234567');
      livekitService.createSipDispatchRule.mockResolvedValue(undefined);
      phoneNumberRepo.create.mockResolvedValue({ id: 1, phoneNumberE164: '+15551234567', isVerified: true });

      const result = await service.purchase();

      expect(livekitService.purchasePhoneNumber).toHaveBeenCalledWith(undefined);
      expect(livekitService.createSipDispatchRule).toHaveBeenCalledWith('+15551234567');
      expect(phoneNumberRepo.create).toHaveBeenCalledWith({ phoneNumberE164: '+15551234567', isVerified: true });
      expect(result.phoneNumberE164).toBe('+15551234567');
    });

    it('passes area code to LiveKit', async () => {
      livekitService.purchasePhoneNumber.mockResolvedValue('+14155551234');
      livekitService.createSipDispatchRule.mockResolvedValue(undefined);
      phoneNumberRepo.create.mockResolvedValue({ id: 2, phoneNumberE164: '+14155551234', isVerified: true });

      await service.purchase('415');

      expect(livekitService.purchasePhoneNumber).toHaveBeenCalledWith('415');
    });
  });
});
