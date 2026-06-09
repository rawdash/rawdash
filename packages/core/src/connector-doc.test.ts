import { describe, expect, it } from 'vitest';

import { type ConnectorDoc, defineConnectorDoc } from './connector-doc';

const valid: ConnectorDoc = {
  displayName: 'Example',
  category: 'engineering',
  tagline: 'Sync example resources.',
  brandColor: '#1A2B3C',
  vendor: {
    name: 'Example',
    domain: 'example.com',
    apiDocs: 'https://example.com/docs',
  },
  auth: { summary: 'Use an API key.', setup: ['Create a key.'] },
  rateLimit: '100 requests / minute.',
  limitations: ['Search API caps at 10,000 results.'],
};

describe('defineConnectorDoc', () => {
  it('accepts a valid doc and returns it', () => {
    expect(defineConnectorDoc(valid)).toEqual(valid);
  });

  it('rejects an unknown category', () => {
    expect(() =>
      defineConnectorDoc({ ...valid, category: 'nonsense' as never }),
    ).toThrow();
  });

  it('rejects a malformed brandColor', () => {
    expect(() => defineConnectorDoc({ ...valid, brandColor: 'red' })).toThrow();
  });

  it('requires displayName and tagline', () => {
    expect(() => defineConnectorDoc({ ...valid, tagline: '' })).toThrow();
  });
});
