import { describe, expect, it } from 'vitest';

import { sanitizeAllowedUrl } from './sanitize';

describe('sanitizeAllowedUrl', () => {
  it('returns the URL when host + pathname + protocol all match', () => {
    expect(
      sanitizeAllowedUrl({
        url: 'https://api.example.com/v1/items?limit=10',
        host: 'api.example.com',
        pathname: '/v1/items',
      }),
    ).toBe('https://api.example.com/v1/items?limit=10');
  });

  it('returns null when null is passed', () => {
    expect(
      sanitizeAllowedUrl({
        url: null,
        host: 'api.example.com',
        pathname: '/v1/items',
      }),
    ).toBeNull();
  });

  it('returns null when host differs', () => {
    expect(
      sanitizeAllowedUrl({
        url: 'https://attacker.example.com/v1/items',
        host: 'api.example.com',
        pathname: '/v1/items',
      }),
    ).toBeNull();
  });

  it('returns null when pathname differs', () => {
    expect(
      sanitizeAllowedUrl({
        url: 'https://api.example.com/v1/other',
        host: 'api.example.com',
        pathname: '/v1/items',
      }),
    ).toBeNull();
  });

  it('returns null when protocol differs', () => {
    expect(
      sanitizeAllowedUrl({
        url: 'http://api.example.com/v1/items',
        host: 'api.example.com',
        pathname: '/v1/items',
      }),
    ).toBeNull();
  });

  it('accepts a custom protocol', () => {
    expect(
      sanitizeAllowedUrl({
        url: 'http://api.example.com/v1/items',
        host: 'api.example.com',
        pathname: '/v1/items',
        protocol: 'http:',
      }),
    ).toBe('http://api.example.com/v1/items');
  });

  it('returns null for malformed URLs', () => {
    expect(
      sanitizeAllowedUrl({
        url: 'not a url',
        host: 'api.example.com',
        pathname: '/v1/items',
      }),
    ).toBeNull();
  });
});
