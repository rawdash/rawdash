import { describe, expect, it } from 'vitest';

import {
  githubRateLimit,
  linearRateLimit,
  sentryRateLimit,
} from './rate-limit';

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe('githubRateLimit', () => {
  it('parses x-ratelimit-* headers', () => {
    const h = headers({
      'x-ratelimit-remaining': '4321',
      'x-ratelimit-reset': '1700000000',
    });
    const state = githubRateLimit.parse(h);
    expect(state?.remaining).toBe(4321);
    expect(state?.resetAt.getTime()).toBe(1700000000 * 1000);
  });

  it('returns null when headers are missing', () => {
    expect(githubRateLimit.parse(headers({}))).toBeNull();
  });

  it('returns null on non-numeric values', () => {
    const h = headers({
      'x-ratelimit-remaining': 'oops',
      'x-ratelimit-reset': 'oops',
    });
    expect(githubRateLimit.parse(h)).toBeNull();
  });
});

describe('sentryRateLimit', () => {
  it('parses x-sentry-rate-limit-* headers', () => {
    const h = headers({
      'x-sentry-rate-limit-remaining': '99',
      'x-sentry-rate-limit-reset': '1700001234',
    });
    const state = sentryRateLimit.parse(h);
    expect(state?.remaining).toBe(99);
    expect(state?.resetAt.getTime()).toBe(1700001234 * 1000);
  });

  it('returns null when partial headers are present', () => {
    expect(
      sentryRateLimit.parse(headers({ 'x-sentry-rate-limit-remaining': '5' })),
    ).toBeNull();
  });
});

describe('linearRateLimit', () => {
  it('parses x-ratelimit-requests-* headers', () => {
    const reset = Date.now() + 30_000;
    const h = headers({
      'x-ratelimit-requests-remaining': '1500',
      'x-ratelimit-requests-reset': String(reset),
    });
    const state = linearRateLimit.parse(h);
    expect(state?.remaining).toBe(1500);
    expect(state?.resetAt.getTime()).toBe(reset);
  });

  it('falls back to a 60s reset window when no reset header is present', () => {
    const before = Date.now();
    const state = linearRateLimit.parse(
      headers({ 'x-ratelimit-requests-remaining': '500' }),
    );
    expect(state?.remaining).toBe(500);
    expect(state?.resetAt.getTime()).toBeGreaterThanOrEqual(before + 59_000);
  });
});
