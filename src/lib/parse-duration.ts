/**
 * Parses a human-friendly duration string into milliseconds.
 *
 * @param duration - A string like "30m", "1h", "1h30m", or "2h15m".
 * @returns The duration in milliseconds.
 * @throws {Error} If the format is invalid.
 */
export function parseDuration(duration: string): number {
  const match = duration.match(/^(?:(\d+)h)?(?:(\d+)m)?$/);
  if (!match || (!match[1] && !match[2])) {
    throw new Error(`Invalid duration format: "${duration}". Use formats like "30m", "1h", or "1h30m".`);
  }
  const hours = parseInt(match[1] ?? '0', 10);
  const minutes = parseInt(match[2] ?? '0', 10);
  return (hours * 60 + minutes) * 60_000;
}
