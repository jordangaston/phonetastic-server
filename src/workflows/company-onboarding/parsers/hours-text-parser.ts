import type { OperationHourData } from './parser-utils.js';

const DAY_ORDER = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

const DAY_ABBR_TO_INT: Record<string, number> = {
  Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6,
};

function expandDayRange(range: string): string[] {
  if (!range.includes('-')) return DAY_ABBR_TO_INT[range] !== undefined ? [range] : [];
  const [start, end] = range.split('-') as [string, string];
  const startIdx = DAY_ORDER.indexOf(start as typeof DAY_ORDER[number]);
  const endIdx = DAY_ORDER.indexOf(end as typeof DAY_ORDER[number]);
  if (startIdx === -1 || endIdx === -1) return [];
  if (startIdx <= endIdx) return [...DAY_ORDER.slice(startIdx, endIdx + 1)];
  return [...DAY_ORDER.slice(startIdx), ...DAY_ORDER.slice(0, endIdx + 1)];
}

/**
 * Parses a schema.org `openingHours` text string into structured operation hour rows.
 *
 * @param text - A string like `"Mo-Fr 09:00-17:00, Sa 10:00-14:00"`. Multiple entries
 *   may be separated by commas or newlines. Day ranges (`Mo-Fr`) are expanded into
 *   individual rows. The special wrapping range `Mo-Su` produces all 7 days.
 * @returns An array of {@link OperationHourData}, one per day. Empty if no valid entries
 *   can be parsed.
 * @boundary Entries missing a valid time range (`HH:MM-HH:MM`) are silently skipped.
 */
export function parseOpeningHoursText(text: string): OperationHourData[] {
  const entries = text.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
  const result: OperationHourData[] = [];

  for (const entry of entries) {
    const match = entry.match(/^([A-Za-z-]+)\s+(\d{2}:\d{2})-(\d{2}:\d{2})$/);
    if (!match) continue;
    const [, dayPart, openTime, closeTime] = match as [string, string, string, string];

    for (const day of expandDayRange(dayPart)) {
      const dayOfWeek = DAY_ABBR_TO_INT[day];
      if (dayOfWeek === undefined) continue;
      result.push({ dayOfWeek, openTime, closeTime });
    }
  }

  return result;
}
