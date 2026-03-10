import { injectable, inject } from 'tsyringe';
import { UserRepository } from '../repositories/user-repository.js';
import { PhoneNumberRepository } from '../repositories/phone-number-repository.js';
import { BotRepository } from '../repositories/bot-repository.js';
import { BotSettingsRepository } from '../repositories/bot-settings-repository.js';
import { CallSettingsRepository } from '../repositories/call-settings-repository.js';
import { VoiceRepository } from '../repositories/voice-repository.js';
import type { Database } from '../db/index.js';
import { AuthService } from './auth-service.js';
import { OtpService } from './otp-service.js';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../lib/errors.js';

/**
 * Orchestrates user creation, sign-in, and profile updates.
 */
@injectable()
export class UserService {
  constructor(
    @inject('Database') private db: Database,
    @inject('UserRepository') private userRepo: UserRepository,
    @inject('PhoneNumberRepository') private phoneNumberRepo: PhoneNumberRepository,
    @inject('BotRepository') private botRepo: BotRepository,
    @inject('BotSettingsRepository') private botSettingsRepo: BotSettingsRepository,
    @inject('CallSettingsRepository') private callSettingsRepo: CallSettingsRepository,
    @inject('VoiceRepository') private voiceRepo: VoiceRepository,
    @inject('AuthService') private authService: AuthService,
    @inject('OtpService') private otpService: OtpService,
  ) {}

  /**
   * Creates a new user with associated phone number, bot, bot settings, and call settings.
   *
   * @precondition The phone number must not already be registered to another user.
   * @postcondition A user and all dependent records exist atomically. Auth tokens are generated.
   * @param input - User creation parameters.
   * @param input.firstName - The user's first name.
   * @param input.lastName - The user's last name.
   * @param input.phoneNumber - The user's phone number in E.164 format.
   * @param input.expand - Optional relations to include in the response.
   * @returns The created user, auth tokens, and optionally expanded relations.
   * @throws {BadRequestError} If the phone number is already in use.
   */
  async createUser(input: {
    firstName: string;
    lastName?: string;
    phoneNumber: string;
    expand?: string[];
  }) {
    await this.ensurePhoneNumberAvailable(input.phoneNumber);

    const { privateKey, publicKey } = this.authService.generateKeyPair();

    const result = await this.db.transaction(async (tx) => {
      const phoneNumber = await this.phoneNumberRepo.create({
        phoneNumberE164: input.phoneNumber,
        isVerified: true,
      }, tx);

      const user = await this.userRepo.create({
        phoneNumberId: phoneNumber.id,
        firstName: input.firstName,
        lastName: input.lastName,
        jwtPrivateKey: privateKey,
        jwtPublicKey: publicKey,
      }, tx);

      const bot = await this.botRepo.create({ userId: user.id, name: `${input.firstName}'s Bot` }, tx);

      const defaultVoice = await this.voiceRepo.findFirst(tx);
      if (!defaultVoice) throw new NotFoundError('No voices available');

      const botSettingsRow = await this.botSettingsRepo.create({
        botId: bot.id, userId: user.id, voiceId: defaultVoice.id,
      }, tx);

      const callSettingsRow = await this.callSettingsRepo.create({
        forwardedPhoneNumberId: phoneNumber.id,
        companyPhoneNumberId: phoneNumber.id,
        userId: user.id,
      }, tx);

      return { user, bot, botSettingsRow, callSettingsRow };
    });

    const auth = this.authService.generateTokens(result.user.id, result.user.jwtPrivateKey, {
      access: result.user.accessTokenNonce,
      refresh: result.user.refreshTokenNonce,
    });

    return this.buildResponse(result.user, auth, result.bot, result.botSettingsRow, result.callSettingsRow, input.expand);
  }

  /**
   * Signs in an existing user via OTP or refresh token.
   *
   * @precondition auth must contain exactly one of otp or refresh_token.
   * @postcondition New auth tokens are returned for the resolved user.
   * @param input - Sign-in parameters.
   * @param input.auth - Auth credentials: otp or refresh_token.
   * @param input.expand - Optional relations to include in the response.
   * @returns The user, auth tokens, and optionally expanded relations.
   * @throws {BadRequestError} If no auth method is provided.
   * @throws {NotFoundError} If the user cannot be resolved.
   * @throws {UnauthorizedError} If the refresh token is invalid or expired.
   */
  async signIn(input: {
    auth: { otp?: { phone_number: string; code: string }; refresh_token?: string };
    expand?: string[];
  }) {
    const user = await this.resolveUser(input.auth);
    const auth = this.authService.generateTokens(user.id, user.jwtPrivateKey, {
      access: user.accessTokenNonce,
      refresh: user.refreshTokenNonce,
    });
    const { bot, botSettings, callSettings } = await this.loadExpands(user.id, input.expand);
    return this.buildResponse(user, auth, bot, botSettings, callSettings, input.expand);
  }

  /**
   * Updates a user's profile fields.
   *
   * @param id - The user id.
   * @param data - Fields to update.
   * @returns The updated user.
   * @throws {NotFoundError} If the user does not exist.
   */
  async updateUser(id: number, data: { firstName?: string; lastName?: string }) {
    const user = await this.userRepo.update(id, data);
    if (!user) throw new NotFoundError('User not found');
    return user;
  }

  private async resolveUser(auth: { otp?: { phone_number: string; code: string }; refresh_token?: string }) {
    if (auth.otp) return this.resolveUserByOtp(auth.otp);
    if (auth.refresh_token) return this.resolveUserByRefreshToken(auth.refresh_token);
    throw new BadRequestError('Auth method required');
  }

  private async resolveUserByOtp(otp: { phone_number: string; code: string }) {
    const { phoneNumberE164 } = await this.otpService.verify(otp.phone_number, otp.code);
    const phoneNumber = await this.phoneNumberRepo.findByE164(phoneNumberE164);
    if (!phoneNumber) throw new NotFoundError('Phone number not found');
    const user = await this.userRepo.findByPhoneNumberId(phoneNumber.id);
    if (!user) throw new NotFoundError('User not found');
    return user;
  }

  private async resolveUserByRefreshToken(token: string) {
    const decoded = this.authService.decodeToken(token);
    if (!decoded?.sub) throw new UnauthorizedError('Invalid token');
    const user = await this.userRepo.findById(Number(decoded.sub));
    if (!user) throw new UnauthorizedError('User not found');
    const payload = this.authService.verifyToken(token, user.jwtPublicKey);
    if (payload.type !== 'refresh') throw new UnauthorizedError('Invalid token type');
    return user;
  }

  private async loadExpands(userId: number, expand?: string[]) {
    const bot = expand?.includes('bot') ? await this.botRepo.findByUserId(userId) : undefined;
    const botSettings = expand?.includes('bot_settings') ? await this.botSettingsRepo.findByUserId(userId) : undefined;
    const callSettings = expand?.includes('call_settings') ? await this.callSettingsRepo.findByUserId(userId) : undefined;
    return { bot, botSettings, callSettings };
  }

  private async ensurePhoneNumberAvailable(number: string): Promise<void> {
    const existing = await this.phoneNumberRepo.findByE164(number);
    if (existing) throw new BadRequestError('Phone number already in use');
  }

  private buildResponse(
    user: any, auth: any, bot: any, botSettings: any, callSettings: any, expand?: string[],
  ) {
    const response: any = {
      user: {
        id: user.id,
        first_name: user.firstName,
        last_name: user.lastName,
        phone_number_id: user.phoneNumberId,
      },
      auth,
    };

    if (expand?.includes('call_settings')) {
      response.user.call_settings = {
        id: callSettings.id,
        forwarded_phone_number_id: callSettings.forwardedPhoneNumberId,
        company_phone_number_id: callSettings.companyPhoneNumberId,
        is_bot_enabled: callSettings.isBotEnabled,
        rings_before_bot_answer: callSettings.ringsBeforeBotAnswer,
        answer_calls_from: callSettings.answerCallsFrom,
      };
    }

    if (expand?.includes('bot')) {
      response.user.bot = { id: bot.id, name: bot.name };
      if (expand?.includes('bot_settings')) {
        response.user.bot.bot_settings = {
          id: botSettings.id,
          bot_id: botSettings.botId,
          call_greeting_message: botSettings.callGreetingMessage,
          call_goodbye_message: botSettings.callGoodbyeMessage,
          voice_id: botSettings.voiceId,
          primary_language: botSettings.primaryLanguage,
        };
      }
    }

    return response;
  }
}
