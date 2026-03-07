import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { container } from 'tsyringe';
import { CalendarRepository } from '../repositories/calendar-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import type { GoogleOAuthService } from '../services/google-oauth-service.js';
import type { GoogleCalendarClient } from '../services/google-calendar-client.js';
import { RealGoogleCalendarClient } from '../services/google-calendar-client.js';
import { authGuard } from '../middleware/auth.js';
import { BadRequestError } from '../lib/errors.js';
import { env } from '../config/env.js';

/**
 * Registers calendar OAuth routes on the Fastify instance.
 *
 * @precondition The DI container must have CalendarRepository, UserRepository, and GoogleOAuthService registered.
 * @postcondition Routes POST v1/calendars/connect and GET v1/calendars/connect/callback are available.
 * @param app - The Fastify application instance.
 */
export async function calendarController(app: FastifyInstance): Promise<void> {
  const calendarRepo = container.resolve<CalendarRepository>('CalendarRepository');
  const userRepo = container.resolve<UserRepository>('UserRepository');
  const googleOAuth = container.resolve<GoogleOAuthService>('GoogleOAuthService');

  app.post<{
    Body: { calendar: { provider: string; email: string } };
  }>('/v1/calendars/connect', { preHandler: [authGuard] }, async (request, reply) => {
    const { calendar } = request.body;
    if (calendar.provider !== 'google') throw new BadRequestError('Unsupported provider');

    const state = buildState(request.userId, calendar.email);
    const oauthUrl = googleOAuth.getAuthorizationUrl(state);

    return reply.send({ calendar: { oauth_url: oauthUrl } });
  });

  app.get<{
    Querystring: { code: string; state: string };
  }>('/v1/calendars/connect/callback', async (request, reply) => {
    const { code, state } = request.query;
    const parsed = parseState(state);
    if (!parsed) throw new BadRequestError('Invalid state');

    const user = await userRepo.findById(parsed.userId);
    if (!user?.companyId) throw new BadRequestError('User has no company');

    const tokens = await googleOAuth.exchangeCode(code);
    const calendarClient = resolveCalendarClient(tokens.accessToken);
    const metadata = await calendarClient.getCalendarMetadata(parsed.email);

    await calendarRepo.create({
      userId: parsed.userId,
      companyId: user.companyId,
      provider: 'google',
      externalId: metadata.externalId,
      name: metadata.name,
      description: metadata.description,
      email: parsed.email,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
    });

    return reply.redirect(`${env.APP_DEEPLINK_SCHEME}calendar/connected`);
  });
}

/**
 * Resolves a GoogleCalendarClient for the given access token.
 *
 * @param accessToken - A valid OAuth2 access token.
 * @returns A GoogleCalendarClient instance.
 */
function resolveCalendarClient(accessToken: string): GoogleCalendarClient {
  if (container.isRegistered('GoogleCalendarClient')) {
    return container.resolve<GoogleCalendarClient>('GoogleCalendarClient');
  }
  return new RealGoogleCalendarClient(accessToken);
}

/**
 * Builds an HMAC-signed state string encoding userId and email.
 *
 * @param userId - The authenticated user's id.
 * @param email - The calendar email.
 * @returns A base64url-encoded state string.
 */
function buildState(userId: number, email: string): string {
  const payload = `${userId}:${email}`;
  const sig = crypto.createHmac('sha256', env.APP_KEY).update(payload).digest('base64url');
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

/**
 * Parses and verifies an HMAC-signed state string.
 *
 * @param state - The base64url-encoded state string.
 * @returns The decoded userId and email, or null if invalid.
 */
function parseState(state: string): { userId: number; email: string } | null {
  const decoded = Buffer.from(state, 'base64url').toString();
  const lastColon = decoded.lastIndexOf(':');
  if (lastColon === -1) return null;

  const payload = decoded.slice(0, lastColon);
  const sig = decoded.slice(lastColon + 1);
  const expected = crypto.createHmac('sha256', env.APP_KEY).update(payload).digest('base64url');

  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  const firstColon = payload.indexOf(':');
  if (firstColon === -1) return null;

  const userId = Number(payload.slice(0, firstColon));
  const email = payload.slice(firstColon + 1);
  if (Number.isNaN(userId)) return null;

  return { userId, email };
}
