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
import type { Database, Transaction } from '../db/index.js';
import type { LiveKitService } from './livekit-service.js';
import { BadRequestError } from '../lib/errors.js';
import { DBOSClientFactory } from './dbos-client-factory.js';


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
    @inject('LiveKitService') private livekitService: LiveKitService,
    @inject('EndUserRepository') private endUserRepo: EndUserRepository,
    @inject('DBOSClientFactory') private dbosClientFactory: DBOSClientFactory,
  ) { }

  /**
   * Returns a call by its external call id.
   *
   * @param externalCallId - The LiveKit room name.
   * @returns The call row, or undefined.
   */
  async findByExternalCallId(externalCallId: string) {
    return this.callRepo.findByExternalCallId(externalCallId);
  }

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

    const transcripts = await this.loadTranscriptExpands(rows, opts?.expand);
    return { calls: rows, transcripts };
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
      await this.transcriptRepo.create({ callId: call.id }, tx);
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
      await this.transcriptRepo.create({ callId: call.id }, tx);
    });
  }

  /**
   * Marks the end user participant as finished or failed when they leave the LiveKit room.
   * If all other participants are already terminal, also marks the call.
   *
   * @precondition A call with the given `externalCallId` should exist; silently returns if not (e.g. call setup failed).
   * @param externalCallId - The LiveKit room name for this call.
   * @param state - The terminal state to set on the participant and call.
   * @param failureReason - Human-readable failure reason, if state is `failed`.
   * @postcondition If the call transitions to a terminal state, the `SummarizeCallTranscript` workflow is enqueued.
   * @throws {BadRequestError} If the end user participant cannot be found.
   * @boundary externalCallId must match an existing room name; state must be a terminal CallState.
   */
  async onEndUserDisconnected(externalCallId: string, state: 'finished' | 'failed', failureReason?: string): Promise<void> {
    const call = await this.callRepo.findByExternalCallId(externalCallId);
    if (!call) return;

    const participants = await this.participantRepo.findAllByCallId(call.id);
    const endUser = participants.find(p => p.type === 'end_user');
    if (!endUser) throw new BadRequestError('End user participant not found');

    const isCallTerminal = this.allTerminalExcept(participants, endUser.id);
    await this.db.transaction(async (tx) => {
      await this.participantRepo.updateState(endUser.id, state, tx, failureReason);
      if (isCallTerminal) {
        await this.callRepo.updateState(call.id, state, tx, failureReason);
      }
    });
    if (isCallTerminal) await this.enqueueCallSummary(call.id);
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
    if (!call) return;

    const participants = await this.participantRepo.findAllByCallId(call.id);
    const bot = participants.find(p => p.type === 'bot');
    if (!bot) throw new BadRequestError('Bot participant not found');

    const isCallTerminal = this.allTerminalExcept(participants, bot.id);
    await this.db.transaction(async (tx) => {
      await this.participantRepo.updateState(bot.id, state, tx, failureReason);
      if (isCallTerminal) {
        await this.callRepo.updateState(call.id, state, tx, failureReason);
      }
    });
    if (isCallTerminal) await this.enqueueCallSummary(call.id);
  }

  private async enqueueCallSummary(callId: number): Promise<void> {
    const client = await this.dbosClientFactory.getInstance();
    await client.enqueue(
      { workflowClassName: 'SummarizeCallTranscript', workflowName: 'run', queueName: SUMMARIZE_CALL_QUEUE },
      callId,
    );
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

  private allTerminalExcept(participants: { id: number; state: string }[], excludeId: number): boolean {
    return participants
      .filter(p => p.id !== excludeId)
      .every(p => p.state === 'finished' || p.state === 'failed');
  }

  private async createParticipants(callId: number, userId: number, botId: number, companyId: number, tx: Transaction) {
    return Promise.all([
      this.participantRepo.create({ callId, type: 'agent', state: 'connecting', userId, companyId }, tx),
      this.participantRepo.create({ callId, type: 'bot', state: 'waiting', botId, companyId }, tx),
    ]);
  }
}
