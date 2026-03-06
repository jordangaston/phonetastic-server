import { describe, it, expect } from 'vitest';
import { parseDuration } from '../../../src/lib/parse-duration.js';

describe('parseDuration', () => {
  it('parses minutes only', () => {
    expect(parseDuration('30m')).toBe(30 * 60_000);
  });

  it('parses hours only', () => {
    expect(parseDuration('2h')).toBe(2 * 60 * 60_000);
  });

  it('parses hours and minutes', () => {
    expect(parseDuration('1h30m')).toBe(90 * 60_000);
  });

  it('throws on invalid format', () => {
    expect(() => parseDuration('abc')).toThrow('Invalid duration format');
  });

  it('throws on empty string', () => {
    expect(() => parseDuration('')).toThrow('Invalid duration format');
  });
});
