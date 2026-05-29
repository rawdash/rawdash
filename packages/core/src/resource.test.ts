import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defineResources, schemasFromResources } from './resource';

describe('defineResources', () => {
  it('accepts valid definitions and returns them', () => {
    const defs = defineResources({
      thing: { shape: 'entity', description: 'A thing.' },
      usage: {
        shape: 'metric',
        description: 'Usage.',
        unit: 'count',
        granularity: 'day',
        dimensions: [{ name: 'region', description: 'Region.' }],
      },
    });
    expect(defs.thing.shape).toBe('entity');
  });

  it('rejects an invalid shape', () => {
    expect(() =>
      defineResources({
        bad: { shape: 'table' as never, description: 'x' },
      }),
    ).toThrow();
  });

  it('rejects an empty description', () => {
    expect(() =>
      defineResources({ bad: { shape: 'entity', description: '' } }),
    ).toThrow();
  });
});

describe('schemasFromResources', () => {
  it('flattens per-resource responses into a flat tag→schema map', () => {
    const a = z.object({ a: z.number() });
    const b = z.object({ b: z.string() });
    const c = z.object({ c: z.boolean() });
    const defs = defineResources({
      pull_request: {
        shape: 'entity',
        description: 'PRs assembled from two responses.',
        responses: { pull_requests: a, pull_request_reviews: b },
      },
      repo: {
        shape: 'entity',
        description: 'Repo stats.',
        responses: { repo: c },
      },
      derived: { shape: 'metric', description: 'No response schema.' },
    });
    const schemas = schemasFromResources(defs);
    expect(Object.keys(schemas).sort()).toEqual([
      'pull_request_reviews',
      'pull_requests',
      'repo',
    ]);
  });

  it('throws on a duplicate response tag across resources', () => {
    const s = z.object({});
    expect(() =>
      schemasFromResources(
        defineResources({
          one: { shape: 'entity', description: 'x', responses: { dup: s } },
          two: { shape: 'entity', description: 'y', responses: { dup: s } },
        }),
      ),
    ).toThrow(/duplicate response schema tag/i);
  });
});
