import type { FastifyRequest, FastifyReply } from 'fastify';
import { container } from 'tsyringe';
import { AuthService } from '../services/auth-service.js';
import { UserRepository } from '../repositories/user-repository.js';
import { UnauthorizedError } from '../lib/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: number;
  }
}

/**
 * Fastify preHandler that verifies the Authorization Bearer token.
 *
 * @precondition The request must include an Authorization header with a valid Bearer JWT.
 * @postcondition request.userId is set to the authenticated user's id.
 * @throws {UnauthorizedError} If the token is missing, invalid, or the user is not found.
 */
export async function authGuard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing authorization token');
  }

  const token = header.slice(7);
  const authService = container.resolve<AuthService>('AuthService');
  const userRepo = container.resolve<UserRepository>('UserRepository');

  const decoded = authService.decodeToken(token);
  if (!decoded?.sub) throw new UnauthorizedError('Invalid token');

  const user = await userRepo.findById(Number(decoded.sub));
  if (!user) throw new UnauthorizedError('User not found');

  let payload;
  try {
    payload = authService.verifyToken(token, user.jwtPublicKey);
  } catch {
    throw new UnauthorizedError('Token expired');
  }
  if (payload.type !== 'access') throw new UnauthorizedError('Invalid token type');

  request.userId = user.id;
}
