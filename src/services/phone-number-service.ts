import { injectable, inject } from 'tsyringe';
import { PhoneNumberRepository } from '../repositories/phone-number-repository.js';
import type { LiveKitService } from './livekit-service.js';

/**
 * Orchestrates phone number operations.
 */
@injectable()
export class PhoneNumberService {
  constructor(
    @inject('PhoneNumberRepository') private phoneNumberRepo: PhoneNumberRepository,
    @inject('LiveKitService') private livekitService: LiveKitService,
  ) {}

  /**
   * Purchases a LiveKit phone number and persists it.
   *
   * In development mode (`NODE_ENV=development`), returns a preconfigured test
   * phone number (`+15005550100`) instead of calling LiveKit, avoiding the need
   * for real Twilio/LiveKit credentials. The test number is created once and
   * reused on subsequent calls (idempotent).
   *
   * @precondition The LiveKitService must be configured with valid credentials (production only).
   * @postcondition A verified phone number record exists in the database.
   * @param areaCode - Optional preferred area code (ignored in development mode).
   * @returns The created or existing phone number row.
   */
  async purchase(areaCode?: string) {
    const DEV_PHONE_NUMBER = '+15005550100';

    if (process.env.NODE_ENV === 'development') {
      const existing = await this.phoneNumberRepo.findByE164(DEV_PHONE_NUMBER);
      if (existing) return existing;
      return this.phoneNumberRepo.create({ phoneNumberE164: DEV_PHONE_NUMBER, isVerified: true });
    }

    const e164 = await this.livekitService.purchasePhoneNumber(areaCode);
    return this.phoneNumberRepo.create({ phoneNumberE164: e164, isVerified: true });
  }
}
