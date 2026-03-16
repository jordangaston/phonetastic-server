import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { EmailAddressService } from '../services/email-address-service.js';
import { authGuard } from '../middleware/auth.js';

/**
 * Registers email address routes on the Fastify instance.
 *
 * @precondition The DI container must have EmailAddressService registered.
 * @postcondition Routes POST /v1/email-addresses and GET /v1/email-addresses are available.
 * @param app - The Fastify application instance.
 */
export async function emailAddressController(app: FastifyInstance): Promise<void> {
  const emailAddressService = container.resolve<EmailAddressService>('EmailAddressService');

  /**
   * Creates a Phonetastic email address for the authenticated user's company.
   *
   * @returns The created email address object.
   * @throws 400 if the user has no company.
   * @throws 409 if the company already has an email address.
   */
  app.post('/v1/email-addresses', { preHandler: [authGuard] }, async (request, reply) => {
    const emailAddress = await emailAddressService.createEmailAddress(request.userId);
    return reply.status(201).send({ email_address: formatEmailAddress(emailAddress) });
  });

  /**
   * Lists email addresses for the authenticated user's company.
   *
   * @returns An object with an email_addresses array.
   * @throws 400 if the user has no company.
   */
  app.get('/v1/email-addresses', { preHandler: [authGuard] }, async (request, reply) => {
    const addresses = await emailAddressService.listEmailAddresses(request.userId);
    return reply.send({ email_addresses: addresses.map(formatEmailAddress) });
  });
}

/**
 * Formats an email address row into the API response shape.
 *
 * @param row - The email address row.
 * @returns The formatted email address object.
 */
function formatEmailAddress(row: { id: number; companyId: number; address: string; createdAt: Date }) {
  return {
    id: row.id,
    company_id: row.companyId,
    address: row.address,
    created_at: row.createdAt,
  };
}
