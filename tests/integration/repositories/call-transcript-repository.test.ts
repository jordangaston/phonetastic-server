import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { getTestApp, getTestDb, closeTestApp } from '../../helpers/test-app.js';
import { cleanDatabase } from '../../helpers/db-cleaner.js';
import { container } from 'tsyringe';
import { CallTranscriptRepository } from '../../../src/repositories/call-transcript-repository.js';
import { companyFactory, phoneNumberFactory, callFactory } from '../../factories/index.js';

describe('CallTranscriptRepository', () => {
  let repo: CallTranscriptRepository;

  beforeAll(async () => {
    await getTestApp();
    repo = container.resolve<CallTranscriptRepository>('CallTranscriptRepository');
  });

  beforeEach(async () => {
    await cleanDatabase(getTestDb());
  });

  afterAll(async () => {
    await closeTestApp();
  });

  async function makeCall() {
    const company = await companyFactory.create();
    const phone = await phoneNumberFactory.create({ companyId: company.id });
    return callFactory.create({ companyId: company.id, fromPhoneNumberId: phone.id, toPhoneNumberId: phone.id });
  }

  describe('create', () => {
    it('inserts a transcript row and returns it', async () => {
      const call = await makeCall();
      const transcript = await repo.create({ callId: call.id });

      expect(transcript.id).toBeDefined();
      expect(transcript.callId).toBe(call.id);
      expect(transcript.summary).toBeNull();
    });
  });

  describe('findByCallId', () => {
    it('returns the transcript for the given call', async () => {
      const call = await makeCall();
      await repo.create({ callId: call.id });

      const found = await repo.findByCallId(call.id);

      expect(found).toBeDefined();
      expect(found!.callId).toBe(call.id);
    });

    it('returns undefined when no transcript exists for the call', async () => {
      const call = await makeCall();
      const found = await repo.findByCallId(call.id);

      expect(found).toBeUndefined();
    });
  });

  describe('updateSummary', () => {
    it('sets the summary on the transcript', async () => {
      const call = await makeCall();
      const transcript = await repo.create({ callId: call.id });

      await repo.updateSummary(transcript.id, 'The caller asked about hours.');

      const updated = await repo.findByCallId(call.id);
      expect(updated!.summary).toBe('The caller asked about hours.');
    });
  });
});
