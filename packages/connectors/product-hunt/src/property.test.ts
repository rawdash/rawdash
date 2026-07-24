import {
  type InvariantViolation,
  assertConnectorResourceShapes,
  connectorMetricConformanceViolations,
  connectorResourceShapeViolations,
  entityStoreFor,
  installFetchMock,
  metricStoreFor,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { ProductHuntConnector } from './product-hunt';

const CONNECTOR_ID = 'product-hunt';
const TOKEN = 'PRODUCT_HUNT_API_TOKEN' as unknown as { $secret: string };

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] => [
  ...connectorResourceShapeViolations(
    ProductHuntConnector.resources,
    storage,
    connectorId,
  ),
  ...connectorMetricConformanceViolations(
    ProductHuntConnector.resources,
    storage,
    connectorId,
  ),
];

type PostsSample = z.infer<typeof ProductHuntConnector.schemas.posts>;
type PostMetricsSample = z.infer<
  typeof ProductHuntConnector.schemas.post_metrics
>;

function makeConnector(resources?: string[]) {
  return new ProductHuntConnector(
    { resources: resources as never },
    { apiToken: TOKEN },
  );
}

function distinctPostCount(sample: { posts: { nodes: { id: string }[] } }) {
  return new Set(sample.posts.nodes.map((node) => node.id)).size;
}

function firstPageOnly(sample: PostsSample): PostsSample {
  return {
    posts: {
      nodes: sample.posts.nodes,
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}

function postEntityCountInvariant(
  storage: InMemoryStorage,
  connectorId: string,
  sample: PostsSample,
): InvariantViolation[] {
  const expected = distinctPostCount(sample);
  const stored =
    entityStoreFor(storage, connectorId).get('product_hunt_post')?.size ?? 0;
  if (stored !== expected) {
    return [
      {
        invariant: 'one product_hunt_post entity per distinct post id',
        location: 'posts phase',
        detail: `expected ${expected} entities, got ${stored}`,
      },
    ];
  }
  return [];
}

function metricSampleCountInvariant(
  storage: InMemoryStorage,
  connectorId: string,
  sample: PostMetricsSample,
): InvariantViolation[] {
  const expected = sample.posts.nodes.length;
  const samples = metricStoreFor(storage, connectorId).filter(
    (m) => m.name === 'product_hunt_post_metrics',
  );
  if (samples.length !== expected) {
    return [
      {
        invariant: 'one product_hunt_post_metrics sample per returned post',
        location: 'post_metrics phase',
        detail: `expected ${expected} samples, got ${samples.length}`,
      },
    ];
  }
  return [];
}

describe('ProductHuntConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<PostsSample>({
      connectorClass: ProductHuntConnector,
      resource: 'posts',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [postEntityCountInvariant, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({ data: firstPageOnly(sample) }));
        await makeConnector(['posts']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('post_metrics: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<PostMetricsSample>({
      connectorClass: ProductHuntConnector,
      resource: 'post_metrics',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [metricSampleCountInvariant, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({ data: firstPageOnly(sample) }));
        await makeConnector(['post_metrics']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('full sync across all resources matches documented resource shapes', async () => {
    installFetchMock(() => ({
      data: {
        posts: {
          nodes: [
            {
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
                nodes: [
                  { id: '1', name: 'Developer Tools', slug: 'dev-tools' },
                ],
              },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    }));

    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    assertConnectorResourceShapes(
      ProductHuntConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
