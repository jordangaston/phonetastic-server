import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { CompanyRepository } from '../repositories/company-repository.js';
import { OperationHourRepository } from '../repositories/operation-hour-repository.js';
import { FaqRepository } from '../repositories/faq-repository.js';
import { OfferingRepository } from '../repositories/offering-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import { authGuard } from '../middleware/auth.js';
import { ForbiddenError, NotFoundError } from '../lib/errors.js';
import { b } from '../baml_client/index.js';
import type { Database } from '../db/index.js';
import {
  formatOperationHoursText,
  formatOfferingsText,
} from '../lib/format-company-text.js';

interface PatchCompanyBody {
  company: {
    name?: string;
    business_type?: string;
    website?: string;
    emails?: string[];
    operation_hours_text?: string;
    faqs?: Array<{ question: string; answer: string }>;
    offerings?: Array<{
      type: 'product' | 'service';
      name: string;
      description?: string;
      price_amount?: string;
      price_currency?: string;
    }>;
  };
}

/**
 * Registers company routes on the Fastify instance.
 *
 * @precondition The DI container must have all repository and Database tokens registered.
 * @postcondition Routes GET v1/companies/:id and PATCH v1/companies/:id are available.
 * PATCH requires the authenticated user to belong to the target company.
 * @param app - The Fastify application instance.
 */
export async function companyController(app: FastifyInstance): Promise<void> {
  const db = container.resolve<Database>('Database');
  const companyRepo = container.resolve<CompanyRepository>('CompanyRepository');
  const userRepo = container.resolve<UserRepository>('UserRepository');
  const hourRepo = container.resolve<OperationHourRepository>('OperationHourRepository');
  const faqRepo = container.resolve<FaqRepository>('FaqRepository');
  const offeringRepo = container.resolve<OfferingRepository>('OfferingRepository');

  app.get<{ Params: { company_id: string } }>(
    '/v1/companies/:company_id',
    { preHandler: [authGuard] },
    async (request, reply) => {
      const company = await companyRepo.findWithRelations(Number(request.params.company_id));
      if (!company) throw new NotFoundError('Company not found');

      return reply.send({ company: formatCompany(company) });
    },
  );

  app.patch<{ Params: { id: string }; Body: PatchCompanyBody }>(
    '/v1/companies/:id',
    { preHandler: [authGuard] },
    async (request, reply) => {
      const id = Number(request.params.id);
      const user = await userRepo.findById(request.userId);
      if (user?.companyId !== id) throw new ForbiddenError('Not a member of this company');

      const { company: input } = request.body;

      // Parse LLM inputs before opening the transaction to avoid holding a
      // database connection while waiting on an external API call.
      const parsedHours = input.operation_hours_text != null
        ? await b.ParseOperationHours(input.operation_hours_text)
        : null;

      await db.transaction(async (tx) => {
        await companyRepo.update(id, {
          name: input.name,
          businessType: input.business_type,
          website: input.website,
          emails: input.emails,
        }, tx);

        if (parsedHours != null) {
          await hourRepo.deleteByCompanyId(id, tx);
          if (parsedHours.length > 0) {
            await hourRepo.createMany(
              parsedHours.map((h) => ({
                companyId: id,
                dayOfWeek: h.dayOfWeek,
                openTime: h.openTime,
                closeTime: h.closeTime,
              })),
              tx,
            );
          }
        }

        if (input.faqs != null) {
          await saveFaqs(id, input.faqs, tx);
        }

        if (input.offerings != null) {
          await saveOfferings(id, input.offerings, tx);
        }
      });

      const withRelations = await companyRepo.findWithRelations(id);
      if (!withRelations) throw new NotFoundError('Company not found');

      return reply.send({ company: formatCompany(withRelations) });
    },
  );

  async function saveFaqs(
    companyId: number,
    items: Array<{ question: string; answer: string }>,
    tx: any,
  ) {
    await faqRepo.deleteByCompanyId(companyId, tx);
    if (items.length > 0) {
      await faqRepo.createMany(
        items.map((f) => ({ companyId, question: f.question, answer: f.answer })),
        tx,
      );
    }
  }

  async function saveOfferings(
    companyId: number,
    items: PatchCompanyBody['company']['offerings'] & {},
    tx: any,
  ) {
    await offeringRepo.deleteByCompanyId(companyId, tx);
    if (items.length > 0) {
      await offeringRepo.createMany(
        items.map((o) => ({
          companyId,
          type: o.type,
          name: o.name,
          description: o.description,
          priceAmount: o.price_amount,
          priceCurrency: o.price_currency,
        })),
        tx,
      );
    }
  }
}

function formatCompany(c: any) {
  return {
    id: c.id,
    name: c.name,
    business_type: c.businessType,
    website: c.website,
    emails: c.emails ?? [],
    addresses: c.addresses.map((a: any) => ({
      id: a.id,
      street_address: a.streetAddress,
      city: a.city,
      state: a.state,
      postal_code: a.postalCode,
      country: a.country,
      label: a.label,
    })),
    operation_hours: c.operationHours.map((h: any) => ({
      id: h.id,
      day_of_week: h.dayOfWeek,
      open_time: h.openTime,
      close_time: h.closeTime,
    })),
    phone_numbers: c.phoneNumbers.map((p: any) => ({
      id: p.id,
      phone_number_e164: p.phoneNumberE164,
      is_verified: p.isVerified,
      label: p.label,
    })),
    faqs: c.faqs.map((f: any) => ({
      id: f.id,
      question: f.question,
      answer: f.answer,
    })),
    offerings: c.offerings.map((o: any) => ({
      id: o.id,
      type: o.type,
      name: o.name,
      description: o.description,
      price_amount: o.priceAmount,
      price_currency: o.priceCurrency,
      price_frequency: o.priceFrequency,
    })),
    operation_hours_text: formatOperationHoursText(c.operationHours),
    offerings_text: formatOfferingsText(c.offerings),
  };
}
