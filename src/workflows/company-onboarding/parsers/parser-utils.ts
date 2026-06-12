import type { PostalAddress } from 'schema-dts';
import { toE164 } from '../../../lib/phone.js';

/**
 * @public
 * Extracted company data from a structured JSON-LD entity.
 */
export interface CompanyData {
  name: string | null;
  email: string | null;
  address: AddressData | null;
  operationHours: OperationHourData[];
  phoneNumbers: PhoneNumberData[];
}

/**
 * @public
 * Parsed operation hour entry for a single day.
 */
export interface OperationHourData {
  /** Day of week as integer: 0 = Sunday, 6 = Saturday. */
  dayOfWeek: number;
  /** Opening time in HH:MM format. */
  openTime: string;
  /** Closing time in HH:MM format. */
  closeTime: string;
}

/**
 * @public
 * Structured address extracted from a PostalAddress or plain string.
 */
export interface AddressData {
  streetAddress: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  label: string;
}

/**
 * @public
 * A normalized phone number with its source label.
 */
export interface PhoneNumberData {
  phoneNumberE164: string;
  label: string;
}

export const JSON_LD_SCRIPT_RE = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const EMAIL_REGEX = /.+@.+\..+/;

export function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, '');
}

export function str(value: unknown): string | null {
  if (typeof value === 'string') return stripHtml(value).trim() || null;
  if (Array.isArray(value)) return str(value[0]);
  return null;
}

export function asArray<T>(value: T | readonly T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? [...(value as T[])] : [value as T];
}

/**
 * @internal
 * Extracts a string country name from a PostalAddress `addressCountry` value.
 *
 * @param addr - A PostalAddress object.
 * @returns Country string, or null if absent.
 */
export function extractCountry(addr: PostalAddress): string | null {
  const raw = asArray(addr.addressCountry)[0];
  if (!raw) return null;
  if (typeof raw === 'string') return stripHtml(raw).trim() || null;
  return str((raw as { name?: unknown }).name);
}

/**
 * @internal
 * Parses a structured or plain-string address from a JSON-LD entity.
 *
 * @param entity - Object with `address` and optional `location` fields.
 * @returns Parsed {@link AddressData}, or null if no address data found.
 */
export function parseAddress(entity: { address?: unknown; location?: unknown }): AddressData | null {
  const raw = asArray(entity.address as unknown)[0] ?? asArray(entity.location as unknown)[0];
  if (!raw) return null;

  if (typeof raw === 'string') {
    const text = stripHtml(raw).trim();
    return text ? { streetAddress: text, city: null, state: null, postalCode: null, country: null, label: 'main' } : null;
  }

  const addr = raw as PostalAddress;
  const streetAddress = str(addr.streetAddress);
  const city = str(addr.addressLocality);
  const state = str(addr.addressRegion);
  const postalCode = str(addr.postalCode);
  const country = extractCountry(addr);

  if (!streetAddress && !city && !state && !postalCode && !country) return null;
  return { streetAddress, city, state, postalCode, country, label: 'main' };
}

/**
 * @internal
 * Extracts the first valid email from top-level or contactPoint fields.
 *
 * @param entity - Object with `email` and optional `contactPoint` fields.
 * @returns Valid email string, or null if none found.
 */
export function parseEmail(entity: { email?: unknown; contactPoint?: unknown }): string | null {
  const top = str(entity.email);
  if (top && EMAIL_REGEX.test(top)) return top;

  for (const contactPoint of asArray(entity.contactPoint as unknown)) {
    const email = str((contactPoint as { email?: unknown }).email);
    if (email && EMAIL_REGEX.test(email)) return email;
  }

  return null;
}

/**
 * @internal
 * Extracts and normalizes phone numbers from top-level and contactPoint fields.
 *
 * @param entity - Object with `telephone` and optional `contactPoint` fields.
 * @returns Array of {@link PhoneNumberData} in E.164 format. Unparseable numbers are skipped.
 */
export function parsePhoneNumbers(entity: { telephone?: unknown; contactPoint?: unknown }): PhoneNumberData[] {
  const result: PhoneNumberData[] = [];

  const topPhone = str(entity.telephone);
  if (topPhone) {
    try { result.push({ phoneNumberE164: toE164(topPhone), label: 'main' }); } catch { /* skip */ }
  }

  for (const contactPoint of asArray(entity.contactPoint as unknown)) {
    const c = contactPoint as { telephone?: unknown; contactType?: unknown };
    const phone = str(c.telephone);
    if (!phone) continue;
    try {
      const label = str(c.contactType) ?? 'main';
      result.push({ phoneNumberE164: toE164(phone), label });
    } catch { /* skip */ }
  }

  return result;
}

/**
 * Merges two {@link CompanyData} objects, using `primary` as the base and
 * filling in null/empty fields from `fallback`.
 *
 * @param primary - The higher-confidence source (e.g. structured JSON-LD).
 * @param fallback - The lower-confidence source (e.g. LLM extraction).
 * @returns A merged {@link CompanyData} with gaps filled from `fallback`.
 */
export function mergeCompanyData(primary: CompanyData, fallback: CompanyData): CompanyData {
  return {
    name: primary.name || fallback.name,
    email: primary.email || fallback.email,
    address: primary.address ?? fallback.address,
    operationHours: primary.operationHours.length > 0 ? primary.operationHours : fallback.operationHours,
    phoneNumbers: primary.phoneNumbers.length > 0 ? primary.phoneNumbers : fallback.phoneNumbers,
  };
}
