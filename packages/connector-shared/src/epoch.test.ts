import { describe, expect, it } from 'vitest';

import { parseEpoch } from './epoch';

describe('parseEpoch', () => {
  it('returns null for null/undefined', () => {
    expect(parseEpoch(null, 'ms')).toBeNull();
    expect(parseEpoch(undefined, 's')).toBeNull();
    expect(parseEpoch(null, 'iso')).toBeNull();
  });

  it('parses milliseconds as-is', () => {
    expect(parseEpoch(1700000000000, 'ms')).toBe(1700000000000);
    expect(parseEpoch('1700000000000', 'ms')).toBe(1700000000000);
  });

  it('multiplies seconds by 1000', () => {
    expect(parseEpoch(1700000000, 's')).toBe(1700000000000);
    expect(parseEpoch('1700000000', 's')).toBe(1700000000000);
  });

  it('parses ISO strings', () => {
    expect(parseEpoch('2023-11-14T22:13:20.000Z', 'iso')).toBe(1700000000000);
  });

  it('rejects non-string for iso', () => {
    expect(parseEpoch(1700000000, 'iso')).toBeNull();
  });

  it('rejects non-finite numbers', () => {
    expect(parseEpoch(Number.NaN, 'ms')).toBeNull();
    expect(parseEpoch(Number.POSITIVE_INFINITY, 's')).toBeNull();
    expect(parseEpoch('not-a-number', 's')).toBeNull();
  });

  it('rejects invalid ISO strings', () => {
    expect(parseEpoch('not-a-date', 'iso')).toBeNull();
  });
});
