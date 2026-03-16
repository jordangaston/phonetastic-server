import { DBOS, WorkflowQueue } from '@dbos-inc/dbos-sdk';
import { container } from 'tsyringe';
import { Image } from '@boundaryml/baml';
import { b } from '../baml_client/index.js';
import type { AttachmentRepository } from '../repositories/attachment-repository.js';
import type { ChatRepository } from '../repositories/chat-repository.js';
import type { EmailRepository } from '../repositories/email-repository.js';
import type { EmailAddressRepository } from '../repositories/email-address-repository.js';
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
const PRECANNED_ERROR = 'Thank you for your email. We have received your message and a team member will follow up shortly.';

/** Return type for a single BAML agent turn step. */
interface AgentTurnResult {
  replyText: string | null;
  toolResults: string | null;
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

    const unsummarized = await ProcessInboundEmail.loadUnsummarizedAttachments(emailId);
    const emailText = await ProcessInboundEmail.loadEmailText(emailId);
    for (const att of unsummarized) {
      await ProcessInboundEmail.summarizeOneAttachment(att.id, att.storageKey, att.contentType, emailText);
    }
    const context = await ProcessInboundEmail.loadBotContext(chatId, emailId, companyId);
    if (!context) return;

    const replyText = await ProcessInboundEmail.agentLoop(context);
    await ProcessInboundEmail.sendReply(chatId, companyId, replyText);

    const emailCount = await ProcessInboundEmail.countEmails(chatId);
    if (emailCount > 2) {
      await DBOS.startWorkflow(UpdateChatSummary).run(chatId);
    }
  }

  /**
   * Sub-workflow: starts child workflows to store each attachment, then marks failures.
   * Must be a workflow (not a step) because it starts child workflows.
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
   * Step: loads pending attachment metadata from the database.
   *
   * @param emailId - The email id.
   * @returns Array of pending attachment ids and metadata.
   */
  @DBOS.step()
  static async loadPendingAttachments(emailId: number) {
    const attachmentRepo = container.resolve<AttachmentRepository>('AttachmentRepository');
    const all = await attachmentRepo.findAllByEmailId(emailId);
    return all.filter((a) => a.status === 'pending').map((a) => ({ id: a.id }));
  }

  /**
   * Step: marks an attachment as failed.
   *
   * @param attachmentId - The attachment id.
   */
  @DBOS.step()
  static async markAttachmentFailed(attachmentId: number): Promise<void> {
    const attachmentRepo = container.resolve<AttachmentRepository>('AttachmentRepository');
    await attachmentRepo.update(attachmentId, { status: 'failed' });
  }

  /**
   * Step: loads a chat by id.
   *
   * @param chatId - The chat id.
   * @returns The chat row, or undefined.
   */
  @DBOS.step()
  static async loadChat(chatId: number) {
    const chatRepo = container.resolve<ChatRepository>('ChatRepository');
    return chatRepo.findById(chatId);
  }

  /**
   * Step: counts total emails in a chat.
   *
   * @param chatId - The chat id.
   * @returns The number of emails.
   */
  @DBOS.step()
  static async countEmails(chatId: number): Promise<number> {
    const emailRepo = container.resolve<EmailRepository>('EmailRepository');
    const all = await emailRepo.findAllByChatId(chatId, { limit: 100 });
    return all.length;
  }

  /**
   * Step: loads stored attachments that need summarization.
   *
   * @param emailId - The email id.
   * @returns Array of attachment metadata eligible for summarization.
   */
  @DBOS.step()
  static async loadUnsummarizedAttachments(emailId: number) {
    const attachmentRepo = container.resolve<AttachmentRepository>('AttachmentRepository');
    const all = await attachmentRepo.findAllByEmailId(emailId);
    return all
      .filter((a) => a.status === 'stored' && !a.summary && a.storageKey)
      .filter((a) => !a.sizeBytes || a.sizeBytes <= MAX_SUMMARIZE_SIZE)
      .map((a) => ({ id: a.id, storageKey: a.storageKey!, contentType: a.contentType }));
  }

  /**
   * Step: loads the plain text body of an email.
   *
   * @param emailId - The email id.
   * @returns The email body text, or empty string.
   */
  @DBOS.step()
  static async loadEmailText(emailId: number): Promise<string> {
    const emailRepo = container.resolve<EmailRepository>('EmailRepository');
    const email = await emailRepo.findById(emailId);
    return email?.bodyText ?? '';
  }

  /**
   * Step: summarizes a single attachment using BAML multimodal.
   * Images are passed as BAML Image objects; text files as UTF-8 strings.
   *
   * @param attachmentId - The attachment id.
   * @param storageKey - The Tigris storage key.
   * @param contentType - The MIME type.
   * @param emailText - The email body for relevance context.
   */
  @DBOS.step({ retriesAllowed: true, maxAttempts: 2, intervalSeconds: 1, backoffRate: 2 })
  static async summarizeOneAttachment(attachmentId: number, storageKey: string, contentType: string, emailText: string): Promise<void> {
    const storageService = container.resolve<StorageService>('StorageService');
    const attachmentRepo = container.resolve<AttachmentRepository>('AttachmentRepository');

    try {
      const content = await storageService.getObject(storageKey);
      const summary = isImageContentType(contentType)
        ? await b.SummarizeImageAttachment(Image.fromBase64(contentType, content.toString('base64')), emailText)
        : await b.SummarizeTextAttachment(content.toString('utf-8'), emailText);
      await attachmentRepo.update(attachmentId, { summary });
    } catch {
      // Skip summarization failures — attachment is still accessible
    }
  }

  /**
   * Step: loads all context needed for the bot agent tool loop.
   *
   * @param chatId - The chat id.
   * @param emailId - The email id.
   * @param companyId - The company id.
   * @returns The bot context, or null if insufficient data.
   */
  @DBOS.step()
  static async loadBotContext(chatId: number, emailId: number, companyId: number) {
    const chatRepo = container.resolve<ChatRepository>('ChatRepository');
    const emailRepo = container.resolve<EmailRepository>('EmailRepository');
    const attachmentRepo = container.resolve<AttachmentRepository>('AttachmentRepository');
    const endUserRepo = container.resolve<EndUserRepository>('EndUserRepository');
    const companyRepo = container.resolve<CompanyRepository>('CompanyRepository');
    const emailAddressRepo = container.resolve<EmailAddressRepository>('EmailAddressRepository');

    const chat = await chatRepo.findById(chatId);
    if (!chat) return null;

    const email = await emailRepo.findById(emailId);
    if (!email) return null;

    const endUser = await endUserRepo.findById(chat.endUserId);
    const company = await companyRepo.findById(companyId);
    const emailAddress = chat.emailAddressId
      ? await emailAddressRepo.findById(chat.emailAddressId)
      : null;

    const allEmails = await emailRepo.findAllByChatId(chatId, { limit: 50 });
    const allAttachments = await attachmentRepo.findAllByEmailId(emailId);

    const conversationHistory = allEmails.map((e) => ({
      direction: e.direction,
      text: e.bodyText ?? '',
      subject: e.subject,
    }));

    const attachmentSummaries = allAttachments
      .filter((a) => a.summary)
      .map((a) => ({ filename: a.filename, summary: a.summary! }));

    return {
      chatId,
      companyId,
      companyName: company?.name ?? 'Unknown',
      fromAddress: emailAddress?.address ?? 'noreply@mail.phonetastic.ai',
      toAddress: endUser?.email ?? '',
      subject: chat.subject ?? email.subject ?? 'Re: Your inquiry',
      conversationHistory,
      attachmentSummaries,
      latestMessageId: email.messageId,
      chatSummary: chat.summary,
    };
  }

  /**
   * Child workflow: runs the agent loop via BAML EmailAgentTurn.
   * Each LLM turn is a separate step so DBOS can recover per turn.
   *
   * @param context - The bot context.
   * @returns The reply text, or a precanned error message.
   */
  @DBOS.workflow()
  static async agentLoop(context: {
    companyId: number;
    companyName: string;
    conversationHistory: { direction: string; text: string; subject: string | null }[];
    attachmentSummaries: { filename: string; summary: string }[];
    chatSummary: string | null;
  }): Promise<string> {
    let toolResults: string | null = null;

    for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
      const result = await ProcessInboundEmail.agentTurn(context, toolResults);
      if (result.replyText) return result.replyText;
      if (!result.toolResults) break;
      toolResults = result.toolResults;
    }

    return PRECANNED_ERROR;
  }

  /**
   * Step: executes a single BAML agent turn — calls EmailAgentTurn and
   * handles the tool result. Returns reply text or tool results for the next turn.
   *
   * @param context - The bot context.
   * @param toolResults - Tool results from the previous turn, or null.
   * @returns Reply text if the bot replied, or tool results to feed back.
   */
  @DBOS.step({ retriesAllowed: true, maxAttempts: 2, intervalSeconds: 2, backoffRate: 2 })
  static async agentTurn(context: {
    companyId: number;
    companyName: string;
    conversationHistory: { direction: string; text: string; subject: string | null }[];
    attachmentSummaries: { filename: string; summary: string }[];
    chatSummary: string | null;
  }, toolResults: string | null): Promise<AgentTurnResult> {
    try {
      const toolCall = await b.EmailAgentTurn(
        context.companyName,
        context.conversationHistory.map((m) => ({ direction: m.direction, text: m.text })),
        context.attachmentSummaries,
        context.chatSummary ?? undefined,
        toolResults ?? undefined,
      );

      if (toolCall.tool_name === 'reply') {
        return { replyText: toolCall.text, toolResults: null };
      }

      const searchResults = await ProcessInboundEmail.executeCompanyInfoTool(context.companyId, toolCall.query);
      return { replyText: null, toolResults: JSON.stringify(searchResults) };
    } catch {
      return { replyText: null, toolResults: null };
    }
  }

  /**
   * Executes the companyInfo tool: embeds the query and searches the FAQ vector store.
   *
   * @param companyId - The company id.
   * @param query - The search query.
   * @returns The search results or an error indicator.
   */
  static async executeCompanyInfoTool(companyId: number, query: string) {
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
    const emailAddressRepo = container.resolve<EmailAddressRepository>('EmailAddressRepository');
    const endUserRepo = container.resolve<EndUserRepository>('EndUserRepository');
    const botRepo = container.resolve<BotRepository>('BotRepository');
    const resendService = container.resolve<ResendService>('ResendService');

    const chat = await chatRepo.findById(chatId);
    if (!chat) return;

    const endUser = await endUserRepo.findById(chat.endUserId);
    if (!endUser?.email) return;

    const emailAddress = chat.emailAddressId
      ? await emailAddressRepo.findById(chat.emailAddressId)
      : null;

    const allEmails = await emailRepo.findAllByChatId(chatId, { limit: 100 });
    const latestEmail = allEmails.length > 0 ? allEmails[allEmails.length - 1] : null;

    const result = await resendService.sendEmail({
      from: emailAddress?.address ?? 'noreply@mail.phonetastic.ai',
      to: endUser.email,
      subject: chat.subject ?? 'Re: Your inquiry',
      text: replyText,
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

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);

/**
 * Checks whether a MIME type is an image type supported by BAML multimodal.
 *
 * @param contentType - The MIME type string.
 * @returns True if the content type is a supported image format.
 */
function isImageContentType(contentType: string): boolean {
  return IMAGE_TYPES.has(contentType.toLowerCase().split(';')[0].trim());
}
