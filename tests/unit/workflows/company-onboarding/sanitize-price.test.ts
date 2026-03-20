import { describe, it, expect } from 'vitest';
import { sanitizePrice } from '../../../../src/workflows/company-onboarding.js';

describe('sanitizePrice', () => {
  it('returns undefined for undefined input', () => {
    expect(sanitizePrice(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(sanitizePrice('')).toBeUndefined();
  });

  it('passes through a single price unchanged', () => {
    expect(sanitizePrice('25.00')).toBe('25.00');
  });

  it('extracts the first number from a price range', () => {
    expect(sanitizePrice('15.00-30.00')).toBe('15.00');
  });

  it('handles integer prices without decimals', () => {
    expect(sanitizePrice('50')).toBe('50');
  });

  it('extracts a number when prefixed with a currency symbol', () => {
    expect(sanitizePrice('$19.99')).toBe('19.99');
  });

  it('returns undefined when no number is present', () => {
    expect(sanitizePrice('free')).toBeUndefined();
  });
});
