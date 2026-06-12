import { DBOS } from '@dbos-inc/dbos-sdk';
import { container } from 'tsyringe';
import type { FirecrawlService } from '../services/firecrawl-service.js';
import { parseLocalBusinessData } from './company-onboarding/parsers/local-business-parser.js';
import { parseOrganizationData } from './company-onboarding/parsers/organization-parser.js';
import { parseWebPageData } from './company-onboarding/parsers/webpage-parser.js';
import { parseLlmData } from './company-onboarding/parsers/llm-parser.js';
import { findContactUrl } from './company-onboarding/site-map.js';
import type { CompanyData } from './company-onboarding/parsers/parser-utils.js';
import { mergeCompanyData } from './company-onboarding/parsers/parser-utils.js';
import { RETRY_CONFIG } from './workflow-config.js';

/**
 * DBOS sub-workflow that extracts company information from a website.
 * Does not persist — returns parsed data to the caller.
 */
export class ExtractCompany {
  /**
   * Extracts company data by scraping and parsing the home and contact pages.
   *
   * @precondition The DI container must have FirecrawlService and LlmService registered.
   * @postcondition No side effects — returns parsed data only.
   * @param siteUrl - The root site URL to scrape.
   * @param siteMap - Discovered site URLs; used to find a contact page if needed.
   * @returns Parsed company data, or null if nothing useful was found.
   */
  @DBOS.workflow()
  static async run(siteUrl: string, siteMap: string[]): Promise<CompanyData | null> {
    const html = await ExtractCompany.scrapeHomePage(siteUrl);
    const structured = await ExtractCompany.parseStructuredData(html);

    if (!structured) {
      return ExtractCompany.getLlmData(siteMap, html);
    }

    // Structured data found but may be missing fields.
    // Fill gaps from the LLM parser using the contact page or home page.
    const hasMissingFields =
      !structured.email ||
      !structured.address ||
      structured.operationHours.length === 0 ||
      structured.phoneNumbers.length === 0;
    if (hasMissingFields) {
      const llmData = await ExtractCompany.getLlmData(siteMap, html);
      if (llmData) {
        return mergeCompanyData(structured, llmData);
      }
    }

    return structured;
  }

  /**
   * Resolves the best HTML source (contact page or home page) and runs
   * the LLM parser on it.
   */
  private static async getLlmData(siteMap: string[], homeHtml: string): Promise<CompanyData | null> {
    const contactUrl = findContactUrl(siteMap);
    const contactHtml = contactUrl ? await ExtractCompany.scrapePage(contactUrl) : null;
    return ExtractCompany.parseLlmData(contactHtml ?? homeHtml);
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
    return firecrawl.scrapePage(siteUrl, 'html');
  }

  /**
   * Step: parses structured company data from raw HTML.
   *
   * Tries LocalBusiness, then Organization, then WebPage — returning the first match.
   *
   * @param html - Raw HTML string of the scraped page.
   * @returns Parsed company data, or null if none of the entity types are found.
   */
  @DBOS.step()
  static async parseStructuredData(html: string) {
    return (await parseLocalBusinessData(html)) ?? (await parseOrganizationData(html)) ?? (await parseWebPageData(html));
  }

  /**
   * Step: scrapes a supplementary page (e.g. contact page) and returns its raw HTML.
   *
   * @param url - The URL to scrape.
   * @returns Raw HTML string, or null if the page cannot be fetched.
   */
  @DBOS.step(RETRY_CONFIG)
  static async scrapePage(url: string): Promise<string | null> {
    try {
      const firecrawl = container.resolve<FirecrawlService>('FirecrawlService');
      return await firecrawl.scrapePage(url, 'html');
    } catch {
      return null;
    }
  }

  /**
   * Step: extracts company data from raw HTML using the LLM.
   *
   * Use as a fallback when structured JSON-LD parsing yields no results.
   *
   * @param html - Raw HTML string of the scraped page.
   * @returns Parsed company data, or null if the LLM finds nothing useful.
   */
  @DBOS.step()
  static async parseLlmData(html: string) {
    return parseLlmData(html);
  }
}
