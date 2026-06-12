import {
  JSON_LD_SCRIPT_RE,
  str,
  asArray,
  type CompanyData,
} from './parser-utils.js';

type WebPageObject = Record<string, unknown>;

function isWebPage(entity: unknown): entity is WebPageObject {
  if (typeof entity !== 'object' || entity === null) return false;
  const types = asArray((entity as Record<string, unknown>)['@type']);
  return types.some((t) => t === 'WebPage');
}

function findWebPage(parsed: unknown): WebPageObject | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const found = findWebPage(item);
      if (found) return found;
    }
    return null;
  }
  const parsedEntity = parsed as Record<string, unknown>;
  if ('@graph' in parsedEntity) return findWebPage(parsedEntity['@graph']);
  return isWebPage(parsedEntity) ? parsedEntity : null;
}

/**
 * Extracts structured company data from a `WebPage` JSON-LD entity embedded in HTML.
 *
 * Finds all `<script type="application/ld+json">` blocks and returns data from the first
 * entity whose `@type` is exactly `"WebPage"`. Subtypes (e.g. AboutPage) are not matched.
 *
 * @param html - Raw HTML string of a scraped web page.
 * @returns A {@link CompanyData} object, or `null` if no WebPage entity is found.
 * @boundary Handles plain objects, arrays, and `@graph` containers in script blocks.
 * @boundary Malformed JSON blocks are silently skipped.
 * @boundary Only `name` is extracted — WebPage does not define contact or hours data.
 */
export async function parseWebPageData(html: string): Promise<CompanyData | null> {
  const scriptBlocks = [...html.matchAll(JSON_LD_SCRIPT_RE)]
    .map(([, content]) => content?.trim() ?? '')
    .filter(Boolean);

  for (const block of scriptBlocks) {
    try {
      const entity = findWebPage(JSON.parse(block));
      if (entity) {
        return {
          name: str(entity['name']),
          email: null,
          address: null,
          operationHours: [],
          phoneNumbers: [],
        };
      }
    } catch {
      // skip malformed JSON blocks
    }
  }

  return null;
}
