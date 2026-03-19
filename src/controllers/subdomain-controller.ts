import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { SubdomainService } from '../services/subdomain-service.js';
import { authGuard } from '../middleware/auth.js';
import type { subdomains } from '../db/schema/subdomains.js';

/** Row type returned by the subdomains table. */
type SubdomainRow = typeof subdomains.$inferSelect;

/**
 * Registers subdomain routes on the Fastify instance.
 *
 * @precondition The DI container must have SubdomainService registered.
 * @postcondition Routes POST v1/subdomains and GET v1/subdomains are available.
 * @param app - The Fastify application instance.
 */
export async function subdomainController(app: FastifyInstance): Promise<void> {
  const subdomainService = container.resolve<SubdomainService>('SubdomainService');

  app.post(
    '/v1/subdomains',
    { preHandler: [authGuard] },
    async (request, reply) => {
      const subdomain = await subdomainService.createSubdomain(request.userId);
      return reply.status(202).send({ subdomain: formatSubdomain(subdomain) });
    },
  );

  app.get(
    '/v1/subdomains',
    { preHandler: [authGuard] },
    async (request, reply) => {
      const { page_token, limit } = request.query as { page_token?: string; limit?: string };
      const subdomains = await subdomainService.listSubdomains(request.userId, {
        pageToken: page_token ? Number(page_token) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      const nextPageToken = subdomains.length > 0 ? subdomains[subdomains.length - 1].id : undefined;
      return reply.send({ subdomains: subdomains.map(formatSubdomain), page_token: nextPageToken });
    },
  );
}

/**
 * Formats a subdomain row for the API response.
 *
 * @param s - The subdomain database row.
 * @returns A snake_case API response object.
 */
function formatSubdomain(s: SubdomainRow) {
  return {
    id: s.id,
    subdomain: s.subdomain,
    resend_domain_id: s.resendDomainId,
    status: s.status,
    created_at: s.createdAt,
  };
}
