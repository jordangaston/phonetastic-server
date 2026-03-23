import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { PhoneNumberService } from '../services/phone-number-service.js';
import { authGuard } from '../middleware/auth.js';

/**
 * Registers phone number routes on the Fastify instance.
 *
 * @precondition The DI container must have PhoneNumberService registered.
 * @postcondition Route POST v1/phone_numbers is available.
 * @param app - The Fastify application instance.
 */
export async function phoneNumberController(app: FastifyInstance): Promise<void> {
  const phoneNumberService = container.resolve<PhoneNumberService>('PhoneNumberService');

  app.post<{
    Body: { phone_number: { area_code?: string } };
  }>('/v1/phone_numbers', { preHandler: [authGuard] }, async (request, reply) => {
    const { phone_number } = request.body;
    const created = await phoneNumberService.purchase(request.userId!, phone_number.area_code);

    return reply.status(201).send({
      phone_number: {
        id: created.id,
        phone_number_e164: created.phoneNumberE164,
        is_verified: created.isVerified,
      },
    });
  });
}
