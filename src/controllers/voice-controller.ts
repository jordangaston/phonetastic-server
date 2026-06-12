import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { VoiceRepository } from '../repositories/voice-repository.js';
import { authGuard } from '../middleware/auth.js';
import { NotFoundError } from '../lib/errors.js';
import { parsePaginationQuery, nextPageToken } from '../lib/pagination.js';

/**
 * Registers voice routes on the Fastify instance.
 *
 * @precondition The DI container must have VoiceRepository registered.
 * @postcondition Routes GET v1/voices (paginated) and GET v1/voices/:id/snippet are available.
 * @param app - The Fastify application instance.
 */
export async function voiceController(app: FastifyInstance): Promise<void> {
  const voiceRepo = container.resolve<VoiceRepository>('VoiceRepository');

  app.get<{
    Querystring: { page_token?: string; limit?: string };
  }>('/v1/voices', { preHandler: [authGuard] }, async (request, reply) => {
    const { pageToken, limit } = parsePaginationQuery(request.query);

    const rows = await voiceRepo.findAll({ pageToken, limit });

    return reply.send({ voices: rows, page_token: nextPageToken(rows) });
  });

  app.get<{ Params: { id: string } }>(
    '/v1/voices/:id/snippet',
    { preHandler: [authGuard] },
    async (request, reply) => {
      const voice = await voiceRepo.findById(Number(request.params.id));
      if (!voice) throw new NotFoundError('Voice not found');

      return reply
        .header('content-type', voice.snippetMimeType)
        .send(voice.snippet);
    },
  );
}
