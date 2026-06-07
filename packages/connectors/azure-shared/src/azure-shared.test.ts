import {
  AuthError,
  RateLimitError,
  TransientError,
} from '@rawdash/connector-shared';
import { describe, expect, it } from 'vitest';

import { isAllowedArmUrl, mapArmError } from './arm';
import { isTokenFresh } from './auth';

describe('isAllowedArmUrl', () => {
  it('accepts https management.azure.com URLs', () => {
    expect(
      isAllowedArmUrl(
        'https://management.azure.com/subscriptions/sub-1/providers/Microsoft.CostManagement/query?api-version=2024-08-01',
      ),
    ).toBe(true);
  });

  it('rejects other hosts, non-https, and garbage', () => {
    expect(isAllowedArmUrl('https://evil.example.com/exfil')).toBe(false);
    expect(isAllowedArmUrl('http://management.azure.com/x')).toBe(false);
    expect(isAllowedArmUrl('not-a-url')).toBe(false);
  });
});

describe('mapArmError', () => {
  const httpError = (status: number): Error & { kind: string } =>
    Object.assign(new Error(`status ${status}`), {
      kind: 'transient',
      response: { status },
    });

  it('maps 401/403 to AuthError', () => {
    expect(mapArmError(httpError(401))).toBeInstanceOf(AuthError);
    expect(mapArmError(httpError(403))).toBeInstanceOf(AuthError);
  });

  it('maps 429 to RateLimitError and 5xx to TransientError', () => {
    expect(mapArmError(httpError(429))).toBeInstanceOf(RateLimitError);
    expect(mapArmError(httpError(503))).toBeInstanceOf(TransientError);
  });

  it('passes through non-HTTP errors unchanged', () => {
    const plain = new Error('boom');
    expect(mapArmError(plain)).toBe(plain);
  });
});

describe('isTokenFresh', () => {
  it('is false for a null cache', () => {
    expect(isTokenFresh(null, 1_000)).toBe(false);
  });

  it('is true before expiry and false after', () => {
    const cache = { token: 't', expiresAt: 5_000 };
    expect(isTokenFresh(cache, 4_999)).toBe(true);
    expect(isTokenFresh(cache, 5_000)).toBe(false);
  });
});
