import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { CallService } from '../services/call-service.js';
import { authGuard } from '../middleware/auth.js';
import { parsePaginationQuery, nextPageToken } from '../lib/pagination.js';

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
    const { pageToken, limit } = parsePaginationQuery(request.query);
    const sort = request.query.sort === 'asc' ? 'asc' as const : 'desc' as const;
    const expand = request.query.expand?.split(',') ?? [];

    const { calls, transcripts, phoneNumbers, callerNames } = await callService.listCalls(request.userId, {
      pageToken, limit, sort, expand,
    });

    return reply.send({
      calls: calls.map((c) => formatCall(c, transcripts, phoneNumbers, callerNames)),
      page_token: nextPageToken(calls),
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

function formatCallerName(callerNames: Map<number, { firstName: string | null; lastName: string | null }> | undefined, callId: number): string | null {
  const caller = callerNames?.get(callId);
  return [caller?.firstName, caller?.lastName].filter(Boolean).join(' ') || null;
}

function formatTranscript(transcript: { id: number; summary: string | null; entries: any[] }) {
  return {
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

/**
 * Formats a call row into the API response shape.
 *
 * @param call - The call database row.
 * @param transcripts - Optional map of call id to transcript data for expansion.
 * @param phoneNumbers - Map of phone number id to E.164 string.
 * @param callerNames - Map of call id to caller's end user name.
 * @returns The formatted call object with optional nested transcript.
 */
function formatCall(
  call: { id: number; externalCallId: string; fromPhoneNumberId: number; state: string; direction: string; testMode: boolean; failureReason: string | null; createdAt: Date },
  transcripts?: Map<number, { id: number; summary: string | null; entries: any[] }>,
  phoneNumbers?: Map<number, string>,
  callerNames?: Map<number, { firstName: string | null; lastName: string | null }>,
) {
  const transcript = transcripts?.get(call.id);
  return {
    id: call.id,
    external_call_id: call.externalCallId,
    from_phone_number: phoneNumbers?.get(call.fromPhoneNumberId) ?? null,
    caller_name: formatCallerName(callerNames, call.id),
    state: call.state,
    direction: call.direction,
    test_mode: call.testMode,
    failure_reason: call.failureReason,
    created_at: call.createdAt,
    ...(transcript && { transcript: formatTranscript(transcript) }),
  };
}
