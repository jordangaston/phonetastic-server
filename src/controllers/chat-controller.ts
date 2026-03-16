import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { ChatService } from '../services/chat-service.js';
import { authGuard } from '../middleware/auth.js';
import type { ChatChannel } from '../db/schema/enums.js';

/**
 * Registers chat routes on the Fastify instance.
 *
 * @precondition The DI container must have ChatService registered.
 * @postcondition Routes GET /v1/chats, PATCH /v1/chats/:id, and GET /v1/chats/:id/emails are available.
 * @param app - The Fastify application instance.
 */
export async function chatController(app: FastifyInstance): Promise<void> {
  const chatService = container.resolve<ChatService>('ChatService');

  /**
   * Lists chats for the authenticated user's company.
   *
   * @param channel - Optional channel filter (e.g. 'email').
   * @param page_token - Chat id cursor for pagination.
   * @param limit - Maximum number of chats to return. Defaults to 20.
   * @returns An object with chats array and page_token.
   */
  app.get<{
    Querystring: { channel?: string; page_token?: string; limit?: string };
  }>('/v1/chats', { preHandler: [authGuard] }, async (request, reply) => {
    const channel = request.query.channel as ChatChannel | undefined;
    const pageToken = request.query.page_token ? Number(request.query.page_token) : undefined;
    const limit = request.query.limit ? Number(request.query.limit) : undefined;

    const chats = await chatService.listChats(request.userId, { channel, pageToken, limit });
    const nextPageToken = chats.length > 0 ? chats[chats.length - 1].id : null;

    return reply.send({ chats: chats.map(formatChat), page_token: nextPageToken });
  });

  /**
   * Updates a chat (toggle bot_enabled).
   *
   * @param id - The chat id.
   * @param chat.bot_enabled - The new bot_enabled value.
   * @returns The updated chat object.
   * @throws 404 if the chat is not found.
   */
  app.patch<{
    Params: { id: string };
    Body: { chat: { bot_enabled: boolean } };
  }>('/v1/chats/:id', { preHandler: [authGuard] }, async (request, reply) => {
    const chatId = Number(request.params.id);
    const chat = await chatService.toggleBot(request.userId, chatId, request.body.chat.bot_enabled);
    return reply.send({ chat: formatChat(chat!) });
  });

  /**
   * Lists emails in a chat with attachment metadata.
   *
   * @param id - The chat id.
   * @param page_token - Email id cursor for pagination.
   * @param limit - Maximum number of emails to return. Defaults to 20.
   * @returns An object with emails array and page_token.
   * @throws 404 if the chat is not found.
   */
  app.get<{
    Params: { id: string };
    Querystring: { page_token?: string; limit?: string };
  }>('/v1/chats/:id/emails', { preHandler: [authGuard] }, async (request, reply) => {
    const chatId = Number(request.params.id);
    const pageToken = request.query.page_token ? Number(request.query.page_token) : undefined;
    const limit = request.query.limit ? Number(request.query.limit) : undefined;

    const emailRows = await chatService.listEmails(request.userId, chatId, { pageToken, limit });
    const nextPageToken = emailRows.length > 0 ? emailRows[emailRows.length - 1].id : null;

    return reply.send({ emails: emailRows.map(formatEmail), page_token: nextPageToken });
  });

  /**
   * Sends an owner reply in a chat. Persists with status 'pending' and disables bot.
   *
   * @param id - The chat id.
   * @param email.body_text - The reply text content.
   * @param email.attachments - Optional array of {filename, content_type, content} objects.
   * @returns The created email with status 'pending'.
   * @throws 404 if the chat is not found.
   */
  app.post<{
    Params: { id: string };
    Body: {
      email: {
        body_text: string;
        attachments?: { filename: string; content_type: string; content: string }[];
      };
    };
  }>('/v1/chats/:id/emails', { preHandler: [authGuard] }, async (request, reply) => {
    const chatId = Number(request.params.id);
    const { body_text, attachments } = request.body.email;

    const attachmentData = attachments?.map((a) => ({
      filename: a.filename,
      contentType: a.content_type,
      content: a.content,
    }));

    const email = await chatService.sendOwnerReply(request.userId, chatId, body_text, attachmentData);
    return reply.status(202).send({ email: formatEmail(email) });
  });
}

/**
 * Formats a chat row into the API response shape.
 *
 * @param chat - The chat row.
 * @returns The formatted chat object.
 */
function formatChat(chat: {
  id: number;
  companyId: number;
  endUserId: number;
  channel: string;
  status: string;
  botEnabled: boolean;
  subject: string | null;
  summary: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: chat.id,
    company_id: chat.companyId,
    end_user_id: chat.endUserId,
    channel: chat.channel,
    status: chat.status,
    bot_enabled: chat.botEnabled,
    subject: chat.subject,
    summary: chat.summary,
    created_at: chat.createdAt,
    updated_at: chat.updatedAt,
  };
}

/**
 * Formats an email row with attachments into the API response shape.
 *
 * @param email - The email row with nested attachments.
 * @returns The formatted email object.
 */
function formatEmail(email: {
  id: number;
  chatId: number;
  direction: string;
  status: string;
  endUserId: number | null;
  botId: number | null;
  userId: number | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  createdAt: Date;
  attachments: { id: number; filename: string; contentType: string; sizeBytes: number | null }[];
}) {
  return {
    id: email.id,
    chat_id: email.chatId,
    direction: email.direction,
    status: email.status,
    end_user_id: email.endUserId,
    bot_id: email.botId,
    user_id: email.userId,
    subject: email.subject,
    body_text: email.bodyText,
    body_html: email.bodyHtml,
    attachments: email.attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      content_type: a.contentType,
      size_bytes: a.sizeBytes,
    })),
    created_at: email.createdAt,
  };
}
