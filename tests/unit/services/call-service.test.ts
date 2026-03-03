import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CallService } from '../../../src/services/call-service.js';
import { BadRequestError } from '../../../src/lib/errors.js';

describe('CallService', () => {
  let db: any;
  let callRepo: any;
  let participantRepo: any;
  let userRepo: any;
  let phoneNumberRepo: any;
  let botRepo: any;
  let livekitService: any;
  let endUserRepo: any;
  let service: CallService;

  beforeEach(() => {
    db = { transaction: vi.fn().mockImplementation(async (cb: any) => cb({})) };
    callRepo = { create: vi.fn(), findByExternalCallId: vi.fn(), updateState: vi.fn().mockResolvedValue(undefined) };
    participantRepo = { create: vi.fn(), updateState: vi.fn().mockResolvedValue(undefined), findByCallIdAndType: vi.fn() };
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
    service = new CallService(db, callRepo, participantRepo, userRepo, phoneNumberRepo, botRepo, livekitService, endUserRepo);
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
    });
  });
});
