import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { CallService } from '../services/call-service.js';
import { authGuard } from '../middleware/auth.js';

/**
 * Registers call routes on the Fastify instance.
 *
 * @precondition The DI container must have CallService registered.
 * @postcondition Routes GET v1/calls and POST v1/calls are available.
 * @param app - The Fastify application instance.
 */
export async function callController(app: FastifyInstance): Promise<void> {
  const callService = container.resolve<CallService>('CallService');

  /**
   * Lists calls for the authenticated user's company with cursor-based pagination.
   *
   * @param page_token - Call id to start after (exclusive). Omit for the first page.
   * @param limit - Maximum number of calls to return. Defaults to 20.
   * @param sort - Sort direction by id: 'asc' or 'desc'. Defaults to 'desc'.
   * @param expand - Comma-separated list of relations to expand (e.g. 'transcript').
   * @returns An object with calls array and page_token for the next page.
   */
  app.get<{
    Querystring: { page_token?: string; limit?: string; sort?: string; expand?: string };
  }>('/v1/calls', { preHandler: [authGuard] }, async (request, reply) => {
    const pageToken = request.query.page_token ? Number(request.query.page_token) : undefined;
    const limit = request.query.limit ? Number(request.query.limit) : undefined;
    const sort = request.query.sort === 'asc' ? 'asc' as const : 'desc' as const;
    const expand = request.query.expand?.split(',') ?? [];

    const { calls, transcripts } = await callService.listCalls(request.userId, {
      pageToken, limit, sort, expand,
    });

    const nextPageToken = calls.length > 0 ? calls[calls.length - 1].id : null;

    return reply.send({
      calls: calls.map((c) => formatCall(c, transcripts)),
      page_token: nextPageToken,
    });
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

/**
 * Formats a call row into the API response shape.
 *
 * @param call - The call database row.
 * @param transcripts - Optional map of call id to transcript data for expansion.
 * @returns The formatted call object with optional nested transcript.
 */
function formatCall(
  call: { id: number; externalCallId: string; state: string; direction: string; testMode: boolean; failureReason: string | null; createdAt: Date },
  transcripts?: Map<number, { id: number; summary: string | null; entries: any[] }>,
) {
  const formatted: any = {
    id: call.id,
    external_call_id: call.externalCallId,
    state: call.state,
    direction: call.direction,
    test_mode: call.testMode,
    failure_reason: call.failureReason,
    created_at: call.createdAt,
  };

  const transcript = transcripts?.get(call.id);
  if (transcript) {
    formatted.transcript = {
      id: transcript.id,
      summary: transcript.summary,
      entries: transcript.entries.map((e) => ({
        id: e.id,
        text: e.text,
        sequence_number: e.sequenceNumber,
        end_user_id: e.endUserId,
        bot_id: e.botId,
        user_id: e.userId,
        created_at: e.createdAt,
      })),
    };
  }

  return formatted;
}
