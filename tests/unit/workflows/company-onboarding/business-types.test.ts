import { describe, it, expect } from 'vitest';
import { validateBusinessType, VALID_BUSINESS_TYPES } from '../../../../src/workflows/company-onboarding/business-types.js';

describe('validateBusinessType', () => {
  it('returns a valid business type unchanged', () => {
    expect(validateBusinessType('Restaurant')).toBe('Restaurant');
  });

  it('throws for a JSON object string', () => {
    expect(() => validateBusinessType('{"type": "Bakery"}')).toThrow('Invalid business type');
  });

  it('throws for an unknown category', () => {
    expect(() => validateBusinessType('UnknownCategory')).toThrow('Invalid business type');
  });

  it('throws for a lowercase variant of a valid type', () => {
    expect(() => validateBusinessType('restaurant')).toThrow('Invalid business type');
  });

  it('returns null for null input', () => {
    expect(validateBusinessType(null)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(validateBusinessType('')).toBeNull();
  });
});

describe('VALID_BUSINESS_TYPES', () => {
  it('contains expected types', () => {
    expect(VALID_BUSINESS_TYPES.has('Bakery')).toBe(true);
    expect(VALID_BUSINESS_TYPES.has('YogaStudio')).toBe(true);
  });
});
