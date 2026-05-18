import { describe, expect, it } from 'vitest';

import { AuthError, RateLimitError, TransientError } from './errors';
import { defaultRetryOn, parseRetryAfter } from './retry';

describe('parseRetryAfter', () => {
  it('parses numeric seconds offsets', () => {
    const now = new Date('2025-01-01T00:00:00Z');
    const result = parseRetryAfter('30', now);
    expect(result?.toISOString()).toBe('2025-01-01T00:00:30.000Z');
  });

  it('parses HTTP-date values', () => {
    const result = parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT');
    expect(result?.toISOString()).toBe('2026-10-21T07:28:00.000Z');
  });

  it('returns undefined on null or junk', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('not-a-date')).toBeUndefined();
  });
});

describe('defaultRetryOn', () => {
  it('retries 5xx', () => {
    expect(defaultRetryOn(500)).toBe(true);
    expect(defaultRetryOn(502)).toBe(true);
    expect(defaultRetryOn(503)).toBe(true);
  });

  it('retries 408 and 429', () => {
    expect(defaultRetryOn(408)).toBe(true);
    expect(defaultRetryOn(429)).toBe(true);
  });

  it('does not retry 400/401/403/404', () => {
    expect(defaultRetryOn(400)).toBe(false);
    expect(defaultRetryOn(401)).toBe(false);
    expect(defaultRetryOn(403)).toBe(false);
    expect(defaultRetryOn(404)).toBe(false);
  });

  it('retries on transient / rate-limit errors', () => {
    expect(defaultRetryOn(null, new TransientError('x'))).toBe(true);
    expect(defaultRetryOn(null, new RateLimitError('x'))).toBe(true);
  });

  it('does not retry AuthError', () => {
    expect(defaultRetryOn(401, new AuthError('x'))).toBe(false);
  });
});
