import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { SkillService } from '../services/skill-service.js';
import { authGuard } from '../middleware/auth.js';

/**
 * Registers skill routes on the Fastify instance.
 *
 * @precondition The DI container must have SkillService registered.
 * @postcondition Routes GET /v1/skills and POST /v1/skills are available.
 * @param app - The Fastify application instance.
 */
export async function skillController(app: FastifyInstance): Promise<void> {
  const skillService = container.resolve<SkillService>('SkillService');

  app.get<{
    Querystring: { page_token?: string; limit?: string };
  }>('/v1/skills', { preHandler: [authGuard] }, async (request, reply) => {
    const pageToken = request.query.page_token ? Number(request.query.page_token) : undefined;
    const limit = request.query.limit ? Number(request.query.limit) : undefined;
    const rows = await skillService.findAll({ pageToken, limit });
    const nextPageToken = rows.length > 0 ? rows[rows.length - 1].id : null;
    return reply.send({ skills: rows, page_token: nextPageToken });
  });

  app.post<{
    Body: {
      skill: {
        name: string;
        allowed_tools: string[];
        description: string;
        instructions: string;
      };
    };
  }>('/v1/skills', { preHandler: [authGuard] }, async (request, reply) => {
    const { name, allowed_tools, description, instructions } = request.body.skill;
    const skill = await skillService.create({
      name,
      allowedTools: allowed_tools,
      description,
      instructions,
    });
    return reply.code(201).send({ skill });
  });
}
