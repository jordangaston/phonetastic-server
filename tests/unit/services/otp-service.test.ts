import { describe, it, expect, beforeEach } from 'vitest';
import { OtpService } from '../../../src/services/otp-service.js';
import { StubOtpProvider } from '../../../src/services/otp-provider.js';
import { BadRequestError } from '../../../src/lib/errors.js';

describe('OtpService', () => {
  let provider: StubOtpProvider;
  let service: OtpService;

  beforeEach(() => {
    provider = new StubOtpProvider();
    service = new OtpService(provider);
  });

  describe('generateAndSend', () => {
    it('delegates to the OTP provider and returns pending status', async () => {
      const result = await service.generateAndSend('+15551234567');

      expect(provider.sent).toContain('+15551234567');
      expect(result).toEqual({ status: 'pending' });
    });
  });

  describe('verify', () => {
    it('throws BadRequestError when the code is not approved', async () => {
      await expect(service.verify('+15551234567', '000000')).rejects.toThrow(BadRequestError);
    });

    it('returns verified result for an approved code', async () => {
      provider.approvedCodes.set('+15551234567', '123456');

      const result = await service.verify('+15551234567', '123456');

      expect(result).toEqual({ verified: true, phoneNumberE164: '+15551234567' });
    });
  });
});
