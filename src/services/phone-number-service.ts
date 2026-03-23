import { injectable, inject } from 'tsyringe';
import { PhoneNumberRepository } from '../repositories/phone-number-repository.js';
import { CallSettingsRepository } from '../repositories/call-settings-repository.js';
import type { LiveKitService } from './livekit-service.js';

/**
 * Orchestrates phone number operations.
 */
@injectable()
export class PhoneNumberService {
  constructor(
    @inject('PhoneNumberRepository') private phoneNumberRepo: PhoneNumberRepository,
    @inject('CallSettingsRepository') private callSettingsRepo: CallSettingsRepository,
    @inject('LiveKitService') private livekitService: LiveKitService,
  ) {}

  /**
   * Purchases a LiveKit phone number, creates a SIP dispatch rule, and persists both.
   *
   * @precondition The user must have call settings.
   * @precondition The LiveKitService must be configured with valid credentials (production only).
   * @postcondition A verified phone number record exists in the database.
   * @postcondition The number is assigned to a SIP dispatch rule cached on call settings.
   * @param userId - The authenticated user's id.
   * @param areaCode - Optional preferred area code (ignored in development mode).
   * @returns The created or existing phone number row.
   */
  async purchase(userId: number, areaCode?: string) {
    const DEV_PHONE_NUMBER = '+15005550100';

    if (process.env.NODE_ENV === 'development') {
      const existing = await this.phoneNumberRepo.findByE164(DEV_PHONE_NUMBER);
      if (existing) return existing;
      return this.phoneNumberRepo.create({ phoneNumberE164: DEV_PHONE_NUMBER, isVerified: true });
    }

    const settings = await this.callSettingsRepo.findByUserId(userId);
    if (!settings) throw new Error('Call settings not found for user');

    const e164 = await this.livekitService.purchasePhoneNumber(areaCode);
    const row = await this.phoneNumberRepo.create({ phoneNumberE164: e164, isVerified: true });

    const ruleId = settings.sipDispatchRuleId
      ?? await this.livekitService.createSipDispatchRule(e164);
    if (!settings.sipDispatchRuleId) {
      await this.callSettingsRepo.update(settings.id, { sipDispatchRuleId: ruleId });
    }

    return row;
  }
}
