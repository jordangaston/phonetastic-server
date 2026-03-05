import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { CallService } from '../services/call-service.js';
import { authGuard } from '../middleware/auth.js';

/**
 * Registers call routes on the Fastify instance.
 *
 * @precondition The DI container must have CallService registered.
 * @postcondition Routes GET v1/calls (paginated) and POST v1/calls are available.
 * @param app - The Fastify application instance.
 */
export async function callController(app: FastifyInstance): Promise<void> {
  const callService = container.resolve<CallService>('CallService');

  app.get<{
    Querystring: { page_token?: string; limit?: string; sort?: string; expand?: string };
  }>('/v1/calls', { preHandler: [authGuard] }, async (request, reply) => {
    const pageToken = request.query.page_token ? Number(request.query.page_token) : undefined;
    const limit = request.query.limit ? Number(request.query.limit) : undefined;
    const sort = request.query.sort === 'asc' ? 'asc' as const : 'desc' as const;
    const expand = request.query.expand?.split(',') ?? [];

    const result = await callService.listCalls(request.userId, {
      pageToken,
      limit,
      sort,
      expand,
    });

    return reply.send(result);
  });

  app.post<{
    Body: { call: { test_mode?: boolean } };
  }>('/v1/calls', { preHandler: [authGuard] }, async (request, reply) => {
    const { call: created, accessToken } = await callService.createCall(
      request.userId,
      { testMode: request.body.call.test_mode ?? false },
    );

    return reply.status(201).send({
      call: {
        id: created.id,
        external_call_id: created.externalCallId,
        state: created.state,
        test_mode: created.testMode,
        created_at: created.createdAt,
      },
      auth: { access_token: accessToken },
    });
  });
}
