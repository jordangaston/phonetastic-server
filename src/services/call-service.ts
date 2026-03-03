import { randomUUID } from 'node:crypto';
import { injectable, inject } from 'tsyringe';
import { CallRepository } from '../repositories/call-repository.js';
import { CallParticipantRepository } from '../repositories/call-participant-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import { PhoneNumberRepository } from '../repositories/phone-number-repository.js';
import { BotRepository } from '../repositories/bot-repository.js';
import { EndUserRepository } from '../repositories/end-user-repository.js';
import type { Database, Transaction } from '../db/index.js';
import type { LiveKitService } from './livekit-service.js';
import { BadRequestError } from '../lib/errors.js';

/**
 * Orchestrates call creation.
 */
@injectable()
export class CallService {
  constructor(
    @inject('Database') private db: Database,
    @inject('CallRepository') private callRepo: CallRepository,
    @inject('CallParticipantRepository') private participantRepo: CallParticipantRepository,
    @inject('UserRepository') private userRepo: UserRepository,
    @inject('PhoneNumberRepository') private phoneNumberRepo: PhoneNumberRepository,
    @inject('BotRepository') private botRepo: BotRepository,
    @inject('LiveKitService') private livekitService: LiveKitService,
    @inject('EndUserRepository') private endUserRepo: EndUserRepository,
  ) { }

  /**
   * Creates a test call for the authenticated user.
   *
   * @precondition The user must belong to a company, have a phone number, and have a bot.
   * @precondition `testMode` must be true; outbound calls are not yet supported.
   * @postcondition A call record with user and bot participants is persisted atomically, a LiveKit room is created, and a join token is generated.
   * @param userId - The authenticated user's id.
   * @param input - Call creation parameters.
   * @param input.testMode - Must be true. Real outbound calls are not supported.
   * @returns The created call and a LiveKit access token.
   * @throws {BadRequestError} If testMode is false, or user has no company/phone number/bot.
   */
  async createCall(userId: number, input: { testMode: boolean }) {
    if (!input.testMode) {
      throw new BadRequestError('Outbound calls are not supported');
    }

    const user = await this.userRepo.findById(userId);
    if (!user?.companyId) throw new BadRequestError('User has no company');

    const phoneNumber = await this.phoneNumberRepo.findById(user.phoneNumberId);
    if (!phoneNumber) throw new BadRequestError('User phone number not found');

    const bot = await this.botRepo.findByUserId(userId);
    if (!bot) throw new BadRequestError('Bot not found');

    const externalCallId = `test-${randomUUID()}`;

    const { call, botParticipant } = await this.db.transaction(async (tx) => {
      const created = await this.callRepo.create({
        externalCallId,
        companyId: user.companyId!,
        fromPhoneNumberId: phoneNumber.id,
        toPhoneNumberId: phoneNumber.id,
        testMode: true,
      }, tx);

      const [, botPart] = await this.createParticipants(
        created.id, userId, bot.id, user.companyId!, tx,
      );

      return { call: created, botParticipant: botPart };
    });

    await this.livekitService.createRoom(externalCallId);
    await this.livekitService.dispatchAgent(externalCallId);
    await this.participantRepo.updateState(botParticipant.id, 'connected');
    const accessToken = await this.livekitService.generateToken(externalCallId, `user-${userId}`);

    return { call, accessToken };
  }

  /**
   * Creates call and participant records for a real inbound SIP call.
   * All participants are created as `connected` because the caller is already on the line.
   *
   * @precondition `toE164` must match a phone number whose company has a user with a bot.
   * @param externalCallId - The LiveKit room name for this call.
   * @param fromE164 - The caller's E.164 phone number.
   * @param toE164 - The destination E.164 phone number (the purchased number).
   * @throws {BadRequestError} If the destination number, company user, or bot cannot be found.
   */
  async initializeInboundCall(externalCallId: string, fromE164: string, toE164: string): Promise<void> {
    const toPhoneNumber = await this.phoneNumberRepo.findByE164(toE164);
    if (!toPhoneNumber) throw new BadRequestError('Destination phone number not found');

    const user = await this.userRepo.findByPhoneNumberId(toPhoneNumber.id);
    if (!user) throw new BadRequestError('No user found for phone number');

    const bot = await this.botRepo.findByUserId(user.id);
    if (!bot) throw new BadRequestError('No bot found for user');

    await this.db.transaction(async (tx) => {
      let fromPhoneNumber = await this.phoneNumberRepo.findByE164(fromE164, tx);
      if (!fromPhoneNumber) {
        fromPhoneNumber = await this.phoneNumberRepo.create({ phoneNumberE164: fromE164 }, tx);
      }

      let endUser = await this.endUserRepo.findByPhoneNumberId(fromPhoneNumber.id, tx);
      if (!endUser) {
        endUser = await this.endUserRepo.create({ phoneNumberId: fromPhoneNumber.id, companyId: user.companyId! }, tx);
      }

      const call = await this.callRepo.create({
        externalCallId,
        companyId: user.companyId!,
        fromPhoneNumberId: fromPhoneNumber.id,
        toPhoneNumberId: toPhoneNumber.id,
        state: 'connected',
      }, tx);
      await this.participantRepo.create({ callId: call.id, type: 'bot', state: 'connected', botId: bot.id, companyId: user.companyId! }, tx);
      await this.participantRepo.create({ callId: call.id, type: 'end_user', state: 'connected', endUserId: endUser.id, companyId: user.companyId! }, tx);
    });
  }

  /**
   * Updates the call and its end user participant to `connected` after the user joins the LiveKit room.
   * Used for test mode calls where the user connects after the agent is dispatched.
   *
   * @precondition A call with the given `externalCallId` must exist with an `end_user` participant.
   * @param externalCallId - The LiveKit room name (externalCallId) of the call.
   * @throws {BadRequestError} If the call or end user participant cannot be found.
   */
  async onParticipantJoined(externalCallId: string): Promise<void> {
    const call = await this.callRepo.findByExternalCallId(externalCallId);
    if (!call) throw new BadRequestError('Call not found');

    const participant = await this.participantRepo.findByCallIdAndType(call.id, 'agent');
    if (!participant) throw new BadRequestError('Agent participant not found');

    await this.db.transaction(async (tx) => {
      await this.callRepo.updateState(call.id, 'connected', tx);
      await this.participantRepo.updateState(participant.id, 'connected', tx);
    });
  }

  private async createParticipants(callId: number, userId: number, botId: number, companyId: number, tx: Transaction) {
    return Promise.all([
      this.participantRepo.create({ callId, type: 'agent', state: 'connecting', userId, companyId }, tx),
      this.participantRepo.create({ callId, type: 'bot', state: 'waiting', botId, companyId }, tx),
    ]);
  }
}
