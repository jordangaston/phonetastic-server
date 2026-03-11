import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { BotSkillService } from '../services/bot-skill-service.js';
import { authGuard } from '../middleware/auth.js';
import { NotFoundError } from '../lib/errors.js';

/**
 * Registers bot skill routes on the Fastify instance.
 *
 * @precondition The DI container must have BotSkillService registered.
 * @postcondition Routes for managing bot skills are available.
 * @param app - The Fastify application instance.
 */
export async function botSkillController(app: FastifyInstance): Promise<void> {
  const botSkillService = container.resolve<BotSkillService>('BotSkillService');

  app.get<{
    Params: { bot_id: string };
  }>('/v1/bots/:bot_id/skills', { preHandler: [authGuard] }, async (request, reply) => {
    const botId = Number(request.params.bot_id);
    const rows = await botSkillService.findByBotId(botId);
    return reply.send({ bot_skills: rows });
  });

  app.post<{
    Params: { bot_id: string };
    Body: { bot_skill: { skill_id: number; is_enabled?: boolean } };
  }>('/v1/bots/:bot_id/skills', { preHandler: [authGuard] }, async (request, reply) => {
    const botId = Number(request.params.bot_id);
    const { skill_id, is_enabled } = request.body.bot_skill;
    const botSkill = await botSkillService.assign({
      botId,
      skillId: skill_id,
      isEnabled: is_enabled,
    });
    return reply.code(201).send({ bot_skill: botSkill });
  });

  app.patch<{
    Params: { id: string };
    Body: { bot_skill: { is_enabled: boolean } };
  }>('/v1/bot_skills/:id', { preHandler: [authGuard] }, async (request, reply) => {
    const id = Number(request.params.id);
    const { is_enabled } = request.body.bot_skill;
    const updated = await botSkillService.updateEnabled(id, is_enabled);
    if (!updated) throw new NotFoundError('Bot skill not found');
    return reply.send({ bot_skill: updated });
  });
}
