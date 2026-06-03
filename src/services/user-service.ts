import { injectable, inject } from 'tsyringe';
import { UserRepository } from '../repositories/user-repository.js';
import { PhoneNumberRepository } from '../repositories/phone-number-repository.js';
import { BotRepository } from '../repositories/bot-repository.js';
import { VoiceRepository } from '../repositories/voice-repository.js';
import { CompanyRepository } from '../repositories/company-repository.js';
import { CalendarRepository } from '../repositories/calendar-repository.js';
import type { Database } from '../db/index.js';
import { AuthService } from './auth-service.js';
import { OtpService } from './otp-service.js';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../lib/errors.js';
import type { User, Bot, Company, Calendar, PhoneNumber, Faq, Offering, OperationHours } from '../db/models.js';

type CompanyWithRelations = Company & {
  operationHours: OperationHours[];
  faqs: Faq[];
  offerings: Offering[];
};

type Expansions = {
  bot: Bot | undefined;
  botPhoneNumber: PhoneNumber | undefined;
  company: CompanyWithRelations | undefined;
  calendar: Calendar | undefined;
  phoneNumber: PhoneNumber | undefined;
};

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
    @inject('VoiceRepository') private voiceRepo: VoiceRepository,
    @inject('CompanyRepository') private companyRepo: CompanyRepository,
    @inject('CalendarRepository') private calendarRepo: CalendarRepository,
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
      const user = await this.userRepo.create({
        firstName: input.firstName,
        lastName: input.lastName,
        jwtPrivateKey: privateKey,
        jwtPublicKey: publicKey,
        callSettings: {
          isBotEnabled: false,
          ringsBeforeBotAnswer: 3,
          answerCallsFrom: 'everyone',
        },
      }, tx);

      const phoneNumber = await this.phoneNumberRepo.create({
        phoneNumberE164: input.phoneNumber,
        isVerified: true,
        userId: user.id,
      }, tx);

      const defaultVoice = await this.voiceRepo.findFirst(tx);
      if (!defaultVoice) throw new NotFoundError('No voices available');

      const bot = await this.botRepo.create({
        userId: user.id, name: `${input.firstName}'s Bot`, voiceId: defaultVoice.id,
        callSettings: { callGreetingMessage: null, callGoodbyeMessage: null, primaryLanguage: 'en' },
        appointmentSettings: { isEnabled: false, triggers: null, instructions: null },
      }, tx);

      const company = await this.companyRepo.create({ name: `${input.firstName}'s Business` }, tx);
      await this.userRepo.update(user.id, { companyId: company.id }, tx);

      return { user, bot, phoneNumber };
    });

    const auth = this.authService.generateTokens(result.user.id, result.user.jwtPrivateKey, {
      access: result.user.accessTokenNonce,
      refresh: result.user.refreshTokenNonce,
    });

    const expands = await this.loadExpands(result.user, input.expand, { bot: result.bot });
    return this.buildResponse(result.user, auth, expands, input.expand);
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
    const expands = await this.loadExpands(user, input.expand);
    return this.buildResponse(user, auth, expands, input.expand);
  }

  /**
   * Loads the authenticated user with optionally expanded relations. Does not rotate auth tokens.
   *
   * @param userId - The authenticated user id.
   * @param expand - Optional relations to include: bot, bot_settings, call_settings, company, calendar, phone_number.
   * @returns The user shaped for the API, including any requested expansions.
   * @throws {NotFoundError} If the user no longer exists (deleted while a token is still valid).
   */
  async getMe(userId: number, expand?: string[]) {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User not found');
    const expands = await this.loadExpands(user, expand);
    return this.buildResponse(user, null, expands, expand);
  }

  /**
   * Updates a user's profile fields.
   *
   * @param id - The user id.
   * @param data - Fields to update.
   * @returns The updated user.
   * @throws {NotFoundError} If the user does not exist.
   */
  async updateUser(id: number, data: { firstName?: string; lastName?: string; callSettings?: import('../types/user-call-settings.js').UserCallSettings }) {
    const existing = await this.userRepo.findById(id);
    if (!existing) throw new NotFoundError('User not found');
    const merged = data.callSettings
      ? { ...data, callSettings: { ...existing.callSettings, ...data.callSettings } }
      : data;
    const user = await this.userRepo.update(id, merged);
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
    const user = await this.phoneNumberRepo.findUserByE164(phoneNumberE164);
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

  private async loadExpands(user: User, expand?: string[], preloaded: { bot?: Bot } = {}): Promise<Expansions> {
    const needsBot = wantExpand(expand, 'bot') || wantExpand(expand, 'bot_settings');
    const [bot, company, calendar, phoneNumber] = await Promise.all([
      preloaded.bot ? Promise.resolve(preloaded.bot) : (needsBot ? this.botRepo.findByUserId(user.id) : Promise.resolve(undefined)),
      wantExpand(expand, 'company') && user.companyId ? this.companyRepo.findWithRelations(user.companyId) : Promise.resolve(undefined),
      wantExpand(expand, 'calendar') ? this.calendarRepo.findByUserId(user.id) : Promise.resolve(undefined),
      wantExpand(expand, 'phone_number') ? this.phoneNumberRepo.findByUserId(user.id) : Promise.resolve(undefined),
    ]);
    const botPhoneNumber = needsBot && bot ? await this.phoneNumberRepo.findByBotId(bot.id) : undefined;
    return { bot, botPhoneNumber, company, calendar, phoneNumber };
  }

  private async ensurePhoneNumberAvailable(number: string): Promise<void> {
    const existing = await this.phoneNumberRepo.findUserByE164(number);
    if (existing) throw new BadRequestError('Phone number already in use');
  }

  private buildResponse(user: User, auth: unknown, expands: Expansions, expand?: string[]) {
    const response: Record<string, any> = { user: { id: user.id, first_name: user.firstName, last_name: user.lastName } };
    if (auth) response.auth = auth;
    if (wantExpand(expand, 'call_settings')) response.user.call_settings = shapeCallSettings(user.callSettings);
    if (wantExpand(expand, 'bot') || wantExpand(expand, 'bot_settings')) response.user.bot = shapeBot(expands.bot, wantExpand(expand, 'bot_settings'), expands.botPhoneNumber);
    if (wantExpand(expand, 'company')) response.user.company = shapeCompany(expands.company);
    if (wantExpand(expand, 'calendar')) response.user.calendar = shapeCalendar(expands.calendar);
    if (wantExpand(expand, 'phone_number')) response.user.phone_number = shapePhoneNumber(expands.phoneNumber);
    return response;
  }
}

function wantExpand(expand: string[] | undefined, key: string): boolean {
  return expand?.includes(key) ?? false;
}

function shapeCallSettings(cs: User['callSettings'] | null | undefined) {
  const settings = cs ?? {} as NonNullable<User['callSettings']>;
  return {
    is_bot_enabled: settings.isBotEnabled ?? false,
    rings_before_bot_answer: settings.ringsBeforeBotAnswer ?? 3,
    answer_calls_from: settings.answerCallsFrom ?? 'everyone',
  };
}

function shapeBot(bot: Bot | undefined, includeSettings: boolean, phoneNumber: PhoneNumber | undefined) {
  if (!bot) return null;
  const out: Record<string, any> = { id: bot.id, name: bot.name };
  out.phone_number = phoneNumber
    ? { id: phoneNumber.id, e164: phoneNumber.phoneNumberE164, is_verified: phoneNumber.isVerified }
    : null;
  if (!includeSettings) return out;
  const cs = bot.callSettings ?? {};
  out.bot_settings = {
    call_greeting_message: cs.callGreetingMessage ?? null,
    call_goodbye_message: cs.callGoodbyeMessage ?? null,
    voice_id: bot.voiceId,
    primary_language: cs.primaryLanguage ?? 'en',
  };
  return out;
}

function shapeCompany(c: CompanyWithRelations | undefined) {
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    business_type: c.businessType ?? null,
    website: c.website ?? null,
    emails: c.emails ?? [],
    operation_hours: c.operationHours.map((h) => ({
      id: h.id, day_of_week: h.dayOfWeek, open_time: h.openTime, close_time: h.closeTime,
    })),
    offerings: c.offerings.map((o) => ({ id: o.id, name: o.name, description: o.description, type: o.type })),
    faqs: c.faqs.map((f) => ({ id: f.id, question: f.question, answer: f.answer })),
  };
}

function shapeCalendar(cal: Calendar | undefined) {
  if (!cal) return null;
  return { id: cal.id, provider: cal.provider, connected: true };
}

function shapePhoneNumber(pn: PhoneNumber | undefined) {
  if (!pn) return null;
  return { id: pn.id, e164: pn.phoneNumberE164, is_verified: pn.isVerified };
}
