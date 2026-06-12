import type { OpeningHoursSpecification } from 'schema-dts';
import { LOCAL_BUSINESS_TYPES } from './local-business-types.js';
import { parseOpeningHoursText } from './hours-text-parser.js';
import { b } from '../../../baml_client/index.js';
import { createLogger } from '../../../lib/logger.js';

const logger = createLogger('local-business-parser');
import {
  extractScriptBlocks,
  str,
  asArray,
  parseAddress,
  parseEmail,
  parsePhoneNumbers,
  type CompanyData,
  type AddressData,
  type PhoneNumberData,
  type OperationHourData,
} from './parser-utils.js';

export type { CompanyData, AddressData, PhoneNumberData, OperationHourData };

type LocalBusinessObject = Record<string, unknown>;

const DAY_TO_INT: Record<string, number> = {
  Sunday: 0, 'https://schema.org/Sunday': 0,
  Monday: 1, 'https://schema.org/Monday': 1,
  Tuesday: 2, 'https://schema.org/Tuesday': 2,
  Wednesday: 3, 'https://schema.org/Wednesday': 3,
  Thursday: 4, 'https://schema.org/Thursday': 4,
  Friday: 5, 'https://schema.org/Friday': 5,
  Saturday: 6, 'https://schema.org/Saturday': 6,
};

function isLocalBusiness(entity: unknown): entity is LocalBusinessObject {
  if (typeof entity !== 'object' || entity === null) return false;
  const types = asArray((entity as Record<string, unknown>)['@type']);
  return types.some((t) => typeof t === 'string' && LOCAL_BUSINESS_TYPES.has(t));
}

function findLocalBusiness(parsed: unknown): LocalBusinessObject | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const found = findLocalBusiness(item);
      if (found) return found;
    }
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  if ('@graph' in obj) return findLocalBusiness(obj['@graph']);
  return isLocalBusiness(obj) ? obj : null;
}

function parseName(entity: LocalBusinessObject): string | null {
  return str(entity['name']) ?? str(entity['legalName']);
}

async function parseOperationHours(entity: LocalBusinessObject): Promise<OperationHourData[]> {
  const specs = asArray(entity['openingHoursSpecification']);
  if (specs.length > 0) {
    const result: OperationHourData[] = [];
    for (const spec of specs) {
      const s = spec as OpeningHoursSpecification;
      const opens = str(s.opens);
      const closes = str(s.closes);
      if (!opens || !closes) continue;
      for (const day of asArray(s.dayOfWeek)) {
        const dayOfWeek = DAY_TO_INT[String(day)];
        if (dayOfWeek === undefined) continue;
        result.push({ dayOfWeek, openTime: opens, closeTime: closes });
      }
    }
    return result;
  }

  const text = str(entity['openingHours']);
  if (!text) return [];

  const fromText = parseOpeningHoursText(text);
  if (fromText.length > 0) return fromText;

  try {
    return await b.ParseOperationHours(text);
  } catch (err) {
    logger.error({ err }, 'ParseOperationHours failed on all clients — returning empty hours');
    return [];
  }
}

/**
 * Extracts structured company data from the JSON-LD embedded in an HTML page.
 *
 * Finds all `<script type="application/ld+json">` blocks, parses each as compact
 * JSON-LD, and returns data from the first LocalBusiness entity found.
 *
 * @param html - Raw HTML string of a scraped web page.
 * @returns A {@link CompanyData} object, or `null` if no LocalBusiness entity is found.
 * @boundary Handles plain objects, arrays, and `@graph` containers in script blocks.
 * @boundary Malformed JSON blocks are silently skipped.
 * @boundary Returns the first LocalBusiness match only. Multi-location handling is deferred.
 */
export async function parseLocalBusinessData(html: string): Promise<CompanyData | null> {
  const scriptBlocks = extractScriptBlocks(html);

  for (const block of scriptBlocks) {
    try {
      const entity = findLocalBusiness(JSON.parse(block));
      if (entity) {
        return {
          name: parseName(entity),
          email: parseEmail(entity),
          address: parseAddress(entity),
          operationHours: await parseOperationHours(entity),
          phoneNumbers: parsePhoneNumbers(entity),
        };
      }
    } catch {
      // skip malformed JSON blocks
    }
  }

  return null;
}
