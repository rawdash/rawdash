import type { Entity, MetricSample } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ProductHuntConnector,
  configFields,
  postToEntity,
  postToMetricSample,
} from './product-hunt';

const TOKEN = 'PRODUCT_HUNT_API_TOKEN' as unknown as { $secret: string };

describe('configFields', () => {
  it('parses a config with only apiToken', () => {
    const result = configFields.safeParse({ apiToken: { $secret: 'PH' } });
    expect(result.success).toBe(true);
  });

  it('rejects a config missing apiToken', () => {
    expect(configFields.safeParse({}).success).toBe(false);
  });

  it('rejects an apiToken passed as a plain string', () => {
    expect(configFields.safeParse({ apiToken: 'plain' }).success).toBe(false);
  });

  it('accepts optional slugs, topic, lookbackDays, and resources', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'PH' },
      slugs: ['rawdash'],
      topic: 'developer-tools',
      lookbackDays: 7,
      resources: ['post_metrics'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slugs).toEqual(['rawdash']);
      expect(result.data.resources).toEqual(['post_metrics']);
    }
  });

  it('rejects duplicate slugs', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'PH' },
      slugs: ['rawdash', 'rawdash'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty slugs array', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'PH' },
      slugs: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown resource', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'PH' },
      resources: ['nope'],
    });
    expect(result.success).toBe(false);
  });
});

function makeStorage() {
  return {
    event: vi.fn().mockResolvedValue(undefined),
    entity: vi.fn().mockResolvedValue(undefined),
    metric: vi.fn().mockResolvedValue(undefined),
    edge: vi.fn().mockResolvedValue(undefined),
    distribution: vi.fn().mockResolvedValue(undefined),
    events: vi.fn().mockResolvedValue(undefined),
    entities: vi.fn().mockResolvedValue(undefined),
    metrics: vi.fn().mockResolvedValue(undefined),
    edges: vi.fn().mockResolvedValue(undefined),
    distributions: vi.fn().mockResolvedValue(undefined),
    queryEvents: vi.fn().mockResolvedValue([]),
    getEntity: vi.fn().mockResolvedValue(null),
    queryEntities: vi.fn().mockResolvedValue([]),
    queryMetrics: vi.fn().mockResolvedValue([]),
    traverse: vi.fn().mockResolvedValue([]),
    queryDistributions: vi.fn().mockResolvedValue([]),
    deleteOlderThan: vi.fn().mockResolvedValue({ rowsDeleted: 0 }),
  };
}

interface GraphQLCall {
  query: string;
  variables: Record<string, unknown>;
}

function mockGraphql(
  responseFor: (call: GraphQLCall) => Record<string, unknown>,
): { spy: ReturnType<typeof vi.fn>; calls: GraphQLCall[] } {
  const calls: GraphQLCall[] = [];
  const spy = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
    const parsed = JSON.parse(init.body as string) as GraphQLCall;
    calls.push(parsed);
    const body = JSON.stringify({ data: responseFor(parsed) });
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(body),
    } as Response);
  });
  return { spy, calls };
}

function operationName(query: string): string {
  return query.match(/query\s+(\w+)/)?.[1] ?? '';
}

function emptyPostsPage() {
  return { posts: { nodes: [], pageInfo: { hasNextPage: false } } };
}

function samplePost(overrides: Record<string, unknown> = {}) {
  return {
    id: '4242',
    name: 'Rawdash',
    slug: 'rawdash',
    tagline: 'Dashboards as code',
    description: 'Config-driven dashboards.',
    votesCount: 312,
    commentsCount: 24,
    reviewsCount: 3,
    reviewsRating: 4.5,
    dailyRank: 2,
    weeklyRank: 9,
    createdAt: '2026-07-20T07:01:00Z',
    featuredAt: '2026-07-20T07:05:00Z',
    url: 'https://www.producthunt.com/posts/rawdash',
    website: 'https://rawdash.dev',
    topics: {
      nodes: [{ id: '1', name: 'Developer Tools', slug: 'dev-tools' }],
    },
    ...overrides,
  };
}

describe('postToEntity', () => {
  it('maps a post onto the entity shape with epoch timestamps', () => {
    const entity = postToEntity(samplePost() as never);
    expect(entity.type).toBe('product_hunt_post');
    expect(entity.id).toBe('4242');
    expect(entity.attributes.slug).toBe('rawdash');
    expect(entity.attributes.votesCount).toBe(312);
    expect(entity.attributes.topics).toEqual(['Developer Tools']);
    expect(entity.attributes.createdAt).toBe(
      Date.parse('2026-07-20T07:01:00Z'),
    );
    expect(entity.updated_at).toBe(Date.parse('2026-07-20T07:05:00Z'));
  });

  it('falls back to createdAt when the post was never featured', () => {
    const entity = postToEntity(
      samplePost({ featuredAt: null, dailyRank: null }) as never,
    );
    expect(entity.attributes.featuredAt).toBeNull();
    expect(entity.attributes.dailyRank).toBeNull();
    expect(entity.updated_at).toBe(Date.parse('2026-07-20T07:01:00Z'));
  });

  it('defaults missing counters to zero', () => {
    const entity = postToEntity(
      samplePost({ votesCount: null, commentsCount: undefined }) as never,
    );
    expect(entity.attributes.votesCount).toBe(0);
    expect(entity.attributes.commentsCount).toBe(0);
  });
});

describe('postToMetricSample', () => {
  it('buckets the snapshot into the UTC day and carries the counters', () => {
    const snapshotMs = Date.parse('2026-07-20T13:37:00Z');
    const sample = postToMetricSample(samplePost() as never, snapshotMs);
    expect(sample.name).toBe('product_hunt_post_metrics');
    expect(sample.ts).toBe(Date.parse('2026-07-20T00:00:00Z'));
    expect(sample.value).toBe(312);
    expect(sample.attributes).toMatchObject({
      date: '2026-07-20',
      postId: '4242',
      slug: 'rawdash',
      votes: 312,
      comments: 24,
      reviews: 3,
      reviewsRating: 4.5,
      dailyRank: 2,
      weeklyRank: 9,
    });
  });
});

describe('ProductHuntConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns done:true when every phase returns an empty page', async () => {
    const connector = new ProductHuntConnector({}, { apiToken: TOKEN });
    const { spy } = mockGraphql(() => emptyPostsPage());
    vi.stubGlobal('fetch', spy);

    const result = await connector.sync({ mode: 'full' }, makeStorage());
    expect(result.done).toBe(true);
  });

  it('sends the bearer token and the default page size', async () => {
    const connector = new ProductHuntConnector({}, { apiToken: TOKEN });
    const { spy, calls } = mockGraphql(() => emptyPostsPage());
    vi.stubGlobal('fetch', spy);

    await connector.sync({ mode: 'full' }, makeStorage());

    const init = spy.mock.calls[0]![1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe(
      `Bearer ${TOKEN as unknown as string}`,
    );
    expect(calls[0]!.variables.first).toBe(20);
  });

  it('clamps the requested page size to the API maximum', async () => {
    const connector = new ProductHuntConnector({}, { apiToken: TOKEN });
    const { spy, calls } = mockGraphql(() => emptyPostsPage());
    vi.stubGlobal('fetch', spy);

    await connector.sync(
      { mode: 'full', pageSize: 500, resources: new Set(['posts']) },
      makeStorage(),
    );

    expect(calls[0]!.variables.first).toBe(50);
  });

  it('writes post entities from the feed query', async () => {
    const connector = new ProductHuntConnector(
      { resources: ['posts'] },
      { apiToken: TOKEN },
    );
    const { spy } = mockGraphql((call) =>
      operationName(call.query) === 'Posts' && call.variables.after === null
        ? {
            posts: {
              nodes: [samplePost()],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          }
        : emptyPostsPage(),
    );
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const written = storage.entity.mock.calls.map((c) => c[0] as Entity);
    expect(written).toHaveLength(1);
    expect(written[0]!.id).toBe('4242');
    expect(written[0]!.type).toBe('product_hunt_post');
  });

  it('follows the cursor while hasNextPage is true', async () => {
    const connector = new ProductHuntConnector(
      { resources: ['posts'] },
      { apiToken: TOKEN },
    );
    const { spy, calls } = mockGraphql((call) =>
      call.variables.after === null
        ? {
            posts: {
              nodes: [samplePost()],
              pageInfo: { hasNextPage: true, endCursor: 'cursor-2' },
            },
          }
        : {
            posts: {
              nodes: [samplePost({ id: '4243', slug: 'rawdash-2' })],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
    );
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    expect(calls.map((c) => c.variables.after)).toEqual([null, 'cursor-2']);
    expect(storage.entity.mock.calls).toHaveLength(2);
  });

  it('passes options.since through as the postedAfter filter', async () => {
    const connector = new ProductHuntConnector(
      { resources: ['posts'] },
      { apiToken: TOKEN },
    );
    const { spy, calls } = mockGraphql(() => emptyPostsPage());
    vi.stubGlobal('fetch', spy);

    const since = '2026-07-01T00:00:00.000Z';
    await connector.sync({ mode: 'latest', since }, makeStorage());

    expect(calls[0]!.variables.postedAfter).toBe(since);
  });

  it('derives postedAfter from lookbackDays when there is no since', async () => {
    const connector = new ProductHuntConnector(
      { resources: ['posts'], lookbackDays: 7 },
      { apiToken: TOKEN },
    );
    const { spy, calls } = mockGraphql(() => emptyPostsPage());
    vi.stubGlobal('fetch', spy);

    const now = Date.parse('2026-07-20T13:37:00Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    await connector.sync({ mode: 'full' }, makeStorage());
    vi.restoreAllMocks();

    expect(calls[0]!.variables.postedAfter).toBe('2026-07-14T00:00:00.000Z');
  });

  it('queries one post per configured slug instead of the feed', async () => {
    const connector = new ProductHuntConnector(
      { resources: ['posts'], slugs: ['rawdash', 'other'] },
      { apiToken: TOKEN },
    );
    const { spy, calls } = mockGraphql((call) =>
      call.variables.slug === 'rawdash'
        ? { post: samplePost() }
        : { post: null },
    );
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    expect(calls.map((c) => operationName(c.query))).toEqual([
      'PostBySlug',
      'PostBySlug',
    ]);
    expect(calls.map((c) => c.variables.slug)).toEqual(['rawdash', 'other']);
    expect(storage.entity.mock.calls).toHaveLength(1);
  });

  it('writes one metric sample per post, replacing the current day', async () => {
    const connector = new ProductHuntConnector(
      { resources: ['post_metrics'] },
      { apiToken: TOKEN },
    );
    const { spy } = mockGraphql((call) =>
      call.variables.after === null
        ? {
            posts: {
              nodes: [samplePost()],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          }
        : emptyPostsPage(),
    );
    vi.stubGlobal('fetch', spy);

    const now = Date.parse('2026-07-20T13:37:00Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);
    vi.restoreAllMocks();

    const [samples, scope] = storage.metrics.mock.calls[0]! as [
      MetricSample[],
      { names: string[]; replaceWindow?: { start: number; end: number } },
    ];
    expect(samples).toHaveLength(1);
    expect(samples[0]!.value).toBe(312);
    expect(scope.names).toEqual(['product_hunt_post_metrics']);
    expect(scope.replaceWindow).toEqual({
      start: Date.parse('2026-07-20T00:00:00Z'),
      end: Date.parse('2026-07-21T00:00:00Z') - 1,
    });
  });

  it('replaces the day only on the first page of the metrics phase', async () => {
    const connector = new ProductHuntConnector(
      { resources: ['post_metrics'] },
      { apiToken: TOKEN },
    );
    const { spy } = mockGraphql((call) =>
      call.variables.after === null
        ? {
            posts: {
              nodes: [samplePost()],
              pageInfo: { hasNextPage: true, endCursor: 'cursor-2' },
            },
          }
        : {
            posts: {
              nodes: [samplePost({ id: '4243' })],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
    );
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const scopes = storage.metrics.mock.calls.map(
      (c) => c[1] as { replaceWindow?: unknown },
    );
    expect(scopes).toHaveLength(2);
    expect(scopes[0]!.replaceWindow).toBeDefined();
    expect(scopes[1]!.replaceWindow).toBeUndefined();
  });

  it('clears post entities on a full sync but not in latest mode', async () => {
    const { spy } = mockGraphql(() => emptyPostsPage());
    vi.stubGlobal('fetch', spy);

    const fullStorage = makeStorage();
    await new ProductHuntConnector({}, { apiToken: TOKEN }).sync(
      { mode: 'full' },
      fullStorage,
    );
    const cleared = fullStorage.entities.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { types: string[] }).types[0]);
    expect(cleared).toEqual(['product_hunt_post']);

    const latestStorage = makeStorage();
    await new ProductHuntConnector({}, { apiToken: TOKEN }).sync(
      { mode: 'latest', since: '2026-07-19T00:00:00.000Z' },
      latestStorage,
    );
    expect(latestStorage.entities.mock.calls).toHaveLength(0);
  });

  it('skips phases that are not in the resource allowlist', async () => {
    const connector = new ProductHuntConnector(
      { resources: ['posts'] },
      { apiToken: TOKEN },
    );
    const { spy } = mockGraphql(() => emptyPostsPage());
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    expect(storage.metrics.mock.calls).toHaveLength(0);
  });

  it('reports GraphQL errors as a transient sync failure', async () => {
    const connector = new ProductHuntConnector({}, { apiToken: TOKEN });
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () =>
        Promise.resolve(
          JSON.stringify({ errors: [{ message: 'not_authenticated' }] }),
        ),
    } as unknown as Response);
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    const result = await connector.sync({ mode: 'full' }, storage);

    expect(result.done).toBe(false);
    expect((result.transientError as Error).message).toMatch(
      /not_authenticated/,
    );
    expect(storage.entity.mock.calls).toHaveLength(0);
  });
});
