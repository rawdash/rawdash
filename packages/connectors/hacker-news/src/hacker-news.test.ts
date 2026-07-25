import {
  installFetchMock,
  metricStoreFor,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage, type MetricSample } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HackerNewsConnector } from './hacker-news';

const CONNECTOR_ID = 'hacker-news';

function storyBody(hits: unknown[], nbPages = 1): unknown {
  return { hits, nbPages };
}

describe('HackerNewsConnector', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('only keeps submissions whose URL host matches a watched domain', async () => {
    installFetchMock((url) => {
      if (url.includes('tags=front_page')) {
        return { hits: [] };
      }
      return storyBody([
        {
          objectID: 'match',
          title: 'Ours',
          url: 'https://blog.rawdash.dev/post',
          points: 10,
          num_comments: 3,
          created_at_i: 1_700_000_000,
        },
        {
          objectID: 'nomatch',
          title: 'Someone else',
          url: 'https://example.com/post',
          points: 99,
          num_comments: 50,
          created_at_i: 1_700_000_000,
        },
      ]);
    });

    const storage = new InMemoryStorage();
    const connector = new HackerNewsConnector({
      watchedDomains: ['rawdash.dev'],
      resources: ['submissions'],
    });
    await connector.sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const submissions = await storage
      .getStorageHandle(CONNECTOR_ID)
      .queryEntities({ type: 'hn_submission' });
    expect(submissions.map((s) => s.id)).toEqual(['match']);
  });

  it('writes a daily metric snapshot with score as value and front-page rank', async () => {
    installFetchMock((url) => {
      if (url.includes('tags=front_page')) {
        return { hits: [{ objectID: 'zzz' }, { objectID: 's1' }] };
      }
      return storyBody([
        {
          objectID: 's1',
          title: 'Show HN',
          url: 'https://rawdash.dev',
          author: 'founder',
          points: 128,
          num_comments: 42,
          created_at_i: 1_700_000_000,
        },
      ]);
    });

    const storage = new InMemoryStorage();
    const connector = new HackerNewsConnector({
      watchedDomains: ['rawdash.dev'],
      resources: ['submission_metrics'],
    });
    await connector.sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const metrics = metricStoreFor<MetricSample>(storage, CONNECTOR_ID);
    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.value).toBe(128);
    expect(metrics[0]!.attributes.comments).toBe(42);
    expect(metrics[0]!.attributes.currentRank).toBe(2);
    expect(metrics[0]!.attributes.submissionId).toBe('s1');
  });

  it('replaces only the current day, preserving prior-day metric history', async () => {
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle(CONNECTOR_ID);
    const yesterday =
      Math.floor(Date.now() / 86_400_000) * 86_400_000 - 86_400_000;
    await handle.metric({
      name: 'hn_submission_metric',
      ts: yesterday,
      value: 50,
      attributes: { submissionId: 's1' },
    });

    installFetchMock((url) => {
      if (url.includes('tags=front_page')) {
        return { hits: [] };
      }
      return storyBody([
        {
          objectID: 's1',
          title: 'Show HN',
          url: 'https://rawdash.dev',
          points: 75,
          num_comments: 5,
          created_at_i: 1_700_000_000,
        },
      ]);
    });

    const connector = new HackerNewsConnector({
      watchedDomains: ['rawdash.dev'],
      resources: ['submission_metrics'],
    });
    await connector.sync({ mode: 'latest' }, handle);

    const metrics = metricStoreFor<MetricSample>(storage, CONNECTOR_ID);
    expect(metrics).toHaveLength(2);
    const values = metrics.map((m) => m.value).sort((a, b) => a - b);
    expect(values).toEqual([50, 75]);
  });

  it('records comment mentions as hn_mention entities', async () => {
    installFetchMock((url) => {
      if (url.includes('tags=comment')) {
        return {
          hits: [
            {
              objectID: 'c1',
              author: 'reader',
              comment_text: 'rawdash looks great',
              story_id: 10,
              story_title: 'A story',
              created_at_i: 1_700_000_000,
            },
          ],
          nbPages: 1,
        };
      }
      return { hits: [] };
    });

    const storage = new InMemoryStorage();
    const connector = new HackerNewsConnector({
      watchedQueries: ['rawdash'],
      resources: ['mentions'],
    });
    await connector.sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const mentions = await storage
      .getStorageHandle(CONNECTOR_ID)
      .queryEntities({ type: 'hn_mention' });
    expect(mentions).toHaveLength(1);
    expect(mentions[0]!.attributes.query).toBe('rawdash');
    expect(mentions[0]!.attributes.storyId).toBe('10');
  });

  it('bounds an incremental sync by the since timestamp', async () => {
    const spy = installFetchMock(() => ({ hits: [] }));
    const storage = new InMemoryStorage();
    const connector = new HackerNewsConnector({
      watchedQueries: ['rawdash'],
      resources: ['submissions'],
    });
    const since = '2026-01-01T00:00:00.000Z';
    await connector.sync(
      { mode: 'latest', since },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const expectedSec = Math.floor(Date.parse(since) / 1000);
    const called = spy.mock.calls.map((c) => String(c[0]));
    expect(
      called.some((u) => u.includes(`created_at_i%3E%3D${expectedSec}`)),
    ).toBe(true);
  });

  it('skips the sync when nothing is watched', async () => {
    const spy = installFetchMock(() => ({ hits: [] }));
    const storage = new InMemoryStorage();
    const connector = new HackerNewsConnector({});
    const result = await connector.sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(result.done).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});
