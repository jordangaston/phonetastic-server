import {
  JSON_LD_SCRIPT_RE,
  extractString,
  asArray,
  parseAddress,
  parseEmail,
  parsePhoneNumbers,
  type CompanyData,
} from './parser-utils.js';

type OrganizationObject = Record<string, unknown>;

function isOrganization(entity: unknown): entity is OrganizationObject {
  if (typeof entity !== 'object' || entity === null) return false;
  const types = asArray((entity as Record<string, unknown>)['@type']);
  return types.some((t) => t === 'Organization');
}

function findOrganization(parsed: unknown): OrganizationObject | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const found = findOrganization(item);
      if (found) return found;
    }
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  if ('@graph' in obj) return findOrganization(obj['@graph']);
  return isOrganization(obj) ? obj : null;
}

function parseName(entity: OrganizationObject): string | null {
  return extractString(entity['legalName']) ?? extractString(entity['name']);
}

/**
 * Extracts structured company data from an `Organization` JSON-LD entity embedded in HTML.
 *
 * Finds all `<script type="application/ld+json">` blocks and returns data from the first
 * entity whose `@type` is exactly `"Organization"`. Subtypes (e.g. LocalBusiness) are
 * not matched.
 *
 * @param html - Raw HTML string of a scraped web page.
 * @returns A {@link CompanyData} object, or `null` if no Organization entity is found.
 * @boundary Handles plain objects, arrays, and `@graph` containers in script blocks.
 * @boundary Malformed JSON blocks are silently skipped.
 * @boundary `operationHours` is always empty — Organization does not define opening hours.
 */
export async function parseOrganizationData(html: string): Promise<CompanyData | null> {
  const scriptBlocks = [...html.matchAll(JSON_LD_SCRIPT_RE)]
    .map(([, content]) => content?.trim() ?? '')
    .filter(Boolean);

  for (const block of scriptBlocks) {
    try {
      const entity = findOrganization(JSON.parse(block));
      if (entity) {
        return {
          name: parseName(entity),
          email: parseEmail(entity),
          address: parseAddress(entity),
          operationHours: [],
          phoneNumbers: parsePhoneNumbers(entity),
        };
      }
    } catch {
      // skip malformed JSON blocks
    }
  }

  return null;
}
