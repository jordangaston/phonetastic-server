import { DBOS } from '@dbos-inc/dbos-sdk';
import { container } from 'tsyringe';
import { parse } from 'node-html-parser';
import type { FirecrawlService } from '../services/firecrawl-service.js';
import type { ExtractedFaq, ExtractedOffering, PageSummary } from '../baml_client/index.js';
import { b } from '../baml_client/index.js';
import { stripHtml } from './company-onboarding/parsers/parser-utils.js';

export type PageMetadata = PageSummary;

export interface OffersAndFAQs {
  faqs: ExtractedFaq[];
  offers: ExtractedOffering[];
}

const RETRY_CONFIG = { retriesAllowed: true, intervalSeconds: 10, maxAttempts: 5, backoffRate: 2 };
const BATCH_SIZE = 5;
const FETCH_TIMEOUT_MS = 5_000;

/**
 * DBOS workflow that discovers and extracts FAQs and offerings from a business website.
 */
export class ExtractOffersAndFAQs {
  /**
   * Orchestrates metadata fetching, ranking, and parallel LLM extraction.
   *
   * @precondition The DI container must have FirecrawlService registered.
   * @postcondition Returns extracted FAQs and offerings; either array may be empty.
   * @param siteMap - Ordered list of site URLs; first entry is the home page (skipped).
   * @param businessType - Classified business type used to tune search queries.
   * @returns Extracted FAQs and offerings.
   */
  @DBOS.workflow()
  static async run(siteMap: string[], businessType: string): Promise<OffersAndFAQs> {
    const urls = siteMap.slice(1, 51);
    const batches = chunk(urls, BATCH_SIZE);

    const batchSettled = await Promise.allSettled(batches.map((batch) => ExtractOffersAndFAQs.fetchPageMetadata(batch)));
    const metadata = batchSettled
      .filter((r): r is PromiseFulfilledResult<PageMetadata[]> => r.status === 'fulfilled')
      .flatMap((r) => r.value);

    const { faqUrls, offeringUrls } = await ExtractOffersAndFAQs.rankPages(metadata, businessType);

    const allExtractionResults = await Promise.allSettled([
      ...faqUrls.map((url) => ExtractOffersAndFAQs.extractFaqsFromPage(url)),
      ...offeringUrls.map((url) => ExtractOffersAndFAQs.extractOfferingsFromPage(url)),
    ]);

    const faqs = allExtractionResults
      .slice(0, faqUrls.length)
      .filter((r): r is PromiseFulfilledResult<ExtractedFaq[]> => r.status === 'fulfilled')
      .flatMap((r) => r.value);

    const offers = allExtractionResults
      .slice(faqUrls.length)
      .filter((r): r is PromiseFulfilledResult<ExtractedOffering[]> => r.status === 'fulfilled')
      .flatMap((r) => r.value);

    return ExtractOffersAndFAQs.curate(faqs, offers);
  }

  /**
   * Step: uses a high-capability model to deduplicate and quality-filter the raw extraction results.
   *
   * Removes duplicate FAQs and offerings, FAQs with no customer value, and offerings that are
   * navigation artifacts, booking actions, or implausible for the business.
   *
   * @param faqs - Raw FAQ entries from all extracted pages.
   * @param offers - Raw offering entries from all extracted pages.
   * @returns Curated FAQs and offerings ready for persistence.
   */
  @DBOS.step(RETRY_CONFIG)
  static async curate(faqs: ExtractedFaq[], offers: ExtractedOffering[]): Promise<OffersAndFAQs> {
    if (faqs.length === 0 && offers.length === 0) return { faqs: [], offers: [] };
    const curated = await b.CurateOffersAndFAQs(faqs, offers);
    return { faqs: curated.faqs, offers: curated.offerings };
  }

  /**
   * Step: fetches title and meta description for a batch of URLs using got-scraping.
   *
   * @param batch - Up to {@link BATCH_SIZE} URLs to fetch in parallel.
   * @returns Metadata for all reachable pages in the batch; failures are silently skipped.
   */
  @DBOS.step(RETRY_CONFIG)
  static async fetchPageMetadata(batch: string[]): Promise<PageMetadata[]> {
    const results = await Promise.allSettled(
      batch.map(async (url) => {
        const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!response.ok) return null;
        const root = parse(await response.text());
        const title = root.querySelector('title')?.text?.trim() ?? '';
        const description = root.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? '';
        return { url, title, description } as PageMetadata;
      }),
    );
    return results
      .filter((r): r is PromiseFulfilledResult<PageMetadata | null> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((r): r is PageMetadata => r !== null);
  }

  /**
   * Step: asks the LLM to select the best FAQ and offering pages from the candidates.
   *
   * @param candidates - Page metadata collected during the fetch phase.
   * @param businessType - The classified business type, used to guide the LLM.
   * @returns The top FAQ and offering URLs chosen by the LLM.
   */
  @DBOS.step(RETRY_CONFIG)
  static async rankPages(candidates: PageMetadata[], businessType: string): Promise<{ faqUrls: string[]; offeringUrls: string[] }> {
    if (candidates.length === 0) return { faqUrls: [], offeringUrls: [] };
    const ranked = await b.RankPages(candidates, businessType);
    return { faqUrls: ranked.faq_urls, offeringUrls: ranked.offering_urls };
  }

  /**
   * Step: scrapes a page and extracts FAQ entries using the LLM.
   *
   * @param url - The URL to scrape.
   * @returns FAQ entries found on the page; empty array if none.
   */
  @DBOS.step(RETRY_CONFIG)
  static async extractFaqsFromPage(url: string): Promise<ExtractedFaq[]> {
    const firecrawl = container.resolve<FirecrawlService>('FirecrawlService');
    const content = await firecrawl.scrapePage(url, 'rawHtml');
    return b.ExtractFAQs(stripHtml(content));
  }

  /**
   * Step: scrapes a page and extracts product/service offerings using the LLM.
   *
   * @param url - The URL to scrape.
   * @returns Offerings found on the page; empty array if none.
   */
  @DBOS.step(RETRY_CONFIG)
  static async extractOfferingsFromPage(url: string): Promise<ExtractedOffering[]> {
    const firecrawl = container.resolve<FirecrawlService>('FirecrawlService');
    const content = await firecrawl.scrapePage(url, 'rawHtml');
    return b.ExtractOfferings(stripHtml(content));
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

