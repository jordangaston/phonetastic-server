import { injectable, inject } from 'tsyringe';
import type { OtpProvider } from './otp-provider.js';
import { BadRequestError } from '../lib/errors.js';

/**
 * Handles OTP delivery and verification via an OtpProvider.
 */
@injectable()
export class OtpService {
  constructor(
    @inject('OtpProvider') private otpProvider: OtpProvider,
  ) { }

  /**
   * Initiates OTP delivery to the given phone number.
   *
   * @precondition phoneNumber must be a valid E.164-formatted string.
   * @postcondition An OTP has been sent to the phone number via the configured provider.
   * @param phoneNumber - The recipient phone number in E.164 format.
   * @returns A status object indicating the verification was initiated.
   */
  async generateAndSend(phoneNumber: string): Promise<{ status: string }> {
    await this.otpProvider.send(phoneNumber);
    return { status: 'pending' };
  }

  /**
   * Verifies a user-submitted OTP code for the given phone number.
   *
   * @precondition phoneNumber must be the same E.164 number used when sending.
   * @postcondition Returns verified: true if the code is approved.
   * @param phoneNumber - The phone number in E.164 format.
   * @param code - The OTP code submitted by the user.
   * @returns The verified status and phone number.
   * @throws {BadRequestError} If the code is invalid or expired.
   */
  async verify(phoneNumber: string, code: string): Promise<{ verified: boolean; phoneNumberE164: string }> {
    const approved = await this.otpProvider.check(phoneNumber, code);
    if (!approved) throw new BadRequestError('Invalid or expired OTP');
    return { verified: true, phoneNumberE164: phoneNumber };
  }
}
