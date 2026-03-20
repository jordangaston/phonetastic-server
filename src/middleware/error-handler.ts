import type { FastifyInstance } from 'fastify';
import { AppError, RateLimitError } from '../lib/errors.js';

/**
 * Registers a global error handler on the Fastify instance.
 *
 * @precondition The Fastify instance must not yet be listening.
 * @postcondition All thrown AppErrors are serialized as JSON error responses.
 * @param app - The Fastify application instance.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof RateLimitError) {
      return reply.status(429).send({
        retry_after: error.retryAfter,
        error: { code: error.code, message: error.message },
      });
    }

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
    }

    request.log.error(error, 'Unhandled error');
    reply.status(500).send({
      error: { code: 500, message: 'Internal server error' },
    });
  });
}
