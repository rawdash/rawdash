import { describe, expect, it } from 'vitest';

import { configFields } from './shopify';

describe('configFields', () => {
  it('parses a valid config with shopDomain and accessToken', () => {
    const result = configFields.safeParse({
      shopDomain: 'acme.myshopify.com',
      accessToken: { $secret: 'SHOPIFY_ACCESS_TOKEN' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a config missing accessToken', () => {
    const result = configFields.safeParse({
      shopDomain: 'acme.myshopify.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an accessToken passed as a plain string', () => {
    const result = configFields.safeParse({
      shopDomain: 'acme.myshopify.com',
      accessToken: 'shpat_plain',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a shopDomain that is not a myshopify.com domain', () => {
    const result = configFields.safeParse({
      shopDomain: 'acme.example.com',
      accessToken: { $secret: 'SHOPIFY_ACCESS_TOKEN' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a shopDomain with a protocol prefix', () => {
    const result = configFields.safeParse({
      shopDomain: 'https://acme.myshopify.com',
      accessToken: { $secret: 'SHOPIFY_ACCESS_TOKEN' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts an optional resources allowlist', () => {
    const result = configFields.safeParse({
      shopDomain: 'acme.myshopify.com',
      accessToken: { $secret: 'SHOPIFY_ACCESS_TOKEN' },
      resources: ['orders'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.resources).toEqual(['orders']);
    }
  });

  it('rejects an empty resources array', () => {
    const result = configFields.safeParse({
      shopDomain: 'acme.myshopify.com',
      accessToken: { $secret: 'SHOPIFY_ACCESS_TOKEN' },
      resources: [],
    });
    expect(result.success).toBe(false);
  });
});
