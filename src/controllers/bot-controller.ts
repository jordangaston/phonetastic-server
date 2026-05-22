import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { BotRepository } from '../repositories/bot-repository.js';
import type { CallSettings } from '../types/call-settings.js';
import type { AppointmentSettings } from '../types/appointment-settings.js';
import type { Bot } from '../db/models.js';
import { authGuard } from '../middleware/auth.js';
import { NotFoundError } from '../lib/errors.js';

type CallSettingsInput = { call_greeting_message?: string | null; call_goodbye_message?: string | null; primary_language?: string };
type AppointmentSettingsInput = { is_enabled?: boolean; triggers?: string | null; instructions?: string | null };

/**
 * Registers bot routes on the Fastify instance.
 *
 * @precondition The DI container must have BotRepository and PhoneNumberRepository registered.
 * @postcondition Route PATCH /v1/bots/:id is available.
 * @param app - The Fastify application instance.
 */
export async function botController(app: FastifyInstance): Promise<void> {
  const botRepo = container.resolve<BotRepository>('BotRepository');

  app.patch<{
    Params: { id: string };
    Body: { bot: { call_settings?: CallSettingsInput; appointment_settings?: AppointmentSettingsInput } };
  }>('/v1/bots/:id', { preHandler: [authGuard] }, async (request, reply) => {
    const botId = Number(request.params.id);
    const existing = await botRepo.findById(botId);
    if (!existing) throw new NotFoundError('Bot not found');

    const { bot } = request.body;

    const patch = {
      ...(bot.call_settings && { callSettings: mergeCallSettings(existing.callSettings as CallSettings, bot.call_settings) }),
      ...(bot.appointment_settings && { appointmentSettings: mergeAppointmentSettings(existing.appointmentSettings as AppointmentSettings, bot.appointment_settings) }),
    };
    const updated = Object.keys(patch).length > 0 ? await botRepo.update(botId, patch) : existing;

    return reply.send({ bot: serializeBot(updated!) });
  });
}

function mergeCallSettings(existing: CallSettings, input: CallSettingsInput): CallSettings {
  return {
    ...existing,
    ...(input.call_greeting_message !== undefined && { callGreetingMessage: input.call_greeting_message }),
    ...(input.call_goodbye_message !== undefined && { callGoodbyeMessage: input.call_goodbye_message }),
    ...(input.primary_language !== undefined && { primaryLanguage: input.primary_language }),
  };
}

function mergeAppointmentSettings(existing: AppointmentSettings, input: AppointmentSettingsInput): AppointmentSettings {
  return {
    ...existing,
    ...(input.is_enabled !== undefined && { isEnabled: input.is_enabled }),
    ...(input.triggers !== undefined && { triggers: input.triggers }),
    ...(input.instructions !== undefined && { instructions: input.instructions }),
  };
}

function serializeBot(bot: Bot) {
  const callSettings = bot.callSettings as CallSettings ?? {};
  const appointmentSettings = bot.appointmentSettings as AppointmentSettings ?? {};
  return {
    id: bot.id,
    user_id: bot.userId,
    name: bot.name,
    call_settings: {
      call_greeting_message: callSettings.callGreetingMessage ?? null,
      call_goodbye_message: callSettings.callGoodbyeMessage ?? null,
      primary_language: callSettings.primaryLanguage ?? 'en',
    },
    appointment_settings: {
      is_enabled: appointmentSettings.isEnabled ?? false,
      triggers: appointmentSettings.triggers ?? null,
      instructions: appointmentSettings.instructions ?? null,
    },
  };
}
