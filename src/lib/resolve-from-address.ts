const NOREPLY_ADDRESS = 'noreply@mail.phonetastic.ai';

/**
 * Resolves the from/reply-to address for an outbound email.
 * Priority: latest inbound replyTo → first company email → noreply fallback.
 *
 * @param latestInboundReplyTo - The replyTo field from the latest inbound email, if any.
 * @param companyEmails - The company's configured email addresses.
 * @returns The resolved from address.
 */
export function resolveFromAddress(latestInboundReplyTo: string | null | undefined, companyEmails: string[]): string {
  return latestInboundReplyTo ?? companyEmails[0] ?? NOREPLY_ADDRESS;
}
