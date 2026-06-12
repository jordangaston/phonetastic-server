import { parse } from 'node-html-parser';
import { b } from '../../../baml_client/index.js';
import { toE164 } from '../../../lib/phone.js';
import type { CompanyData, PhoneNumberData } from './parser-utils.js';

/**
 * Extracts structured company data from raw HTML using an LLM.
 *
 * Strips the HTML to plain text, then calls the `ParseCompanyInfo` BAML function
 * to infer contact details. Use as a last-resort fallback when structured JSON-LD
 * parsing yields no results.
 *
 * @param html - Raw HTML string of a scraped web page.
 * @returns A {@link CompanyData} object, or `null` if the LLM finds no useful data.
 * @boundary `operationHours` is always empty — use `parseOperationHours` for hours.
 * @boundary Unparseable phone numbers are silently skipped.
 */
export async function parseLlmData(html: string): Promise<CompanyData | null> {
  const text = parse(html).text;
  const companyInfo = await b.ParseCompanyInfo(text);

  if (!companyInfo.name && !companyInfo.email && !companyInfo.address && !companyInfo.phone) return null;

  const phoneNumbers: PhoneNumberData[] = [];
  if (companyInfo.phone) {
    try { phoneNumbers.push({ phoneNumberE164: toE164(companyInfo.phone), label: 'main' }); } catch { /* skip */ }
  }

  return {
    name: companyInfo.name ?? null,
    email: companyInfo.email ?? null,
    address: companyInfo.address ? {
      streetAddress: companyInfo.address.streetAddress ?? null,
      city: companyInfo.address.city ?? null,
      state: companyInfo.address.state ?? null,
      postalCode: companyInfo.address.postalCode ?? null,
      country: companyInfo.address.country ?? null,
      label: 'main',
    } : null,
    operationHours: [],
    phoneNumbers,
  };
}
