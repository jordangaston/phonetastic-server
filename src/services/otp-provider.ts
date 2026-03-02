/**
 * Abstraction over an OTP delivery and verification provider.
 * Implementations may use Twilio Verify or a stub for testing.
 */
export interface OtpProvider {
  /**
   * Initiates OTP delivery to the given phone number.
   *
   * @param phoneNumber - E.164-formatted phone number.
   */
  send(phoneNumber: string): Promise<void>;

  /**
   * Checks whether the submitted code is valid for the given phone number.
   *
   * @param phoneNumber - E.164-formatted phone number.
   * @param code - The OTP code submitted by the user.
   * @returns true if the code is approved, false otherwise.
   */
  check(phoneNumber: string, code: string): Promise<boolean>;
}

/**
 * Stub OTP provider that records sends and approves codes from a preset map.
 * Used during development and testing.
 */
export class StubOtpProvider implements OtpProvider {
  public readonly sent: string[] = [];
  public approvedCodes: Map<string, string> = new Map();

  async send(phoneNumber: string): Promise<void> {
    this.sent.push(phoneNumber);
  }

  async check(phoneNumber: string, code: string): Promise<boolean> {
    return this.approvedCodes.get(phoneNumber) === code;
  }
}

/**
 * Structural type for the Twilio Verify verifications resource.
 */
export interface TwilioVerificationsClient {
  create(opts: { to: string; channel: string }): Promise<unknown>;
}

/**
 * Structural type for the Twilio Verify verificationChecks resource.
 */
export interface TwilioVerificationChecksClient {
  create(opts: { to: string; code: string }): Promise<{ status: string }>;
}

/**
 * Structural type for a Twilio Verify service resource.
 */
export interface TwilioVerifyServiceClient {
  verifications: TwilioVerificationsClient;
  verificationChecks: TwilioVerificationChecksClient;
}

/**
 * Twilio Verify-backed OTP provider for production use.
 *
 * @precondition Valid Twilio credentials and a Verify Service SID.
 * @postcondition OTP delivery and verification are delegated to Twilio Verify.
 */
export class TwilioVerifyOtpProvider implements OtpProvider {
  private readonly service: TwilioVerifyServiceClient;

  /**
   * @param service - The Twilio Verify service resource (client.verify.v2.services(sid)).
   */
  constructor(service: TwilioVerifyServiceClient) {
    this.service = service;
  }

  /** {@inheritDoc OtpProvider.send} */
  async send(phoneNumber: string): Promise<void> {
    await this.service.verifications.create({ to: phoneNumber, channel: 'sms' });
  }

  /** {@inheritDoc OtpProvider.check} */
  async check(phoneNumber: string, code: string): Promise<boolean> {
    const result = await this.service.verificationChecks.create({ to: phoneNumber, code });
    return result.status === 'approved';
  }
}
