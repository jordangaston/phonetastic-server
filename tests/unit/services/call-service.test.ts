import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CallService } from '../../../src/services/call-service.js';
import { BadRequestError } from '../../../src/lib/errors.js';

const mockEnqueue = vi.fn().mockResolvedValue(undefined);
const mockDbosClientFactory = { getInstance: vi.fn().mockResolvedValue({ enqueue: mockEnqueue }) };

describe('CallService', () => {
  let db: any;
  let callRepo: any;
  let participantRepo: any;
  let transcriptRepo: any;
  let transcriptEntryRepo: any;
  let userRepo: any;
  let phoneNumberRepo: any;
  let botRepo: any;
  let livekitService: any;
  let endUserRepo: any;
  let service: CallService;

  beforeEach(() => {
    db = { transaction: vi.fn().mockImplementation(async (cb: any) => cb({})) };
    callRepo = { create: vi.fn(), findByExternalCallId: vi.fn(), updateState: vi.fn().mockResolvedValue(undefined) };
    participantRepo = { create: vi.fn(), updateState: vi.fn().mockResolvedValue(undefined), findByCallIdAndType: vi.fn(), findAllByCallId: vi.fn() };
    transcriptRepo = { create: vi.fn().mockResolvedValue({ id: 1 }), findByCallId: vi.fn() };
    transcriptEntryRepo = { create: vi.fn().mockResolvedValue(undefined) };
    userRepo = { findById: vi.fn(), findByCompanyId: vi.fn(), findByPhoneNumberId: vi.fn() };
    phoneNumberRepo = { findById: vi.fn(), findByE164: vi.fn(), create: vi.fn() };
    botRepo = { findByUserId: vi.fn() };
    livekitService = {
      createRoom: vi.fn().mockResolvedValue('room-id'),
      generateToken: vi.fn().mockResolvedValue('access-token'),
      dispatchAgent: vi.fn().mockResolvedValue(undefined),
      deleteRoom: vi.fn().mockResolvedValue(undefined),
    };
    endUserRepo = { findByPhoneNumberId: vi.fn(), create: vi.fn() };
    mockEnqueue.mockClear();
    mockDbosClientFactory.getInstance.mockClear();
    service = new CallService(db, callRepo, participantRepo, transcriptRepo, transcriptEntryRepo, userRepo, phoneNumberRepo, botRepo, livekitService, endUserRepo, mockDbosClientFactory as any);
  });

  describe('createCall', () => {
    it('throws BadRequestError when testMode is false', async () => {
      await expect(service.createCall(1, { testMode: false })).rejects.toThrow(BadRequestError);
    });

    it('throws BadRequestError when user has no company', async () => {
      userRepo.findById.mockResolvedValue({ id: 1, companyId: null, phoneNumberId: 1 });
      await expect(service.createCall(1, { testMode: true })).rejects.toThrow(BadRequestError);
    });

    it('throws BadRequestError when phone number is not found', async () => {
      userRepo.findById.mockResolvedValue({ id: 1, companyId: 5, phoneNumberId: 1 });
      phoneNumberRepo.findById.mockResolvedValue(null);
      await expect(service.createCall(1, { testMode: true })).rejects.toThrow(BadRequestError);
    });

    it('throws BadRequestError when bot is not found', async () => {
      userRepo.findById.mockResolvedValue({ id: 1, companyId: 5, phoneNumberId: 1 });
      phoneNumberRepo.findById.mockResolvedValue({ id: 1 });
      botRepo.findByUserId.mockResolvedValue(null);
      await expect(service.createCall(1, { testMode: true })).rejects.toThrow(BadRequestError);
    });

    it('creates a call, dispatches the agent, and returns a LiveKit access token', async () => {
      const call = { id: 99, externalCallId: 'test-abc', state: 'connecting', testMode: true };
      userRepo.findById.mockResolvedValue({ id: 1, companyId: 5, phoneNumberId: 1 });
      phoneNumberRepo.findById.mockResolvedValue({ id: 1 });
      botRepo.findByUserId.mockResolvedValue({ id: 2 });
      callRepo.create.mockResolvedValue(call);
      participantRepo.create.mockResolvedValue({ id: 10 });

      const result = await service.createCall(1, { testMode: true });

      expect(result.call.id).toBe(99);
      expect(result.accessToken).toBe('access-token');
      expect(livekitService.createRoom).toHaveBeenCalledOnce();
      expect(livekitService.dispatchAgent).toHaveBeenCalledWith(expect.stringMatching(/^test-/));
      expect(participantRepo.updateState).toHaveBeenCalledWith(10, 'connected');
      expect(livekitService.generateToken).toHaveBeenCalledWith(expect.stringMatching(/^test-/), 'user-1');
    });
  });

  describe('initializeInboundCall', () => {
    it('throws BadRequestError when destination phone number is not found', async () => {
      phoneNumberRepo.findByE164.mockResolvedValue(null);
      await expect(service.initializeInboundCall('room-1', '+1111', '+2222')).rejects.toThrow(BadRequestError);
    });

    it('throws BadRequestError when no user is found for the phone number', async () => {
      phoneNumberRepo.findByE164.mockResolvedValue({ id: 10, companyId: 5 });
      userRepo.findByPhoneNumberId.mockResolvedValue(null);
      await expect(service.initializeInboundCall('room-1', '+1111', '+2222')).rejects.toThrow(BadRequestError);
    });

    it('throws BadRequestError when no bot is found for the user', async () => {
      phoneNumberRepo.findByE164.mockResolvedValue({ id: 10, companyId: 5 });
      userRepo.findByPhoneNumberId.mockResolvedValue({ id: 3 });
      botRepo.findByUserId.mockResolvedValue(null);
      await expect(service.initializeInboundCall('room-1', '+1111', '+2222')).rejects.toThrow(BadRequestError);
    });

    it('creates call and both participants as connected in a transaction', async () => {
      phoneNumberRepo.findByE164.mockResolvedValue({ id: 10, companyId: 5 });
      userRepo.findByPhoneNumberId.mockResolvedValue({ id: 3 });
      botRepo.findByUserId.mockResolvedValue({ id: 7 });
      endUserRepo.findByPhoneNumberId.mockResolvedValue({ id: 20 });
      callRepo.create.mockResolvedValue({ id: 42 });
      participantRepo.create.mockResolvedValue({ id: 1 });

      await service.initializeInboundCall('room-1', '+1111', '+2222');

      expect(db.transaction).toHaveBeenCalledOnce();
      expect(callRepo.create).toHaveBeenCalledWith(expect.objectContaining({ state: 'connected', externalCallId: 'room-1' }), expect.anything());
      expect(transcriptRepo.create).toHaveBeenCalledWith({ callId: 42 }, expect.anything());
      expect(participantRepo.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'bot', state: 'connected' }), expect.anything());
      expect(participantRepo.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'end_user', state: 'connected', endUserId: 20 }), expect.anything());
    });

    it('creates the from phone number and end user when they do not exist', async () => {
      phoneNumberRepo.findByE164.mockResolvedValueOnce({ id: 10, companyId: 5 }).mockResolvedValueOnce(undefined);
      phoneNumberRepo.create.mockResolvedValue({ id: 11 });
      userRepo.findByPhoneNumberId.mockResolvedValue({ id: 3, companyId: 9 });
      botRepo.findByUserId.mockResolvedValue({ id: 7 });
      endUserRepo.findByPhoneNumberId.mockResolvedValue(undefined);
      endUserRepo.create.mockResolvedValue({ id: 21 });
      callRepo.create.mockResolvedValue({ id: 42 });
      participantRepo.create.mockResolvedValue({ id: 1 });

      await service.initializeInboundCall('room-1', '+1111', '+2222');

      expect(phoneNumberRepo.create).toHaveBeenCalledWith({ phoneNumberE164: '+1111' }, expect.anything());
      expect(endUserRepo.create).toHaveBeenCalledWith({ phoneNumberId: 11, companyId: 9 }, expect.anything());
      expect(participantRepo.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'end_user', endUserId: 21 }), expect.anything());
    });
  });

  describe('onEndUserDisconnected', () => {
    it('returns silently when call is not found', async () => {
      callRepo.findByExternalCallId.mockResolvedValue(null);
      await expect(service.onEndUserDisconnected('room-1', 'finished')).resolves.toBeUndefined();
    });

    it('throws BadRequestError when end_user participant is not found', async () => {
      callRepo.findByExternalCallId.mockResolvedValue({ id: 99 });
      participantRepo.findAllByCallId.mockResolvedValue([{ id: 10, type: 'bot', state: 'connected' }]);
      await expect(service.onEndUserDisconnected('room-1', 'finished')).rejects.toThrow(BadRequestError);
    });

    it('marks end_user as finished with no failure reason', async () => {
      callRepo.findByExternalCallId.mockResolvedValue({ id: 99 });
      participantRepo.findAllByCallId.mockResolvedValue([
        { id: 10, type: 'bot', state: 'finished' },
        { id: 20, type: 'end_user', state: 'connected' },
      ]);

      await service.onEndUserDisconnected('room-1', 'finished');

      expect(participantRepo.updateState).toHaveBeenCalledWith(20, 'finished', expect.anything(), undefined);
    });

    it('marks end_user as failed with a failure reason', async () => {
      callRepo.findByExternalCallId.mockResolvedValue({ id: 99 });
      participantRepo.findAllByCallId.mockResolvedValue([
        { id: 10, type: 'bot', state: 'finished' },
        { id: 20, type: 'end_user', state: 'connected' },
      ]);

      await service.onEndUserDisconnected('room-1', 'failed', 'SIP trunk failure');

      expect(participantRepo.updateState).toHaveBeenCalledWith(20, 'failed', expect.anything(), 'SIP trunk failure');
    });

    it('marks the call and enqueues summary when all other participants are terminal', async () => {
      callRepo.findByExternalCallId.mockResolvedValue({ id: 99 });
      participantRepo.findAllByCallId.mockResolvedValue([
        { id: 10, type: 'bot', state: 'finished' },
        { id: 20, type: 'end_user', state: 'connected' },
      ]);

      await service.onEndUserDisconnected('room-1', 'failed', 'SIP trunk failure');

      expect(callRepo.updateState).toHaveBeenCalledWith(99, 'failed', expect.anything(), 'SIP trunk failure');
      expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({ workflowClassName: 'SummarizeCallTranscript' }), 99);
    });

    it('does not mark the call or enqueue summary when other participants are still active', async () => {
      callRepo.findByExternalCallId.mockResolvedValue({ id: 99 });
      participantRepo.findAllByCallId.mockResolvedValue([
        { id: 10, type: 'bot', state: 'connected' },
        { id: 20, type: 'end_user', state: 'connected' },
      ]);

      await service.onEndUserDisconnected('room-1', 'finished');

      expect(callRepo.updateState).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });

  describe('onSessionClosed', () => {
    it('returns silently when call is not found', async () => {
      callRepo.findByExternalCallId.mockResolvedValue(null);
      await expect(service.onSessionClosed('room-1', 'finished')).resolves.toBeUndefined();
    });

    it('throws BadRequestError when bot participant is not found', async () => {
      callRepo.findByExternalCallId.mockResolvedValue({ id: 99 });
      participantRepo.findAllByCallId.mockResolvedValue([{ id: 20, type: 'end_user', state: 'finished' }]);
      await expect(service.onSessionClosed('room-1', 'finished')).rejects.toThrow(BadRequestError);
    });

    it('marks bot as finished with no failure reason', async () => {
      callRepo.findByExternalCallId.mockResolvedValue({ id: 99 });
      participantRepo.findAllByCallId.mockResolvedValue([
        { id: 10, type: 'bot', state: 'connected' },
        { id: 20, type: 'end_user', state: 'finished' },
      ]);

      await service.onSessionClosed('room-1', 'finished');

      expect(participantRepo.updateState).toHaveBeenCalledWith(10, 'finished', expect.anything(), undefined);
    });

    it('marks bot as failed with a failure reason', async () => {
      callRepo.findByExternalCallId.mockResolvedValue({ id: 99 });
      participantRepo.findAllByCallId.mockResolvedValue([
        { id: 10, type: 'bot', state: 'connected' },
        { id: 20, type: 'end_user', state: 'finished' },
      ]);

      await service.onSessionClosed('room-1', 'failed', 'Unknown error');

      expect(participantRepo.updateState).toHaveBeenCalledWith(10, 'failed', expect.anything(), 'Unknown error');
    });

    it('marks the call and enqueues summary when all other participants are terminal', async () => {
      callRepo.findByExternalCallId.mockResolvedValue({ id: 99 });
      participantRepo.findAllByCallId.mockResolvedValue([
        { id: 10, type: 'bot', state: 'connected' },
        { id: 20, type: 'end_user', state: 'finished' },
      ]);

      await service.onSessionClosed('room-1', 'finished');

      expect(callRepo.updateState).toHaveBeenCalledWith(99, 'finished', expect.anything(), undefined);
      expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({ workflowClassName: 'SummarizeCallTranscript' }), 99);
    });

    it('does not mark the call or enqueue summary when other participants are still active', async () => {
      callRepo.findByExternalCallId.mockResolvedValue({ id: 99 });
      participantRepo.findAllByCallId.mockResolvedValue([
        { id: 10, type: 'bot', state: 'connected' },
        { id: 20, type: 'end_user', state: 'connected' },
      ]);

      await service.onSessionClosed('room-1', 'finished');

      expect(callRepo.updateState).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });

  describe('onParticipantJoined', () => {
    it('throws BadRequestError when call is not found', async () => {
      callRepo.findByExternalCallId.mockResolvedValue(null);
      await expect(service.onParticipantJoined('test-abc')).rejects.toThrow(BadRequestError);
    });

    it('throws BadRequestError when agent participant is not found', async () => {
      callRepo.findByExternalCallId.mockResolvedValue({ id: 99 });
      participantRepo.findByCallIdAndType.mockResolvedValue(null);
      await expect(service.onParticipantJoined('test-abc')).rejects.toThrow(BadRequestError);
    });

    it('updates call state and agent participant state to connected in a transaction', async () => {
      callRepo.findByExternalCallId.mockResolvedValue({ id: 99 });
      participantRepo.findByCallIdAndType.mockResolvedValue({ id: 20 });

      await service.onParticipantJoined('test-abc');

      expect(db.transaction).toHaveBeenCalledOnce();
      expect(participantRepo.findByCallIdAndType).toHaveBeenCalledWith(99, 'agent');
      expect(callRepo.updateState).toHaveBeenCalledWith(99, 'connected', expect.anything());
      expect(participantRepo.updateState).toHaveBeenCalledWith(20, 'connected', expect.anything());
      expect(transcriptRepo.create).toHaveBeenCalledWith({ callId: 99 }, expect.anything());
    });
  });

  describe('saveTranscriptEntry', () => {
    it('returns silently when call is not found', async () => {
      callRepo.findByExternalCallId.mockResolvedValue(null);
      await expect(service.saveTranscriptEntry('room-1', { role: 'user', text: 'hello', sequenceNumber: 0 })).resolves.toBeUndefined();
      expect(transcriptEntryRepo.create).not.toHaveBeenCalled();
    });

    it('returns silently when transcript is not found', async () => {
      callRepo.findByExternalCallId.mockResolvedValue({ id: 99 });
      transcriptRepo.findByCallId.mockResolvedValue(null);
      participantRepo.findAllByCallId.mockResolvedValue([]);
      await expect(service.saveTranscriptEntry('room-1', { role: 'user', text: 'hello', sequenceNumber: 0 })).resolves.toBeUndefined();
      expect(transcriptEntryRepo.create).not.toHaveBeenCalled();
    });

    it('sets botId for assistant role', async () => {
      callRepo.findByExternalCallId.mockResolvedValue({ id: 99 });
      transcriptRepo.findByCallId.mockResolvedValue({ id: 5 });
      participantRepo.findAllByCallId.mockResolvedValue([{ type: 'bot', botId: 7, endUserId: null, userId: null }]);

      await service.saveTranscriptEntry('room-1', { role: 'assistant', text: 'Hi there', sequenceNumber: 0 });

      expect(transcriptEntryRepo.create).toHaveBeenCalledWith(expect.objectContaining({ transcriptId: 5, botId: 7, text: 'Hi there', sequenceNumber: 0 }));
    });

    it('sets endUserId for user role with end_user participant', async () => {
      callRepo.findByExternalCallId.mockResolvedValue({ id: 99 });
      transcriptRepo.findByCallId.mockResolvedValue({ id: 5 });
      participantRepo.findAllByCallId.mockResolvedValue([
        { type: 'bot', botId: 7, endUserId: null, userId: null },
        { type: 'end_user', botId: null, endUserId: 15, userId: null },
      ]);

      await service.saveTranscriptEntry('room-1', { role: 'user', text: 'I need help', sequenceNumber: 1 });

      expect(transcriptEntryRepo.create).toHaveBeenCalledWith(expect.objectContaining({ endUserId: 15 }));
    });

    it('sets userId for user role with agent participant (test call)', async () => {
      callRepo.findByExternalCallId.mockResolvedValue({ id: 99 });
      transcriptRepo.findByCallId.mockResolvedValue({ id: 5 });
      participantRepo.findAllByCallId.mockResolvedValue([
        { type: 'bot', botId: 7, endUserId: null, userId: null },
        { type: 'agent', botId: null, endUserId: null, userId: 3 },
      ]);

      await service.saveTranscriptEntry('test-room', { role: 'user', text: 'Testing', sequenceNumber: 0 });

      expect(transcriptEntryRepo.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 3 }));
    });
  });
});
