import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { SmsService } from '../services/sms-service.js';
import { authGuard } from '../middleware/auth.js';
import { parsePaginationQuery, nextPageToken } from '../lib/pagination.js';

/**
 * Registers SMS routes on the Fastify instance.
 *
 * @precondition The DI container must have SmsService registered.
 * @postcondition Routes GET v1/sms and POST v1/sms are available.
 * @param app - The Fastify application instance.
 */
export async function smsController(app: FastifyInstance): Promise<void> {
  const smsService = container.resolve<SmsService>('SmsService');

  /**
   * Lists SMS messages for the authenticated user's company.
   *
   * @param page_token - Message id to start before (exclusive). Omit for the first page.
   * @param limit - Maximum number of messages to return. Defaults to 20.
   * @returns An object with sms_messages array and page_token for the next page.
   */
  app.get<{
    Querystring: { page_token?: string; limit?: string };
  }>('/v1/sms', { preHandler: [authGuard] }, async (request, reply) => {
    const { pageToken, limit } = parsePaginationQuery(request.query);

    const messages = await smsService.listSmsMessages(request.userId, { pageToken, limit });

    return reply.send({
      sms_messages: messages.map(formatSmsMessage),
      page_token: nextPageToken(messages),
    });
  });

  /**
   * Sends an outbound SMS from the user's phone number.
   *
   * @param sms_message.to - Destination E.164 phone number.
   * @param sms_message.body - Text content of the message.
   * @returns The created SMS message record.
   */
  app.post<{
    Body: { sms_message: { to: string; body: string } };
  }>('/v1/sms', { preHandler: [authGuard] }, async (request, reply) => {
    const { to, body } = request.body.sms_message;
    const message = await smsService.sendSms(request.userId, to, body);
    return reply.status(201).send({ sms_message: formatSmsMessage(message) });
  });
}

/**
 * Formats an SMS message row into the API response shape.
 *
 * @param msg - The SMS message row.
 * @returns The formatted SMS message object.
 */
function formatSmsMessage(msg: {
  id: number;
  companyId: number;
  fromPhoneNumberId: number;
  toPhoneNumberId: number;
  body: string;
  direction: string;
  state: string;
  externalMessageSid: string | null;
  createdAt: Date;
}) {
  return {
    id: msg.id,
    company_id: msg.companyId,
    from_phone_number_id: msg.fromPhoneNumberId,
    to_phone_number_id: msg.toPhoneNumberId,
    body: msg.body,
    direction: msg.direction,
    state: msg.state,
    external_message_sid: msg.externalMessageSid,
    created_at: msg.createdAt,
  };
}
