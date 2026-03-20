import { DBOS, WorkflowQueue } from '@dbos-inc/dbos-sdk';
import { eq } from 'drizzle-orm';
import { container } from 'tsyringe';
import { b } from '../baml_client/index.js';
import { chats } from '../db/schema/chats.js';
import type { ChatRepository } from '../repositories/chat-repository.js';
import type { EmailRepository } from '../repositories/email-repository.js';

export const updateChatSummaryQueue = new WorkflowQueue('update-chat-summary');

const RETRY_CONFIG = {
  retriesAllowed: true,
  intervalSeconds: 1,
  maxAttempts: 3,
  backoffRate: 2,
};

/**
 * DBOS workflow that generates an AI summary of a chat's email history.
 */
export class UpdateChatSummary {
  /**
   * Orchestrates chat summarization: loads emails, generates summary, persists it.
   *
   * @precondition A chat row must exist for the given chatId.
   * @postcondition The chat.summary column is populated with an AI-generated summary.
   * @param chatId - The id of the chat to summarize.
   */
  @DBOS.workflow()
  static async run(chatId: number): Promise<void> {
    DBOS.logger.info({ chatId }, 'UpdateChatSummary started');
    const context = await UpdateChatSummary.loadContext(chatId);
    if (!context) return;
    DBOS.logger.debug({ chatId, messageCount: context.messages.length }, 'Chat context loaded');
    const summary = await UpdateChatSummary.generateSummary(context.messages, context.existingSummary);
    await UpdateChatSummary.saveSummary(chatId, summary);
  }

  /**
   * Step: loads all emails in a chat and the existing summary.
   *
   * @param chatId - The chat id.
   * @returns The email messages and existing summary, or null if chat not found.
   */
  @DBOS.step()
  static async loadContext(chatId: number) {
    const chatRepo = container.resolve<ChatRepository>('ChatRepository');
    const emailRepo = container.resolve<EmailRepository>('EmailRepository');

    const chat = await chatRepo.findById(chatId);
    if (!chat) return null;

    const emailRows = await emailRepo.findAllByChatId(chatId, { limit: 100 });
    const messages = emailRows.map((e) => ({
      direction: e.direction,
      text: e.bodyText ?? '',
    }));

    return { messages, existingSummary: chat.summary };
  }

  /**
   * Step: calls the LLM to generate a summary from email messages.
   *
   * @param messages - The email messages in chronological order.
   * @param existingSummary - The existing summary to build upon, or null.
   * @returns The generated summary string.
   */
  @DBOS.step(RETRY_CONFIG)
  static async generateSummary(
    messages: { direction: string; text: string }[],
    existingSummary: string | null,
  ): Promise<string> {
    const transcript = messages
      .map((m) => `${m.direction === 'inbound' ? 'Customer' : 'Support'}: ${m.text}`)
      .join('\n');

    return b.SummarizeChat(transcript, existingSummary);
  }

  /**
   * Transaction: persists the generated summary to the chat row.
   * Uses @DBOS.transaction to ensure workflow completion and DB write are atomic.
   *
   * @param chatId - The chat id.
   * @param summary - The generated summary.
   */
  @DBOS.transaction()
  static async saveSummary(chatId: number, summary: string): Promise<void> {
    const db = DBOS.drizzleClient as any;
    await db.update(chats).set({ summary }).where(eq(chats.id, chatId));
  }
}
