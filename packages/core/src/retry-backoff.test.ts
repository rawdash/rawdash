import { describe, expect, it } from 'vitest';

import { computeRetryBackoffMs, normalizeRetryAfter } from './retry-backoff';

describe('computeRetryBackoffMs', () => {
  const opts = { baseMs: 60_000, ceilingMs: 24 * 60 * 60 * 1000 };

  it('returns the base delay for the first error', () => {
    expect(computeRetryBackoffMs(1, opts)).toBe(60_000);
  });

  it('treats zero or negative counts as the base delay', () => {
    expect(computeRetryBackoffMs(0, opts)).toBe(60_000);
    expect(computeRetryBackoffMs(-5, opts)).toBe(60_000);
  });

  it('doubles the delay for each consecutive error', () => {
    expect(computeRetryBackoffMs(2, opts)).toBe(120_000);
    expect(computeRetryBackoffMs(3, opts)).toBe(240_000);
    expect(computeRetryBackoffMs(4, opts)).toBe(480_000);
  });

  it('caps the delay at the ceiling', () => {
    expect(computeRetryBackoffMs(100, opts)).toBe(opts.ceilingMs);
  });

  it('does not overflow for very large error counts', () => {
    expect(computeRetryBackoffMs(Number.MAX_SAFE_INTEGER, opts)).toBe(
      opts.ceilingMs,
    );
  });

  it('honors custom base and ceiling', () => {
    const custom = { baseMs: 1_000, ceilingMs: 10_000 };
    expect(computeRetryBackoffMs(1, custom)).toBe(1_000);
    expect(computeRetryBackoffMs(4, custom)).toBe(8_000);
    expect(computeRetryBackoffMs(5, custom)).toBe(10_000);
  });

  it('floors fractional error counts', () => {
    expect(computeRetryBackoffMs(2.9, opts)).toBe(120_000);
  });
});

describe('normalizeRetryAfter', () => {
  const now = new Date('2026-07-04T00:00:00.000Z');
  const maxSeconds = 3600;

  it('defaults to 1 second when no hint is provided', () => {
    expect(normalizeRetryAfter(undefined, now, maxSeconds)).toBe(1);
  });

  it('rounds the delay up to whole seconds', () => {
    const retryAfter = new Date(now.getTime() + 4_200);
    expect(normalizeRetryAfter(retryAfter, now, maxSeconds)).toBe(5);
  });

  it('clamps a past hint up to a minimum of 1 second', () => {
    const retryAfter = new Date(now.getTime() - 60_000);
    expect(normalizeRetryAfter(retryAfter, now, maxSeconds)).toBe(1);
  });

  it('clamps a hint above the ceiling down to maxSeconds', () => {
    const retryAfter = new Date(now.getTime() + 2 * 3600 * 1000);
    expect(normalizeRetryAfter(retryAfter, now, maxSeconds)).toBe(maxSeconds);
  });

  it('passes through a hint within bounds', () => {
    const retryAfter = new Date(now.getTime() + 90_000);
    expect(normalizeRetryAfter(retryAfter, now, maxSeconds)).toBe(90);
  });
});
