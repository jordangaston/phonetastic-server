import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { getTestApp, getTestDb, closeTestApp } from '../../helpers/test-app.js';
import { cleanDatabase } from '../../helpers/db-cleaner.js';
import { container } from 'tsyringe';
import { CallTranscriptEntryRepository } from '../../../src/repositories/call-transcript-entry-repository.js';
import { companyFactory, phoneNumberFactory, callFactory, callTranscriptFactory } from '../../factories/index.js';

describe('CallTranscriptEntryRepository', () => {
  let repo: CallTranscriptEntryRepository;

  beforeAll(async () => {
    await getTestApp();
    repo = container.resolve<CallTranscriptEntryRepository>('CallTranscriptEntryRepository');
  });

  beforeEach(async () => {
    await cleanDatabase(getTestDb());
  });

  afterAll(async () => {
    await closeTestApp();
  });

  async function makeTranscript() {
    const company = await companyFactory.create();
    const phone = await phoneNumberFactory.create({ companyId: company.id });
    const call = await callFactory.create({ companyId: company.id, fromPhoneNumberId: phone.id, toPhoneNumberId: phone.id });
    return callTranscriptFactory.create({ callId: call.id });
  }

  describe('create', () => {
    it('inserts an entry and returns it', async () => {
      const transcript = await makeTranscript();
      const entry = await repo.create({ transcriptId: transcript.id, text: 'Hello', sequenceNumber: 0 });

      expect(entry.id).toBeDefined();
      expect(entry.transcriptId).toBe(transcript.id);
      expect(entry.text).toBe('Hello');
      expect(entry.sequenceNumber).toBe(0);
    });
  });

  describe('findAllByTranscriptId', () => {
    it('returns entries ordered by sequence number', async () => {
      const transcript = await makeTranscript();
      await repo.create({ transcriptId: transcript.id, text: 'Second', sequenceNumber: 1 });
      await repo.create({ transcriptId: transcript.id, text: 'First', sequenceNumber: 0 });

      const entries = await repo.findAllByTranscriptId(transcript.id);

      expect(entries).toHaveLength(2);
      expect(entries[0].text).toBe('First');
      expect(entries[1].text).toBe('Second');
    });

    it('returns empty array when transcript has no entries', async () => {
      const transcript = await makeTranscript();
      const entries = await repo.findAllByTranscriptId(transcript.id);

      expect(entries).toEqual([]);
    });
  });
});
