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

  // Duck-type on the `kind` discriminator rather than instanceof: the shared
  // connector-shared error classes can be bundled twice across package
  // boundaries, which would break instanceof at runtime.
  it('maps 401/403 to an auth error', () => {
    expect(mapArmError(httpError(401))).toMatchObject({ kind: 'auth' });
    expect(mapArmError(httpError(403))).toMatchObject({ kind: 'auth' });
  });

  it('maps 429 to rate_limit and 5xx to transient', () => {
    expect(mapArmError(httpError(429))).toMatchObject({ kind: 'rate_limit' });
    expect(mapArmError(httpError(503))).toMatchObject({ kind: 'transient' });
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
