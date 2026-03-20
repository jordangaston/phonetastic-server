import { DBOS, WorkflowQueue } from '@dbos-inc/dbos-sdk';
import { container } from 'tsyringe';
import { b } from '../baml_client/index.js';
import type { CallTranscriptRepository } from '../repositories/call-transcript-repository.js';
import type { CallTranscriptEntryRepository } from '../repositories/call-transcript-entry-repository.js';

export const summarizeCallQueue = new WorkflowQueue('summarize-call');

const RETRY_CONFIG = {
  retriesAllowed: true,
  intervalSeconds: 1,
  maxAttempts: 3,
  backoffRate: 2,
};

/**
 * DBOS workflow that generates an AI summary of a call transcript and persists it.
 */
export class SummarizeCallTranscript {
  /**
   * Orchestrates transcript summarization: fetches entries, generates summary, persists it.
   *
   * @precondition A call_transcripts row must exist for the given callId.
   * @postcondition The call_transcripts.summary column is populated with an AI-generated summary.
   * @param callId - The id of the call to summarize.
   */
  @DBOS.workflow()
  static async run(callId: number): Promise<void> {
    DBOS.logger.info({ callId }, 'SummarizeCallTranscript started');
    const entries = await SummarizeCallTranscript.fetchEntries(callId);
    if (!entries.length) return;
    DBOS.logger.debug({ callId, entryCount: entries.length }, 'Transcript entries fetched');
    const summary = await SummarizeCallTranscript.generateSummary(entries);
    await SummarizeCallTranscript.saveSummary(callId, summary);
  }

  /**
   * Step: fetches all transcript entries for a call in conversation order.
   *
   * @param callId - The call id.
   * @returns Ordered array of {role, text} pairs.
   */
  @DBOS.step()
  static async fetchEntries(callId: number): Promise<{ role: string; text: string }[]> {
    const transcriptRepo = container.resolve<CallTranscriptRepository>('CallTranscriptRepository');
    const entryRepo = container.resolve<CallTranscriptEntryRepository>('CallTranscriptEntryRepository');
    const transcript = await transcriptRepo.findByCallId(callId);
    if (!transcript) return [];
    const entries = await entryRepo.findAllByTranscriptId(transcript.id);
    return entries.map(e => ({
      role: e.botId ? 'assistant' : 'user',
      text: e.text,
    }));
  }

  /**
   * Step: calls the LLM to generate a summary from ordered transcript entries.
   *
   * @param entries - Ordered conversation entries.
   * @returns AI-generated summary string.
   */
  @DBOS.step(RETRY_CONFIG)
  static async generateSummary(entries: { role: string; text: string }[]): Promise<string> {
    const transcript = entries.map(e => `${e.role === 'assistant' ? 'Assistant' : 'Caller'}: ${e.text}`).join('\n');
    return b.SummarizeTranscript(transcript);
  }

  /**
   * Step: persists the generated summary to the call_transcripts row.
   *
   * @param callId - The call id.
   * @param summary - The AI-generated summary.
   */
  @DBOS.step()
  static async saveSummary(callId: number, summary: string): Promise<void> {
    const transcriptRepo = container.resolve<CallTranscriptRepository>('CallTranscriptRepository');
    const transcript = await transcriptRepo.findByCallId(callId);
    if (!transcript) return;
    await transcriptRepo.updateSummary(transcript.id, summary);
  }
}
