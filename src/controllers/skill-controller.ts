import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { SkillService } from '../services/skill-service.js';
import { authGuard } from '../middleware/auth.js';
import { parsePaginationQuery, nextPageToken } from '../lib/pagination.js';

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
    const { pageToken, limit } = parsePaginationQuery(request.query);
    const rows = await skillService.findAll({ pageToken, limit });
    return reply.send({ skills: rows, page_token: nextPageToken(rows) });
  });

  app.post<{
    Body: {
      skill: {
        name: string;
        description: string;
        allowed_tools: string[];
      };
    };
  }>('/v1/skills', { preHandler: [authGuard] }, async (request, reply) => {
    const { name, description, allowed_tools } = request.body.skill;
    const skill = await skillService.create({
      name,
      description,
      allowedTools: allowed_tools,
    });
    return reply.code(201).send({ skill });
  });
}
