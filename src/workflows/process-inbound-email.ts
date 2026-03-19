import { DBOS, WorkflowQueue } from '@dbos-inc/dbos-sdk';
import { container } from 'tsyringe';
import { randomUUID } from 'node:crypto';
import { Image } from '@boundaryml/baml';
import { b } from '../baml_client/index.js';
import type { ChatHistoryEntry } from '../baml_client/types.js';
import type { AttachmentRepository } from '../repositories/attachment-repository.js';
import type { BotToolCallRepository } from '../repositories/bot-tool-call-repository.js';
import type { ChatRepository } from '../repositories/chat-repository.js';
import type { EmailRepository } from '../repositories/email-repository.js';
import type { EndUserRepository } from '../repositories/end-user-repository.js';
import type { CompanyRepository } from '../repositories/company-repository.js';
import type { BotRepository } from '../repositories/bot-repository.js';
import type { FaqRepository } from '../repositories/faq-repository.js';
import type { EmbeddingService } from '../services/embedding-service.js';
import type { StorageService } from '../services/storage-service.js';
import type { ResendService } from '../services/resend-service.js';
import { StoreAttachment } from './store-attachment.js';
import { UpdateChatSummary } from './update-chat-summary.js';

export const processInboundEmailQueue = new WorkflowQueue('process-inbound-email');

const MAX_SUMMARIZE_SIZE = 10 * 1024 * 1024;
const MAX_AGENT_TURNS = 5;

/** Serializable attachment metadata for summarization results. */
interface AttachmentSumResult {
  id: number;
  filename: string;
  storageKey: string;
  contentType: string;
  summary: string | null;
  error: string | null;
  createdAt: Date;
}

/** Static context that does not change across agent turns. */
interface AgentContext {
  chatId: number;
  companyId: number;
  companyName: string;
  chatSummary: string | null;
}

/**
 * DBOS workflow that processes an inbound email: stores attachments,
 * summarizes them, and runs the bot agent tool loop to generate a reply.
 */
export class ProcessInboundEmail {
  /**
   * Orchestrates inbound email processing.
   *
   * @precondition Email and attachment rows must exist in the database.
   * @postcondition Attachments stored, summaries cached, bot reply sent if enabled.
   * @param chatId - The chat id.
   * @param emailId - The email id.
   * @param companyId - The company id.
   * @param externalEmailId - The Resend email ID for attachment downloads.
   */
  @DBOS.workflow()
  static async run(chatId: number, emailId: number, companyId: number, externalEmailId: string): Promise<void> {
    await ProcessInboundEmail.processAttachments(emailId, externalEmailId, companyId);

    const chat = await ProcessInboundEmail.loadChat(chatId);
    if (!chat?.botEnabled) return;

    const summaryResults = await ProcessInboundEmail.summarizeAttachments(emailId);
    const agentCtx = await ProcessInboundEmail.loadAgentContext(chatId, companyId);
    if (!agentCtx) return;

    const replyText = await ProcessInboundEmail.agentLoop(agentCtx, summaryResults);
    await ProcessInboundEmail.sendReply(chatId, companyId, replyText);

    const emailCount = await ProcessInboundEmail.countEmails(chatId);
    if (emailCount > 2) {
      await DBOS.startWorkflow(UpdateChatSummary).run(chatId);
    }
  }

  /**
   * Sub-workflow: starts child workflows to store each attachment, then marks failures.
   *
   * @param emailId - The email id.
   * @param externalEmailId - The Resend email ID.
   * @param companyId - The company id.
   */
  @DBOS.workflow()
  static async processAttachments(emailId: number, externalEmailId: string, companyId: number): Promise<void> {
    const pending = await ProcessInboundEmail.loadPendingAttachments(emailId);

    const handles = await Promise.all(
      pending.map((a) => DBOS.startWorkflow(StoreAttachment).run(a.id, externalEmailId, companyId)),
    );

    const results = await Promise.allSettled(handles);
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        await ProcessInboundEmail.markAttachmentFailed(pending[i].id);
      }
    }
  }

  /**
   * Sub-workflow: summarizes each attachment as its own step, using allSettled
   * so failures don't block other attachments. Returns results with errors
   * so the bot can communicate failures to the user.
   *
   * @param emailId - The email id.
   * @returns Array of summarization results (summary or error per attachment).
   */
  @DBOS.workflow()
  static async summarizeAttachments(emailId: number): Promise<AttachmentSumResult[]> {
    const toSummarize = await ProcessInboundEmail.loadUnsummarizedAttachments(emailId);
    const emailText = await ProcessInboundEmail.loadEmailText(emailId);

    const results = await Promise.allSettled(
      toSummarize.map((att) => ProcessInboundEmail.summarizeOneAttachment(att.id, att.storageKey, att.contentType, emailText)),
    );

    return toSummarize.map((att, i) => {
      const result = results[i];
      return {
        id: att.id,
        filename: att.filename,
        storageKey: att.storageKey,
        contentType: att.contentType,
        summary: result.status === 'fulfilled' ? result.value : null,
        error: result.status === 'rejected' ? `Summarization failed for ${att.filename}` : null,
        createdAt: att.createdAt,
      };
    });
  }

  /** Step: loads pending attachment metadata. */
  @DBOS.step()
  static async loadPendingAttachments(emailId: number) {
    const attachmentRepo = container.resolve<AttachmentRepository>('AttachmentRepository');
    const all = await attachmentRepo.findAllByEmailId(emailId);
    return all.filter((a) => a.status === 'pending').map((a) => ({ id: a.id }));
  }

  /** Step: marks an attachment as failed. */
  @DBOS.step()
  static async markAttachmentFailed(attachmentId: number): Promise<void> {
    const attachmentRepo = container.resolve<AttachmentRepository>('AttachmentRepository');
    await attachmentRepo.update(attachmentId, { status: 'failed' });
  }

  /** Step: loads a chat by id. */
  @DBOS.step()
  static async loadChat(chatId: number) {
    const chatRepo = container.resolve<ChatRepository>('ChatRepository');
    return chatRepo.findById(chatId);
  }

  /** Step: counts total emails in a chat. */
  @DBOS.step()
  static async countEmails(chatId: number): Promise<number> {
    const emailRepo = container.resolve<EmailRepository>('EmailRepository');
    const all = await emailRepo.findAllByChatId(chatId, { limit: 100 });
    return all.length;
  }

  /** Step: loads stored attachments that need summarization. */
  @DBOS.step()
  static async loadUnsummarizedAttachments(emailId: number) {
    const attachmentRepo = container.resolve<AttachmentRepository>('AttachmentRepository');
    const all = await attachmentRepo.findAllByEmailId(emailId);
    return all
      .filter((a) => a.status === 'stored' && !a.summary && a.storageKey)
      .filter((a) => !a.sizeBytes || a.sizeBytes <= MAX_SUMMARIZE_SIZE)
      .map((a) => ({ id: a.id, storageKey: a.storageKey!, contentType: a.contentType, filename: a.filename, createdAt: a.createdAt }));
  }

  /** Step: loads the plain text body of an email. */
  @DBOS.step()
  static async loadEmailText(emailId: number): Promise<string> {
    const emailRepo = container.resolve<EmailRepository>('EmailRepository');
    const email = await emailRepo.findById(emailId);
    return email?.bodyText ?? '';
  }

  /**
   * Step: summarizes a single attachment using BAML multimodal.
   * Returns the summary string on success, throws on failure.
   *
   * @param attachmentId - The attachment id.
   * @param storageKey - The Tigris storage key.
   * @param contentType - The MIME type.
   * @param emailText - The email body for relevance context.
   * @returns The summary text.
   */
  @DBOS.step({ retriesAllowed: true, maxAttempts: 2, intervalSeconds: 1, backoffRate: 2 })
  static async summarizeOneAttachment(attachmentId: number, storageKey: string, contentType: string, emailText: string): Promise<string> {
    const storageService = container.resolve<StorageService>('StorageService');
    const attachmentRepo = container.resolve<AttachmentRepository>('AttachmentRepository');

    const content = await storageService.getObject(storageKey);
    const summary = isImageContentType(contentType)
      ? await b.SummarizeImageAttachment(Image.fromBase64(contentType, content.toString('base64')), emailText)
      : await b.SummarizeTextAttachment(content.toString('utf-8'), emailText);
    await attachmentRepo.update(attachmentId, { summary });
    return summary;
  }

  /**
   * Step: loads static agent context (company name, chat summary) that
   * does not change across agent turns.
   *
   * @param chatId - The chat id.
   * @param companyId - The company id.
   * @returns The agent context, or null if insufficient data.
   */
  @DBOS.step()
  static async loadAgentContext(chatId: number, companyId: number): Promise<AgentContext | null> {
    const chatRepo = container.resolve<ChatRepository>('ChatRepository');
    const companyRepo = container.resolve<CompanyRepository>('CompanyRepository');

    const chat = await chatRepo.findById(chatId);
    if (!chat) return null;
    const company = await companyRepo.findById(companyId);

    return {
      chatId,
      companyId,
      companyName: company?.name ?? 'Unknown',
      chatSummary: chat.summary,
    };
  }

  /**
   * Child workflow: runs the agent loop via BAML EmailAgentTurn.
   * Each turn rebuilds fresh chat history from the DB (not from a stale checkpoint)
   * and is a separate step for recovery.
   *
   * @param context - The static agent context.
   * @param summaryResults - Attachment summarization results (success + failures).
   * @returns The reply text, or a precanned error message.
   */
  @DBOS.workflow()
  static async agentLoop(context: AgentContext, summaryResults: AttachmentSumResult[]): Promise<string> {
    for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
      const result = await ProcessInboundEmail.agentTurn(context, summaryResults);
      if (result.replyText) return result.replyText;
      if (result.done) break;
    }
    throw new Error('Agent loop exhausted all turns without producing a reply');
  }

  /**
   * Step: executes a single BAML agent turn. Rebuilds chat history fresh
   * from the DB on each call so it always includes tool calls from prior turns.
   *
   * @param context - The static agent context.
   * @param summaryResults - Attachment summarization results.
   * @returns Reply text if done, or done=false to continue the loop.
   */
  @DBOS.step({ retriesAllowed: true, maxAttempts: 2, intervalSeconds: 2, backoffRate: 2 })
  static async agentTurn(
    context: AgentContext,
    summaryResults: AttachmentSumResult[],
  ): Promise<{ replyText: string | null; done: boolean }> {
    const toolCallRepo = container.resolve<BotToolCallRepository>('BotToolCallRepository');
    const history = await loadChatHistory(context.chatId, summaryResults);

    const toolCall = await b.EmailAgentTurn(context.companyName, history, context.chatSummary ?? undefined);
    const toolCallId = randomUUID();

    if (toolCall.tool_name === 'reply') {
      await toolCallRepo.create({
        chatId: context.chatId, toolCallId, toolName: 'reply',
        input: { text: toolCall.text }, output: { sent: true },
      });
      return { replyText: toolCall.text, done: true };
    }

    const searchResults = await executeCompanyInfoTool(context.companyId, toolCall.query);
    await toolCallRepo.create({
      chatId: context.chatId, toolCallId, toolName: 'company_info',
      input: { query: toolCall.query }, output: searchResults,
    });

    return { replyText: null, done: false };
  }

  /**
   * Step: sends the bot's reply email via Resend and persists the outbound email.
   *
   * @param chatId - The chat id.
   * @param companyId - The company id.
   * @param replyText - The reply text to send.
   */
  @DBOS.step({ retriesAllowed: true, maxAttempts: 3, intervalSeconds: 2, backoffRate: 2 })
  static async sendReply(chatId: number, companyId: number, replyText: string): Promise<void> {
    const chatRepo = container.resolve<ChatRepository>('ChatRepository');
    const emailRepo = container.resolve<EmailRepository>('EmailRepository');
    const endUserRepo = container.resolve<EndUserRepository>('EndUserRepository');
    const botRepo = container.resolve<BotRepository>('BotRepository');
    const resendService = container.resolve<ResendService>('ResendService');

    const chat = await chatRepo.findById(chatId);
    if (!chat) return;

    const endUser = await endUserRepo.findById(chat.endUserId);
    if (!endUser?.email) return;

    const fromAddress = chat.from ?? 'noreply@phonetastic.ai';
    const allEmails = await emailRepo.findAllByChatId(chatId, { limit: 100 });
    const latestEmail = allEmails.length > 0 ? allEmails[allEmails.length - 1] : null;

    const result = await resendService.sendEmail({
      from: fromAddress,
      to: endUser.email,
      subject: chat.subject ?? 'Re: Your inquiry',
      text: replyText,
      replyTo: fromAddress,
      inReplyTo: latestEmail?.messageId ?? undefined,
      references: latestEmail?.referenceIds ?? undefined,
    });

    await emailRepo.create({
      chatId: chat.id,
      direction: 'outbound',
      botId: (await botRepo.findByUserId(chat.companyId))?.id,
      bodyText: replyText,
      status: 'sent',
      externalEmailId: result.id,
      messageId: result.messageId,
    });

    await chatRepo.update(chatId, { updatedAt: new Date() });
  }
}

/**
 * Loads fresh chat history from the DB by merging human emails, tool calls,
 * and attachment summaries chronologically. Called inside each agentTurn step
 * (not a separate DBOS step) so it always reflects the latest state.
 *
 * @param chatId - The chat id.
 * @param summaryResults - Attachment summarization results (success + failures).
 * @returns Chronologically ordered ChatHistoryEntry array.
 */
async function loadChatHistory(chatId: number, summaryResults: AttachmentSumResult[]): Promise<ChatHistoryEntry[]> {
  const emailRepo = container.resolve<EmailRepository>('EmailRepository');
  const toolCallRepo = container.resolve<BotToolCallRepository>('BotToolCallRepository');

  const allEmails = await emailRepo.findAllByChatId(chatId, { limit: 50 });
  const humanEmails = allEmails.filter((e) => e.endUserId || e.userId);
  const toolCalls = await toolCallRepo.findAllByChatId(chatId);

  return buildChatHistory(humanEmails, toolCalls, summaryResults);
}

/**
 * Builds chat history by merging human emails, tool calls, and attachment
 * summaries chronologically. End user emails labeled [Customer], owner
 * emails [Human Agent], attachment summaries [Attachment].
 * Tool calls rendered as function_call / function_call_response JSON.
 *
 * @param emails - Human-sent emails (end user + owner, no bot emails).
 * @param toolCalls - Persisted bot tool call records.
 * @param summaryResults - Attachment summarization results.
 * @returns Chronologically ordered ChatHistoryEntry array.
 */
export function buildChatHistory(
  emails: { endUserId: number | null; userId: number | null; bodyText: string | null; createdAt: Date }[],
  toolCalls: { toolCallId: string; toolName: string; input: unknown; output: unknown; createdAt: Date }[],
  summaryResults: AttachmentSumResult[] = [],
): ChatHistoryEntry[] {
  const entries: { createdAt: Date; entry: ChatHistoryEntry }[] = [];

  for (const email of emails) {
    const label = email.endUserId ? '[Customer]' : '[Human Agent]';
    entries.push({ createdAt: email.createdAt, entry: { role: 'user', label, content: email.bodyText ?? '' } });
  }

  for (const tc of toolCalls) {
    entries.push({
      createdAt: tc.createdAt,
      entry: { role: 'assistant', content: JSON.stringify({ type: 'function_call', tool_name: tc.toolName, ...tc.input as object }) },
    });
    entries.push({
      createdAt: tc.createdAt,
      entry: { role: 'user', content: JSON.stringify({ type: 'function_call_response', tool_call_id: tc.toolCallId, output: tc.output }) },
    });
  }

  for (const att of summaryResults) {
    const content = att.summary
      ? `${att.filename}: ${att.summary}`
      : `${att.filename}: ${att.error}`;
    entries.push({ createdAt: att.createdAt, entry: { role: 'user', label: '[Attachment]', content } });
  }

  entries.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return entries.map((e) => e.entry);
}

/**
 * Executes the companyInfo tool: embeds the query and searches the FAQ vector store.
 *
 * @param companyId - The company id.
 * @param query - The search query.
 * @returns The search results or an error indicator.
 */
async function executeCompanyInfoTool(companyId: number, query: string) {
  const embeddingService = container.resolve<EmbeddingService>('EmbeddingService');
  const faqRepo = container.resolve<FaqRepository>('FaqRepository');

  try {
    const [queryEmbedding] = await embeddingService.embed([query]);
    const results = await faqRepo.searchByEmbedding(companyId, queryEmbedding, 3);
    if (results.length === 0) return { found: false };
    return { found: true, results: results.map((r) => ({ question: r.question, answer: r.answer })) };
  } catch {
    return { found: false, error: 'Search unavailable' };
  }
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);

function isImageContentType(contentType: string): boolean {
  return IMAGE_TYPES.has(contentType.toLowerCase().split(';')[0].trim());
}
