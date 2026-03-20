import { DBOS } from '@dbos-inc/dbos-sdk';
import { container } from 'tsyringe';
import type { Database } from '../db/index.js';
import type { FirecrawlService } from '../services/firecrawl-service.js';
import type { CompanyService } from '../services/company-service.js';
import type { ExtractedFaq, ExtractedOffering } from '../baml_client/index.js';
import { b } from '../baml_client/index.js';
import type { FaqRepository } from '../repositories/faq-repository.js';
import type { EmbeddingService } from '../services/embedding-service.js';
import type { OfferingRepository } from '../repositories/offering-repository.js';
import { stripHtml } from './company-onboarding/parsers/parser-utils.js';
import type { CompanyData } from './company-onboarding/parsers/parser-utils.js';
import { ExtractOffersAndFAQs } from './extract-offers-and-faqs.js';
import { ExtractCompany } from './extract-company.js';

const RETRY_CONFIG = {
  retriesAllowed: true,
  intervalSeconds: 1,
  maxAttempts: 3,
  backoffRate: 2,
};

/**
 * Workflow output containing the created company id.
 */
export interface OnboardingResult {
  companyId: number;
}

/**
 * Top-level DBOS workflow for company onboarding.
 * Orchestrates company extraction, business classification, and content extraction.
 */
export class CompanyOnboarding {
  /**
   * Orchestrates the full company onboarding workflow.
   *
   * @precondition The DI container must have all required services registered.
   * @postcondition A company record is created with FAQs and offerings populated.
   * @param siteUrl - The company website URL.
   * @param userId - The user initiating onboarding.
   * @returns The created company id.
   */
  @DBOS.workflow()
  static async run(siteUrl: string, userId: number): Promise<OnboardingResult> {
    const siteMap = await CompanyOnboarding.mapSite(siteUrl);
    const html = await CompanyOnboarding.scrapeHomePage(siteUrl);
    const businessType = await CompanyOnboarding.classifyBusinessType(html);
    const companyData = await ExtractCompany.run(siteUrl, siteMap);
    const { faqs, offers } = await ExtractOffersAndFAQs.run(siteMap, businessType ?? '');
    const result = await CompanyOnboarding.persist(companyData, businessType, siteUrl, userId, faqs, offers);
    await CompanyOnboarding.embedFaqs(result.companyId);
    return result;
  }

  /**
   * Step: maps the site to discover URLs.
   *
   * @param siteUrl - The root URL to map.
   * @returns Array of discovered URLs.
   */
  @DBOS.step(RETRY_CONFIG)
  static async mapSite(siteUrl: string): Promise<string[]> {
    const firecrawl = container.resolve<FirecrawlService>('FirecrawlService');
    return firecrawl.mapSite(siteUrl);
  }

  /**
   * Step: scrapes the home page HTML.
   *
   * @param siteUrl - The URL to scrape.
   * @returns Raw HTML string.
   */
  @DBOS.step(RETRY_CONFIG)
  static async scrapeHomePage(siteUrl: string): Promise<string> {
    const firecrawl = container.resolve<FirecrawlService>('FirecrawlService');
    return firecrawl.scrapePage(siteUrl, 'rawHtml');
  }

  /**
   * Step: classifies the schema.org LocalBusiness type from stripped home page HTML.
   *
   * @param html - Raw HTML of the home page.
   * @returns A schema.org LocalBusiness type name, or null if undetermined.
   */
  @DBOS.step()
  static async classifyBusinessType(html: string): Promise<string | null> {
    try {
      return await b.ClassifyBusinessType(stripHtml(html)) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Step: persists the company, FAQs, and offerings atomically in a single transaction.
   *
   * @precondition All required services must be registered in the DI container.
   * @postcondition Company, addresses, hours, phone numbers, FAQs, and offerings are committed together.
   * @param companyData - Parsed company data, or null if extraction yielded nothing.
   * @param businessType - Classified schema.org LocalBusiness type, or null.
   * @param siteUrl - The company's website URL.
   * @param userId - The user initiating onboarding.
   * @param faqs - Extracted FAQ entries; skipped if empty.
   * @param offers - Extracted offering entries; skipped if empty.
   * @returns The created company id.
   */
  @DBOS.step()
  static async persist(
    companyData: CompanyData | null,
    businessType: string | null,
    siteUrl: string,
    userId: number,
    faqs: ExtractedFaq[],
    offers: ExtractedOffering[],
  ): Promise<OnboardingResult> {
    const db = container.resolve<Database>('Database');
    const companyService = container.resolve<CompanyService>('CompanyService');
    const faqRepo = container.resolve<FaqRepository>('FaqRepository');
    const offeringRepo = container.resolve<OfferingRepository>('OfferingRepository');
    return db.transaction(async (tx) => {
      const company = await companyService.create(companyData, businessType, siteUrl, userId, tx);
      if (faqs.length) {
        await faqRepo.createMany(faqs.map((f) => ({ companyId: company.id, question: f.question, answer: f.answer })), tx);
      }
      if (offers.length) {
        await offeringRepo.createMany(
          offers.map((o) => ({
            companyId: company.id,
            type: o.type,
            name: o.name,
            description: o.description ?? undefined,
            priceAmount: sanitizePrice(o.price?.amount),
            priceCurrency: o.price?.currency,
            priceFrequency: o.price?.frequency,
          })),
          tx,
        );
      }
      return { companyId: company.id };
    });
  }

  /**
   * Step: generates vector embeddings for all FAQ questions of a company.
   *
   * @precondition FAQs must already be persisted for the given company.
   * @postcondition Each FAQ row has its embedding column populated.
   * @param companyId - The company whose FAQ embeddings to generate.
   */
  @DBOS.step(RETRY_CONFIG)
  static async embedFaqs(companyId: number): Promise<void> {
    const faqRepo = container.resolve<FaqRepository>('FaqRepository');
    const embeddingService = container.resolve<EmbeddingService>('EmbeddingService');

    const rows = await faqRepo.findByCompanyId(companyId);
    if (rows.length === 0) return;

    const questions = rows.map((r) => r.question);
    const embeddings = await embeddingService.embed(questions);

    const updates = rows.map((r, i) => ({ id: r.id, embedding: embeddings[i] }));
    await faqRepo.updateEmbeddings(updates);
  }
}

/** Extracts the first valid number from a price string (e.g. "15.00-30.00" → "15.00"). */
export function sanitizePrice(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const match = raw.match(/\d+(?:\.\d+)?/);
  return match ? match[0] : undefined;
}
