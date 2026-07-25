import {
  type InvariantViolation,
  assertConnectorMetricConformance,
  assertConnectorResourceShapes,
  connectorResourceShapeViolations,
  entityStoreFor,
  installFetchMock,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { HackerNewsConnector } from './hacker-news';

const CONNECTOR_ID = 'hacker-news';

const docShapeExtra = (
  storage: InMemoryStorage,
  _connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    HackerNewsConnector.resources,
    storage,
    CONNECTOR_ID,
  );

type StoriesSample = z.infer<typeof HackerNewsConnector.schemas.stories>;
type CommentsSample = z.infer<typeof HackerNewsConnector.schemas.comments>;

describe('HackerNewsConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('submissions: sync upholds universal invariants for any valid payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: StoriesSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.hits.map((h) => h.objectID)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('hn_submission')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one hn_submission entity per unique story id',
          location: 'submissions phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: HackerNewsConnector,
      resource: 'stories',
      connectorId: CONNECTOR_ID,
      runs: 40,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        const connector = new HackerNewsConnector({
          watchedQueries: ['rawdash'],
          resources: ['submissions'],
        });
        await connector.sync(
          { mode: 'latest', since: '1970-01-01T00:00:00.000Z' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('mentions: sync upholds universal invariants for any valid payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: CommentsSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.hits.map((h) => h.objectID)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('hn_mention')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one hn_mention entity per unique comment id',
          location: 'mentions phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: HackerNewsConnector,
      resource: 'comments',
      connectorId: CONNECTOR_ID,
      runs: 40,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample: CommentsSample, storage) => {
        installFetchMock(() => sample);
        const connector = new HackerNewsConnector({
          watchedQueries: ['rawdash'],
          resources: ['mentions'],
        });
        await connector.sync(
          { mode: 'latest', since: '1970-01-01T00:00:00.000Z' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('full sync across all resources matches documented shapes', async () => {
    installFetchMock((url) => {
      if (url.includes('tags=front_page')) {
        return { hits: [{ objectID: 's1' }] };
      }
      if (url.includes('tags=comment')) {
        return {
          hits: [
            {
              objectID: 'c1',
              author: 'someone',
              comment_text: 'rawdash is neat',
              story_id: 1,
              story_title: 'Show HN: rawdash',
              created_at_i: Math.floor(Date.now() / 1000),
            },
          ],
          nbPages: 1,
        };
      }
      return {
        hits: [
          {
            objectID: 's1',
            title: 'Show HN: rawdash',
            url: 'https://rawdash.dev/launch',
            author: 'founder',
            points: 128,
            num_comments: 42,
            created_at_i: Math.floor(Date.now() / 1000),
          },
        ],
        nbPages: 1,
      };
    });

    const storage = new InMemoryStorage();
    const connector = new HackerNewsConnector({
      watchedDomains: ['rawdash.dev'],
      watchedQueries: ['rawdash'],
      resources: ['submissions', 'submission_metrics', 'mentions'],
    });
    await connector.sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    assertConnectorResourceShapes(
      HackerNewsConnector.resources,
      storage,
      CONNECTOR_ID,
    );
    assertConnectorMetricConformance(
      HackerNewsConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
