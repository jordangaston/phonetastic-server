import { randomUUID } from 'node:crypto';
import { injectable, inject } from 'tsyringe';
import { CallRepository } from '../repositories/call-repository.js';
import { CallParticipantRepository } from '../repositories/call-participant-repository.js';
import { CallTranscriptRepository } from '../repositories/call-transcript-repository.js';
import { CallTranscriptEntryRepository } from '../repositories/call-transcript-entry-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import { PhoneNumberRepository } from '../repositories/phone-number-repository.js';
import { BotRepository } from '../repositories/bot-repository.js';
import { EndUserRepository } from '../repositories/end-user-repository.js';
import { VoiceRepository } from '../repositories/voice-repository.js';
import type { Database, Transaction } from '../db/index.js';
import type { LiveKitService } from './livekit-service.js';
import { BadRequestError } from '../lib/errors.js';
import { DBOSClientFactory } from './dbos-client-factory.js';
import type { Voice, PhoneNumber, Bot, BotCallParticipant, EndUserCallParticipant, ConnectingAgentParticipant } from '../db/models.js';
import type { ConnectingCall, InboundConnectedCall } from '../types/call.js';
import { isWaitingInboundCall, isWaitingAgentParticipant, isConnectedCall, transitionToConnected, transitionParticipantToConnected, disconnectParticipant, WaitingBotParticipant, type DisconnectParticipantResult } from '../types/index.js';
import type { ContactService } from './contact-service.js';
import { createLogger } from '../lib/logger.js';
import { env } from '../config/env.js';

export type ConnectInboundCallArgs =
  | { kind: 'live'; externalCallId: string; fromE164: string; toE164: string; callerIdentity: string }
  | { kind: 'test'; externalCallId: string };

const logger = createLogger('call-service');

const SUMMARIZE_CALL_QUEUE = 'summarize-call';

/**
 * Orchestrates call creation.
 */
@injectable()
export class CallService {
  constructor(
    @inject('Database') private db: Database,
    @inject('CallRepository') private callRepo: CallRepository,
    @inject('CallParticipantRepository') private participantRepo: CallParticipantRepository,
    @inject('CallTranscriptRepository') private transcriptRepo: CallTranscriptRepository,
    @inject('CallTranscriptEntryRepository') private transcriptEntryRepo: CallTranscriptEntryRepository,
    @inject('UserRepository') private userRepo: UserRepository,
    @inject('PhoneNumberRepository') private phoneNumberRepo: PhoneNumberRepository,
    @inject('BotRepository') private botRepo: BotRepository,
    @inject('VoiceRepository') private voiceRepo: VoiceRepository,
    @inject('LiveKitService') private livekitService: LiveKitService,
    @inject('EndUserRepository') private endUserRepo: EndUserRepository,
    @inject('ContactService') private contactService: ContactService,
    @inject('DBOSClientFactory') private dbosClientFactory: DBOSClientFactory,
  ) { }

  /**
   * Returns a paginated list of calls for the authenticated user's company.
   *
   * @precondition The user must belong to a company.
   * @postcondition Returns calls ordered by id in the requested direction with optional transcript expansion.
   * @param userId - The authenticated user's id.
   * @param opts - Pagination, sorting, and expansion options.
   * @param opts.pageToken - Call id to start after (exclusive). Omit for the first page.
   * @param opts.limit - Maximum number of rows to return. Defaults to 20.
   * @param opts.sort - Sort direction by id: 'asc' or 'desc'. Defaults to 'desc'.
   * @param opts.expand - Optional relations to include (e.g. ['transcript']).
   * @returns An object with the calls array and optional transcript data.
   * @throws {BadRequestError} If the user has no company.
   */
  async listCalls(userId: number, opts?: {
    pageToken?: number;
    limit?: number;
    sort?: 'asc' | 'desc';
    expand?: string[];
  }) {
    const user = await this.userRepo.findById(userId);
    if (!user?.companyId) throw new BadRequestError('User has no company');

    const rows = await this.callRepo.findAllByCompanyId(user.companyId, {
      pageToken: opts?.pageToken,
      limit: opts?.limit,
      sort: opts?.sort,
    });

    const [transcripts, phoneNumbers, callerNames] = await Promise.all([
      this.loadTranscriptExpands(rows, opts?.expand),
      this.loadCallerPhoneNumbers(rows),
      this.loadCallerNames(rows),
    ]);
    return { calls: rows, transcripts, phoneNumbers, callerNames };
  }

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
  async createCall(userId: number, input: { testMode: boolean }): Promise<{ call: ConnectingCall, accessToken: string }> {
    if (!input.testMode) {
      throw new BadRequestError('Outbound calls are not supported');
    }

    const user = await this.userRepo.findById(userId);
    if (!user?.companyId) throw new BadRequestError('User has no company');

    const phoneNumber = await this.phoneNumberRepo.findByUserId(userId);
    if (!phoneNumber) throw new BadRequestError('User phone number not found');

    const bot = await this.botRepo.findByUserId(userId);
    if (!bot) throw new BadRequestError('Bot not found');

    const externalCallId = `test-${randomUUID()}`;
    const participantIdentity = `user-${userId}`;
    const voice = await this.resolveVoice(bot.id);
    const { call, botParticipant } = await this.db.transaction(async (tx) => {
      const call = await this.callRepo.create({
        externalCallId,
        companyId: user.companyId!,
        fromPhoneNumberId: phoneNumber.id,
        toPhoneNumberId: phoneNumber.id,
        testMode: true,
        state: 'connecting',
      }, tx);

      const [, botParticipant] = await this.createParticipants(
        call.id, userId, bot.id, user.companyId!, participantIdentity, voice?.id, tx,
      );

      return { call, botParticipant };
    });

    await this.livekitService.createRoom(externalCallId);
    await this.livekitService.dispatchAgent(externalCallId);
    const connectedBotParticipant = await transitionParticipantToConnected(botParticipant);
    await this.participantRepo.updateState(connectedBotParticipant.id, connectedBotParticipant.state);
    const accessToken = await this.livekitService.generateToken(externalCallId, participantIdentity);

    return { call, accessToken };
  }

  /**
   * Connects an inbound call. Routes to the live or test implementation based on `args.kind`.
   *
   * @param args - `{ kind: 'live', ... }` for a real SIP call; `{ kind: 'test', externalCallId }` for a test call.
   * @returns The {@link InboundConnectedCall}.
   */
  async connectInboundCall(args: ConnectInboundCallArgs): Promise<InboundConnectedCall> {
    return args.kind === 'test' ? this.connectInboundTestCall(args.externalCallId) : this.connectInboundLiveCall(args);
  }

  /**
   * Persists a single transcript entry for a call, resolving the speaker FK from participants.
   *
   * @precondition A call_transcript row must exist for the call (created during initialization).
   * @param externalCallId - The LiveKit room name for this call.
   * @param entry - The utterance to persist.
   * @param entry.role - 'user' for the human caller, 'assistant' for the AI bot.
   * @param entry.text - The utterance text.
   * @param entry.sequenceNumber - The position of this entry in the conversation.
   * @postcondition A call_transcript_entries row is inserted with the appropriate speaker FK set.
   * @boundary Silently returns if the call or transcript is not yet found (race before initialization).
   */
  async saveTranscriptEntry(
    externalCallId: string,
    entry: { role: 'user' | 'assistant'; text: string; sequenceNumber: number },
  ): Promise<void> {
    const call = await this.callRepo.findByExternalCallId(externalCallId);
    if (!call) return;

    const transcript = await this.transcriptRepo.findByCallId(call.id);
    if (!transcript) return;

    const participants = await this.participantRepo.findAllByCallId(call.id);
    const speakerFK = this.resolveSpeakerFK(entry.role, participants);

    await this.transcriptEntryRepo.create({ transcriptId: transcript.id, text: entry.text, sequenceNumber: entry.sequenceNumber, ...speakerFK });
  }

  /**
   * Creates call and participant records for a real inbound SIP call.
   * All participants are created as `connected` because the caller is already on the line.
   *
   * @precondition `args.toE164` must match a phone number assigned to a bot via `phone_numbers.bot_id`.
   * @param args - The live call arguments.
   * @returns The {@link InboundConnectedCall} created for this inbound call.
   * @throws {BadRequestError} If no bot is associated with the destination number.
   */
  private async connectInboundLiveCall(args: Extract<ConnectInboundCallArgs, { kind: 'live' }>): Promise<InboundConnectedCall> {
    const { toE164, fromE164 } = args;
    const { bot, toPhoneNumber } = await this.resolveBotByPhoneNumber(toE164);
    const user = await this.userRepo.findById(bot.userId);
    if (!user?.companyId) throw new BadRequestError('Bot owner has no company');
    const { call, endUserParticipant } = await this.db.transaction((tx) =>
      this.createInboundCallRecords(args, toPhoneNumber, user.companyId!, bot, tx),
    );
    await this.tryResolveContact(fromE164, user.companyId!, endUserParticipant.endUserId);
    return call;
  }

  /**
   * Transitions a test call to `connected` when the agent user joins the LiveKit room.
   *
   * @precondition A call with the given `externalCallId` must exist with both `agent` and `bot` participants.
   * @param externalCallId - The LiveKit room name (externalCallId) of the call.
   * @returns The {@link InboundConnectedCall} after transitioning to connected state.
   * @throws {BadRequestError} If the call, agent participant, or bot participant cannot be found.
   * @throws {BadRequestError} If the call is not a waiting inbound call or the agent participant is not in a waiting state.
   */
  private async connectInboundTestCall(externalCallId: string): Promise<InboundConnectedCall> {
    const call = await this.callRepo.findByExternalCallIdWithParticipants(externalCallId);
    if (!call) throw new BadRequestError('Call not found');
    if (!isWaitingInboundCall(call)) throw new BadRequestError('Expected a waiting inbound call');

    const agentPart = call.participants.find(p => p.type === 'agent');
    if (!agentPart) throw new BadRequestError('Agent participant not found');
    if (!isWaitingAgentParticipant(agentPart)) throw new BadRequestError('Expected a waiting agent participant');

    const botPart = call.participants.find(p => p.type === 'bot');
    if (!botPart?.botId) throw new BadRequestError('Bot participant not found');

    const connected = transitionToConnected(call);
    const connectedAgent = transitionParticipantToConnected(agentPart);
    await this.db.transaction(async (tx) => {
      await this.callRepo.updateState(connected.id, connected.state, tx);
      await this.participantRepo.updateState(connectedAgent.id, connectedAgent.state, tx);
      await this.transcriptRepo.create({ callId: connected.id }, tx);
    });
    return connected;
  }

  /**
   * Marks a disconnected participant as finished or failed using their LiveKit identity.
   * If all other participants are already terminal, also marks the call.
   *
   * @precondition A call with the given `externalCallId` should exist; silently returns if not (e.g. call setup failed).
   * @param externalCallId - The LiveKit room name for this call.
   * @param participantIdentity - The LiveKit identity of the disconnected participant.
   * @param state - The terminal state to set on the participant and call.
   * @param failureReason - Human-readable failure reason, if state is `failed`.
   * @postcondition If the call transitions to a terminal state, the `SummarizeCallTranscript` workflow is enqueued.
   * @throws {BadRequestError} If no participant matches the given identity.
   * @boundary externalCallId must match an existing room name; state must be a terminal CallState.
   */
  async onParticipantDisconnected(externalCallId: string, participantIdentity: string, state: 'finished' | 'failed', failureReason?: string): Promise<void> {
    const call = await this.callRepo.findByExternalCallId(externalCallId);
    if (!call || !isConnectedCall(call)) return;

    const participant = await this.participantRepo.findByCallIdAndExternalId(call.id, participantIdentity);
    if (!participant) throw new BadRequestError(`No participant found with identity ${participantIdentity}`);

    const participants = await this.participantRepo.findAllByCallId(call.id);
    const result = disconnectParticipant(call, participant, participants, state, failureReason);
    await this.persistDisconnect(result);
  }

  /**
   * Marks the bot participant as finished or failed when the agent session closes.
   * If all other participants are already terminal, also marks the call.
   *
   * @precondition A call with the given `externalCallId` should exist; silently returns if not.
   * @param externalCallId - The LiveKit room name for this call.
   * @param state - The terminal state to set on the participant and call.
   * @param failureReason - Human-readable failure reason, if state is `failed`.
   * @postcondition If the call transitions to a terminal state, the `SummarizeCallTranscript` workflow is enqueued.
   * @throws {BadRequestError} If the bot participant cannot be found.
   * @boundary externalCallId must match an existing room name; state must be a terminal CallState.
   */
  async onSessionClosed(externalCallId: string, state: 'finished' | 'failed', failureReason?: string): Promise<void> {
    const call = await this.callRepo.findByExternalCallId(externalCallId);
    if (!call || !isConnectedCall(call)) return;

    const participants = await this.participantRepo.findAllByCallId(call.id);
    const bot = participants.find(p => p.type === 'bot');
    if (!bot) throw new BadRequestError('Bot participant not found');

    const result = disconnectParticipant(call, bot, participants, state, failureReason);
    await this.persistDisconnect(result);
  }

  private resolveSpeakerFK(
    role: 'user' | 'assistant',
    participants: { type: string; botId?: number | null; endUserId?: number | null; userId?: number | null }[],
  ): { botId?: number; endUserId?: number; userId?: number } {
    if (role === 'assistant') {
      const bot = participants.find(p => p.type === 'bot');
      return bot?.botId ? { botId: bot.botId } : {};
    }
    const endUser = participants.find(p => p.type === 'end_user');
    if (endUser?.endUserId) return { endUserId: endUser.endUserId };
    const agent = participants.find(p => p.type === 'agent');
    return agent?.userId ? { userId: agent.userId } : {};
  }

  private async createParticipants(callId: number, userId: number, botId: number, companyId: number, externalId: string, voiceId: number | undefined, tx: Transaction): Promise<[ConnectingAgentParticipant, WaitingBotParticipant]> {
    return Promise.all([
      this.participantRepo.create({ callId, type: 'agent', state: 'connecting', userId, companyId, externalId }, tx),
      this.participantRepo.create({ callId, type: 'bot', state: 'waiting', botId, companyId, voiceId }, tx),
    ]);
  }

  private async loadCallerPhoneNumbers(rows: { fromPhoneNumberId: number }[]): Promise<Map<number, string>> {
    const ids = [...new Set(rows.map((row) => row.fromPhoneNumberId))];
    return this.phoneNumberRepo.findE164ByIds(ids);
  }

  private async loadCallerNames(rows: { id: number }[]): Promise<Map<number, { firstName: string | null; lastName: string | null }>> {
    if (rows.length === 0) return new Map();
    const callIds = rows.map((row) => row.id);
    return this.endUserRepo.findNamesByCallIds(callIds);
  }

  private async loadTranscriptExpands(
    rows: { id: number }[],
    expand?: string[],
  ): Promise<Map<number, { id: number; summary: string | null; entries: any[] }> | undefined> {
    if (!expand?.includes('transcript') || rows.length === 0) return undefined;

    const map = new Map<number, { id: number; summary: string | null; entries: any[] }>();
    await Promise.all(rows.map(async (call) => {
      const transcript = await this.transcriptRepo.findByCallId(call.id);
      if (!transcript) return;
      const entries = await this.transcriptEntryRepo.findAllByTranscriptId(transcript.id);
      map.set(call.id, { id: transcript.id, summary: transcript.summary, entries });
    }));
    return map;
  }

  private async createInboundCallRecords(
    { externalCallId, fromE164, callerIdentity }: Pick<Extract<ConnectInboundCallArgs, { kind: 'live' }>, 'externalCallId' | 'fromE164' | 'callerIdentity'>,
    toPhoneNumber: PhoneNumber,
    companyId: number,
    bot: Bot,
    tx: Transaction,
  ): Promise<{ call: InboundConnectedCall; botParticipant: BotCallParticipant; endUserParticipant: EndUserCallParticipant }> {
    const endUser = await this.findOrCreateEndUser(fromE164, companyId, tx);
    const fromPhoneNumber = await this.findOrCreateCallerPhoneNumber(fromE164, endUser.id, tx);
    const call = await this.callRepo.create({ externalCallId, companyId, fromPhoneNumberId: fromPhoneNumber.id, toPhoneNumberId: toPhoneNumber.id, state: 'connected', direction: 'inbound' }, tx);
    await this.transcriptRepo.create({ callId: call.id }, tx);
    const botParticipant = await this.participantRepo.create({ callId: call.id, type: 'bot', state: 'connected', botId: bot.id, companyId }, tx);
    const endUserParticipant = await this.participantRepo.create({ callId: call.id, type: 'end_user', state: 'connected', endUserId: endUser.id, externalId: callerIdentity, companyId }, tx);
    return { call, botParticipant, endUserParticipant };
  }

  private async resolveVoice(botId: number): Promise<Voice | undefined> {
    const botVoice = await this.voiceRepo.findByBotId(botId);
    if (botVoice) return botVoice;
    const defaultVoice = await this.voiceRepo.findFirstByProvider(env.DEFAULT_VOICE_PROVIDER);
    if (defaultVoice) {
      logger.debug({ botId }, 'No voice configured for bot; using default provider voice');
      return defaultVoice;
    }
    logger.error({ botId }, 'No voice found for bot or default provider');
    return undefined;
  }

  private async tryResolveContact(fromE164: string, companyId: number, endUserId: number): Promise<void> {
    try {
      const contact = await this.contactService.resolveContact(fromE164, companyId);
      if (contact?.firstName || contact?.lastName || contact?.email) {
        await this.endUserRepo.updateFromContact(endUserId, {
          firstName: contact.firstName ?? undefined,
          lastName: contact.lastName ?? undefined,
          email: contact.email ?? undefined,
        });
      }
    } catch (err) {
      logger.warn({ err, fromE164, companyId, endUserId }, 'Contact resolution failed; continuing without contact data');
    }
  }

  private async resolveBotByPhoneNumber(toE164: string) {
    const result = await this.phoneNumberRepo.findBotByE164(toE164);
    if (!result) {
      logger.warn({ toE164 }, 'No bot associated with destination phone number');
      throw new BadRequestError(`No bot found for destination number ${toE164}`);
    }
    return { bot: result.bot, toPhoneNumber: result.phoneNumber };
  }

  private async findOrCreateCallerPhoneNumber(e164: string, endUserId: number, tx: Transaction) {
    const existing = await this.phoneNumberRepo.findByE164(e164, tx);
    if (existing) {
      if (!existing.endUserId) await this.phoneNumberRepo.updateEndUserId(existing.id, endUserId, tx);
      return existing;
    }
    return this.phoneNumberRepo.create({ phoneNumberE164: e164, endUserId }, tx);
  }

  private async findOrCreateEndUser(e164: string, companyId: number, tx: Transaction) {
    const existing = await this.phoneNumberRepo.findByE164(e164, tx);
    if (existing?.endUserId) {
      const endUser = await this.endUserRepo.findById(existing.endUserId, tx);
      if (endUser) return endUser;
    }
    return this.endUserRepo.create({ companyId }, tx);
  }

  private async persistDisconnect(result: DisconnectParticipantResult): Promise<void> {
    const { participant, call } = result;
    await this.db.transaction(async (tx) => {
      await this.participantRepo.updateState(participant.id, participant.state, tx, participant.failureReason ?? undefined);
      if (!isConnectedCall(call)) {
        await this.callRepo.updateState(call.id, call.state, tx, call.failureReason ?? undefined);
      }
    });
    for (const event of result.events) {
      if (event.type === 'com.phonetastic.call_summary.triggered') await this.enqueueCallSummary(event.data.callId);
    }
  }

  private async enqueueCallSummary(callId: number): Promise<void> {
    const client = await this.dbosClientFactory.getInstance();
    await client.enqueue(
      { workflowClassName: 'SummarizeCallTranscript', workflowName: 'run', queueName: SUMMARIZE_CALL_QUEUE },
      callId,
    );
  }
}
