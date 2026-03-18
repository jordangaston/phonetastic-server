import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { SubdomainService } from '../services/subdomain-service.js';
import { authGuard } from '../middleware/auth.js';

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
      const subdomains = await subdomainService.listSubdomains(request.userId);
      return reply.send({ subdomains: subdomains.map(formatSubdomain) });
    },
  );
}

function formatSubdomain(s: any) {
  return {
    id: s.id,
    subdomain: s.subdomain,
    resend_domain_id: s.resendDomainId,
    verified: s.verified,
    created_at: s.createdAt,
  };
}
