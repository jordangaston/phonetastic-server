import 'reflect-metadata';
import { container } from 'tsyringe';
import { createDb, type Database } from '../db/index.js';
import { StubOtpProvider, TwilioVerifyOtpProvider, type OtpProvider } from '../services/otp-provider.js';
import { StubLiveKitService, LiveKitServiceImpl, type LiveKitService } from '../services/livekit-service.js';
import { StubGoogleOAuthService, RealGoogleOAuthService, type GoogleOAuthService } from '../services/google-oauth-service.js';
import type { GoogleCalendarClient } from '../services/google-calendar-client.js';
import { StubFirecrawlService, RealFirecrawlService, type FirecrawlService } from '../services/firecrawl-service.js';
import { OpenAIEmbeddingService, StubEmbeddingService, type EmbeddingService } from '../services/embedding-service.js';
import { StubTelephonyService, TwilioTelephonyService, type TelephonyService } from '../services/telephony-service.js';
import { PhoneNumberRepository } from '../repositories/phone-number-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import { BotRepository } from '../repositories/bot-repository.js';
import { BotSettingsRepository } from '../repositories/bot-settings-repository.js';
import { CallSettingsRepository } from '../repositories/call-settings-repository.js';
import { VoiceRepository } from '../repositories/voice-repository.js';
import { CompanyRepository } from '../repositories/company-repository.js';
import { CallRepository } from '../repositories/call-repository.js';
import { CalendarRepository } from '../repositories/calendar-repository.js';
import { CallParticipantRepository } from '../repositories/call-participant-repository.js';
import { CallTranscriptRepository } from '../repositories/call-transcript-repository.js';
import { CallTranscriptEntryRepository } from '../repositories/call-transcript-entry-repository.js';
import { FaqRepository } from '../repositories/faq-repository.js';
import { OfferingRepository } from '../repositories/offering-repository.js';
import { AddressRepository } from '../repositories/address-repository.js';
import { OperationHourRepository } from '../repositories/operation-hour-repository.js';
import { EndUserRepository } from '../repositories/end-user-repository.js';
import { SkillRepository } from '../repositories/skill-repository.js';
import { BotSkillRepository } from '../repositories/bot-skill-repository.js';
import { SmsMessageRepository } from '../repositories/sms-message-repository.js';
import { EmailAddressRepository } from '../repositories/email-address-repository.js';
import { ChatRepository } from '../repositories/chat-repository.js';
import { EmailRepository } from '../repositories/email-repository.js';
import { AttachmentRepository } from '../repositories/attachment-repository.js';
import { AuthService } from '../services/auth-service.js';
import { CompanyService } from '../services/company-service.js';
import { OtpService } from '../services/otp-service.js';
import { UserService } from '../services/user-service.js';
import { PhoneNumberService } from '../services/phone-number-service.js';
import { CallService } from '../services/call-service.js';
import { CalendarService } from '../services/calendar-service.js';
import { SkillService } from '../services/skill-service.js';
import { BotSkillService } from '../services/bot-skill-service.js';
import { SmsService } from '../services/sms-service.js';
import { EmailAddressService } from '../services/email-address-service.js';
import { ChatService } from '../services/chat-service.js';
import { StubResendService, type ResendService } from '../services/resend-service.js';
import { DBOSClientFactory } from '../services/dbos-client-factory.js';
import { env } from './env.js';

function createOtpProvider(): OtpProvider {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID } = env;
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_VERIFY_SERVICE_SID) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const twilio = require('twilio');
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    return new TwilioVerifyOtpProvider(client.verify.v2.services(TWILIO_VERIFY_SERVICE_SID));
  }
  return new StubOtpProvider();
}

function createLiveKitService(): LiveKitService {
  if (env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET) {
    return new LiveKitServiceImpl(env.LIVEKIT_URL, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  }
  return new StubLiveKitService();
}

function createGoogleOAuthService(): GoogleOAuthService {
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI) {
    return new RealGoogleOAuthService(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
  }
  return new StubGoogleOAuthService();
}

function createFirecrawlService(): FirecrawlService {
  if (env.FIRECRAWL_API_KEY) {
    return new RealFirecrawlService(env.FIRECRAWL_API_KEY);
  }
  return new StubFirecrawlService();
}

function createEmbeddingService(): EmbeddingService {
  if (env.OPENAI_API_KEY) {
    return new OpenAIEmbeddingService();
  }
  return new StubEmbeddingService();
}

function createTelephonyService(): TelephonyService {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = env;
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
    return new TwilioTelephonyService(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  }
  return new StubTelephonyService();
}

/**
 * Initializes the Tsyringe DI container with core dependencies.
 *
 * @precondition Environment variables must be loaded before calling this.
 * @postcondition All repositories, services, and infrastructure are registered.
 * @param overrides - Optional dependency overrides for testing.
 * @param overrides.db - A pre-configured Database instance.
 * @param overrides.dbosClientFactory - A pre-configured DBOSClientFactory instance.
 * @param overrides.otpProvider - A custom OtpProvider implementation.
 * @param overrides.livekitService - A custom LiveKitService implementation.
 * @param overrides.googleOAuthService - A custom GoogleOAuthService implementation.
 * @param overrides.firecrawlService - A custom FirecrawlService implementation.
 * @param overrides.embeddingService - A custom EmbeddingService implementation.
 * @param overrides.telephonyService - A custom TelephonyService implementation.
 */
export function setupContainer(overrides?: {
  db?: Database;
  dbosClientFactory?: DBOSClientFactory;
  otpProvider?: OtpProvider;
  livekitService?: LiveKitService;
  googleOAuthService?: GoogleOAuthService;
  googleCalendarClient?: GoogleCalendarClient;
  firecrawlService?: FirecrawlService;
  embeddingService?: EmbeddingService;
  telephonyService?: TelephonyService;
  resendService?: ResendService;
}): void {
  const db = overrides?.db ?? createDb();
  container.registerInstance<Database>('Database', db);
  container.registerInstance<DBOSClientFactory>('DBOSClientFactory', overrides?.dbosClientFactory ?? new DBOSClientFactory());

  container.registerInstance<OtpProvider>('OtpProvider', overrides?.otpProvider ?? createOtpProvider());
  container.registerInstance<LiveKitService>('LiveKitService', overrides?.livekitService ?? createLiveKitService());
  container.registerInstance<GoogleOAuthService>('GoogleOAuthService', overrides?.googleOAuthService ?? createGoogleOAuthService());
  container.registerInstance<FirecrawlService>('FirecrawlService', overrides?.firecrawlService ?? createFirecrawlService());
  container.registerInstance<EmbeddingService>('EmbeddingService', overrides?.embeddingService ?? createEmbeddingService());
  container.registerInstance<TelephonyService>('TelephonyService', overrides?.telephonyService ?? createTelephonyService());
  container.registerInstance<ResendService>('ResendService', overrides?.resendService ?? new StubResendService());
  if (overrides?.googleCalendarClient) {
    container.registerInstance<GoogleCalendarClient>('GoogleCalendarClient', overrides.googleCalendarClient);
  }

  container.register('PhoneNumberRepository', { useClass: PhoneNumberRepository });
  container.register('UserRepository', { useClass: UserRepository });
  container.register('BotRepository', { useClass: BotRepository });
  container.register('BotSettingsRepository', { useClass: BotSettingsRepository });
  container.register('CallSettingsRepository', { useClass: CallSettingsRepository });
  container.register('VoiceRepository', { useClass: VoiceRepository });
  container.register('CompanyRepository', { useClass: CompanyRepository });
  container.register('CallRepository', { useClass: CallRepository });
  container.register('CalendarRepository', { useClass: CalendarRepository });
  container.register('CallParticipantRepository', { useClass: CallParticipantRepository });
  container.register('CallTranscriptRepository', { useClass: CallTranscriptRepository });
  container.register('CallTranscriptEntryRepository', { useClass: CallTranscriptEntryRepository });
  container.register('FaqRepository', { useClass: FaqRepository });
  container.register('OfferingRepository', { useClass: OfferingRepository });
  container.register('AddressRepository', { useClass: AddressRepository });
  container.register('OperationHourRepository', { useClass: OperationHourRepository });
  container.register('EndUserRepository', { useClass: EndUserRepository });
  container.register('SkillRepository', { useClass: SkillRepository });
  container.register('BotSkillRepository', { useClass: BotSkillRepository });
  container.register('SmsMessageRepository', { useClass: SmsMessageRepository });
  container.register('EmailAddressRepository', { useClass: EmailAddressRepository });
  container.register('ChatRepository', { useClass: ChatRepository });
  container.register('EmailRepository', { useClass: EmailRepository });
  container.register('AttachmentRepository', { useClass: AttachmentRepository });
  container.register('AuthService', { useClass: AuthService });
  container.register('CompanyService', { useClass: CompanyService });
  container.register('OtpService', { useClass: OtpService });
  container.register('UserService', { useClass: UserService });
  container.register('PhoneNumberService', { useClass: PhoneNumberService });
  container.register('CallService', { useClass: CallService });
  container.register('CalendarService', { useClass: CalendarService });
  container.register('SkillService', { useClass: SkillService });
  container.register('BotSkillService', { useClass: BotSkillService });
  container.register('SmsService', { useClass: SmsService });
  container.register('EmailAddressService', { useClass: EmailAddressService });
  container.register('ChatService', { useClass: ChatService });
}

export { container };
