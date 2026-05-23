import { describe, expect, it } from 'vitest';

import { standardRateLimitPolicy } from './rate-limit';

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe('standardRateLimitPolicy', () => {
  it('parses seconds-unit reset header', () => {
    const policy = standardRateLimitPolicy({
      remainingHeader: 'x-ratelimit-remaining',
      resetHeader: 'x-ratelimit-reset',
      resetUnit: 's',
    });
    const h = headers({
      'x-ratelimit-remaining': '4321',
      'x-ratelimit-reset': '1700000000',
    });
    const state = policy.parse(h);
    expect(state?.remaining).toBe(4321);
    expect(state?.resetAt.getTime()).toBe(1700000000 * 1000);
  });

  it('parses milliseconds-unit reset header', () => {
    const policy = standardRateLimitPolicy({
      remainingHeader: 'x-ratelimit-requests-remaining',
      resetHeader: 'x-ratelimit-requests-reset',
      resetUnit: 'ms',
    });
    const reset = Date.now() + 30_000;
    const h = headers({
      'x-ratelimit-requests-remaining': '1500',
      'x-ratelimit-requests-reset': String(reset),
    });
    const state = policy.parse(h);
    expect(state?.remaining).toBe(1500);
    expect(state?.resetAt.getTime()).toBe(reset);
  });

  it('returns null when remaining header is missing', () => {
    const policy = standardRateLimitPolicy({
      remainingHeader: 'x-ratelimit-remaining',
      resetHeader: 'x-ratelimit-reset',
      resetUnit: 's',
    });
    expect(policy.parse(headers({}))).toBeNull();
  });

  it('returns null on non-numeric values', () => {
    const policy = standardRateLimitPolicy({
      remainingHeader: 'x-ratelimit-remaining',
      resetHeader: 'x-ratelimit-reset',
      resetUnit: 's',
    });
    const h = headers({
      'x-ratelimit-remaining': 'oops',
      'x-ratelimit-reset': 'oops',
    });
    expect(policy.parse(h)).toBeNull();
  });

  it('returns null when reset header missing and no fallback provided', () => {
    const policy = standardRateLimitPolicy({
      remainingHeader: 'x-ratelimit-remaining',
      resetHeader: 'x-ratelimit-reset',
      resetUnit: 's',
    });
    expect(policy.parse(headers({ 'x-ratelimit-remaining': '5' }))).toBeNull();
  });

  it('uses resetFallbackMs when reset header missing', () => {
    const policy = standardRateLimitPolicy({
      remainingHeader: 'x-ratelimit-requests-remaining',
      resetHeader: 'x-ratelimit-requests-reset',
      resetUnit: 'ms',
      resetFallbackMs: 60_000,
    });
    const before = Date.now();
    const state = policy.parse(
      headers({ 'x-ratelimit-requests-remaining': '500' }),
    );
    expect(state?.remaining).toBe(500);
    expect(state?.resetAt.getTime()).toBeGreaterThanOrEqual(before + 59_000);
  });

  it('rejects empty and whitespace-only header values', () => {
    const policy = standardRateLimitPolicy({
      remainingHeader: 'x-ratelimit-remaining',
      resetHeader: 'x-ratelimit-reset',
      resetUnit: 's',
    });
    expect(
      policy.parse(
        headers({
          'x-ratelimit-remaining': '',
          'x-ratelimit-reset': '1700000000',
        }),
      ),
    ).toBeNull();
    expect(
      policy.parse(
        headers({
          'x-ratelimit-remaining': '   ',
          'x-ratelimit-reset': '1700000000',
        }),
      ),
    ).toBeNull();
    expect(
      policy.parse(
        headers({
          'x-ratelimit-remaining': '10',
          'x-ratelimit-reset': '',
        }),
      ),
    ).toBeNull();
  });

  it('rejects negative reset values', () => {
    const policy = standardRateLimitPolicy({
      remainingHeader: 'x-ratelimit-remaining',
      resetHeader: 'x-ratelimit-reset',
      resetUnit: 's',
    });
    const h = headers({
      'x-ratelimit-remaining': '10',
      'x-ratelimit-reset': '-5',
    });
    expect(policy.parse(h)).toBeNull();
  });
});
