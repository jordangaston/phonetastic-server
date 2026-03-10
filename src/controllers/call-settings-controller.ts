import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { CallSettingsRepository } from '../repositories/call-settings-repository.js';
import { authGuard } from '../middleware/auth.js';
import { NotFoundError } from '../lib/errors.js';

/**
 * Registers call settings routes on the Fastify instance.
 *
 * @precondition The DI container must have CallSettingsRepository registered.
 * @postcondition Route PATCH v1/call_settings is available.
 * @param app - The Fastify application instance.
 */
export async function callSettingsController(app: FastifyInstance): Promise<void> {
  const callSettingsRepo = container.resolve<CallSettingsRepository>('CallSettingsRepository');

  app.patch<{
    Body: {
      call_settings: {
        forwarded_phone_number_id?: number;
        company_phone_number_id?: number;
        is_bot_enabled?: boolean;
        rings_before_bot_answer?: number;
        answer_calls_from?: string;
      };
    };
  }>('/v1/call_settings', { preHandler: [authGuard] }, async (request, reply) => {
    const existing = await callSettingsRepo.findByUserId(request.userId);
    if (!existing) throw new NotFoundError('Call settings not found');

    const { call_settings } = request.body;
    const updated = await callSettingsRepo.update(existing.id, {
      forwardedPhoneNumberId: call_settings.forwarded_phone_number_id,
      companyPhoneNumberId: call_settings.company_phone_number_id,
      isBotEnabled: call_settings.is_bot_enabled,
      ringsBeforeBotAnswer: call_settings.rings_before_bot_answer,
      answerCallsFrom: call_settings.answer_calls_from as any,
    });

    return reply.send({
      call_settings: formatCallSettings(updated!),
    });
  });
}

/**
 * Formats a call settings row to the API response shape.
 *
 * @param cs - The call settings row from the database.
 * @returns A snake_case representation of the call settings.
 */
export function formatCallSettings(cs: any) {
  return {
    id: cs.id,
    forwarded_phone_number_id: cs.forwardedPhoneNumberId,
    company_phone_number_id: cs.companyPhoneNumberId,
    is_bot_enabled: cs.isBotEnabled,
    rings_before_bot_answer: cs.ringsBeforeBotAnswer,
    answer_calls_from: cs.answerCallsFrom,
  };
}
