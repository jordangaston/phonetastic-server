import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { ChatService } from '../services/chat-service.js';
import type { ResendService } from '../services/resend-service.js';
import { UnauthorizedError } from '../lib/errors.js';

/**
 * Registers Resend webhook routes on the Fastify instance.
 *
 * @precondition The DI container must have ChatService and ResendService registered.
 * @postcondition Route POST /v1/resend/webhook is available.
 * @param app - The Fastify application instance.
 */
export async function resendWebhookController(app: FastifyInstance): Promise<void> {
  const chatService = container.resolve<ChatService>('ChatService');
  const resendService = container.resolve<ResendService>('ResendService');

  /**
   * Handles inbound email events from Resend via Svix webhook.
   *
   * @remarks Verifies the Svix signature, retrieves full email content, and persists it.
   * @throws 401 if the webhook signature is invalid.
   */
  app.post<{
    Body: { type: string; data: { email_id: string; from: string; to: string[]; subject: string } };
  }>('/v1/resend/webhook', async (request, reply) => {
    const svixId = request.headers['svix-id'] as string;
    const svixTimestamp = request.headers['svix-timestamp'] as string;
    const svixSignature = request.headers['svix-signature'] as string;

    const rawBody = JSON.stringify(request.body);
    const valid = resendService.verifyWebhookSignature(rawBody, { svixId, svixTimestamp, svixSignature });
    if (!valid) throw new UnauthorizedError('Invalid webhook signature');

    if (request.body.type !== 'email.received') {
      return reply.send({});
    }

    const emailId = request.body.data.email_id;
    const emailData = await resendService.getReceivedEmail(emailId);
    await chatService.receiveInboundEmail(emailData, emailId);

    return reply.send({});
  });
}
