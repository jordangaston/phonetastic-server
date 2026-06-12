import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { BotRepository } from '../repositories/bot-repository.js';
import type { CallSettings } from '../types/call-settings.js';
import { authGuard } from '../middleware/auth.js';
import { NotFoundError } from '../lib/errors.js';

/**
 * Registers bot settings routes on the Fastify instance.
 *
 * @precondition The DI container must have BotRepository registered.
 * @postcondition Route PATCH v1/bot_settings is available.
 * @param app - The Fastify application instance.
 */
export async function botSettingsController(app: FastifyInstance): Promise<void> {
  const botRepo = container.resolve<BotRepository>('BotRepository');

  app.patch<{
    Body: { bot_settings: { voice_id?: number; primary_language?: string; call_greeting_message?: string; call_goodbye_message?: string } };
  }>('/v1/bot_settings', { preHandler: [authGuard] }, async (request, reply) => {
    const bot = await botRepo.findByUserId(request.userId);
    if (!bot) throw new NotFoundError('Bot settings not found');

    const { bot_settings } = request.body;
    const callSettings: CallSettings = {
      ...bot.callSettings as CallSettings,
      ...(bot_settings.primary_language !== undefined && { primaryLanguage: bot_settings.primary_language }),
      ...(bot_settings.call_greeting_message !== undefined && { callGreetingMessage: bot_settings.call_greeting_message }),
      ...(bot_settings.call_goodbye_message !== undefined && { callGoodbyeMessage: bot_settings.call_goodbye_message }),
    };

    const updated = await botRepo.update(bot.id, {
      ...(bot_settings.voice_id !== undefined && { voiceId: bot_settings.voice_id }),
      callSettings,
    });
    if (!updated) throw new NotFoundError('Bot not found after update');

    const updatedCallSettings = updated.callSettings as CallSettings;
    return reply.send({
      bot_settings: {
        call_greeting_message: updatedCallSettings.callGreetingMessage ?? null,
        call_goodbye_message: updatedCallSettings.callGoodbyeMessage ?? null,
        voice_id: updated.voiceId,
        primary_language: updatedCallSettings.primaryLanguage ?? 'en',
      },
    });
  });
}
