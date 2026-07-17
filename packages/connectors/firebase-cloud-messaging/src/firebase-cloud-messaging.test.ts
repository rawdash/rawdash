import { mockResponse } from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FirebaseCloudMessagingConnector,
  buildMessagesPerDaySamplesFromBqResponse,
  buildMessagesPerDaySql,
  buildMessagesPerTopicSamplesFromBqResponse,
  buildMessagesPerTopicSql,
  configFields,
  getMessagingWindow,
} from './firebase-cloud-messaging';

const CONNECTOR_ID = 'firebase-cloud-messaging';

async function generateTestPrivateKeyPem(): Promise<string> {
  const { privateKey } = await globalThis.crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = new Uint8Array(
    await globalThis.crypto.subtle.exportKey('pkcs8', privateKey),
  );
  let binary = '';
  for (let i = 0; i < pkcs8.length; i++) {
    binary += String.fromCharCode(pkcs8[i]!);
  }
  const lines = btoa(binary).match(/.{1,64}/g) ?? [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`;
}

const TEST_PRIVATE_KEY = await generateTestPrivateKeyPem();

const TEST_SA_JSON = JSON.stringify({
  client_email: 'sa@test.iam.gserviceaccount.com',
  private_key: TEST_PRIVATE_KEY,
  token_uri: 'https://oauth2.googleapis.com/token',
});

interface MockReply {
  status?: number;
  body: unknown;
}

function installFetch(
  handler: (url: string, init: RequestInit) => MockReply,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn((url: string | URL, init: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    const reply = handler(u, init);
    return Promise.resolve(
      mockResponse({ body: reply.body, status: reply.status }),
    );
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function makeConnector(
  overrides: Partial<{
    bqDataset: string;
    bqLocation: string;
    lookbackDays: number;
    topTopicsLimit: number;
  }> = {},
): FirebaseCloudMessagingConnector {
  return new FirebaseCloudMessagingConnector(
    {
      projectId: 'my-firebase-project',
      bqDataset: overrides.bqDataset ?? 'firebase_messaging',
      bqLocation: overrides.bqLocation ?? 'US',
      lookbackDays: overrides.lookbackDays ?? 30,
      topTopicsLimit: overrides.topTopicsLimit ?? 100,
    },
    { serviceAccountJson: TEST_SA_JSON },
  );
}

function metricsFor(storage: InMemoryStorage): Array<{
  name: string;
  ts: number;
  value: number;
  attributes: Record<string, unknown>;
}> {
  return (
    (
      storage as unknown as {
        metricStore: Map<
          string,
          Array<{
            name: string;
            ts: number;
            value: number;
            attributes: Record<string, unknown>;
          }>
        >;
      }
    ).metricStore.get(CONNECTOR_ID) ?? []
  );
}

const DAY_SCHEMA = {
  fields: [
    { name: 'date', type: 'DATE' },
    { name: 'platform', type: 'STRING' },
    { name: 'accepted', type: 'INT64' },
    { name: 'delivered', type: 'INT64' },
  ],
};

const TOPIC_SCHEMA = {
  fields: [
    { name: 'date', type: 'DATE' },
    { name: 'topic', type: 'STRING' },
    { name: 'accepted', type: 'INT64' },
    { name: 'delivered', type: 'INT64' },
  ],
};

describe('FirebaseCloudMessagingConnector sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exchanges the JWT for a token, then queries BigQuery for both resources', async () => {
    const calls: string[] = [];
    installFetch((url, init) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return { body: { access_token: 'tok', expires_in: 3600 } };
      }
      const parsed = JSON.parse(String(init.body)) as { query: string };
      calls.push(parsed.query);
      if (parsed.query.includes('GROUP BY date, platform')) {
        return {
          body: {
            jobComplete: true,
            schema: DAY_SCHEMA,
            rows: [
              {
                f: [
                  { v: '2024-01-01' },
                  { v: 'android' },
                  { v: '100' },
                  { v: '90' },
                ],
              },
            ],
          },
        };
      }
      return {
        body: {
          jobComplete: true,
          schema: TOPIC_SCHEMA,
          rows: [
            {
              f: [{ v: '2024-01-01' }, { v: 'news' }, { v: '40' }, { v: '36' }],
            },
          ],
        },
      };
    });

    const storage = new InMemoryStorage();
    const result = await makeConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(result).toEqual({ done: true });

    const samples = metricsFor(storage);
    const perDay = samples.filter((s) => s.name === 'messages_per_day');
    const perTopic = samples.filter((s) => s.name === 'messages_per_topic');

    expect(perDay).toHaveLength(1);
    expect(perDay[0]!.value).toBe(100);
    expect(perDay[0]!.attributes['platform']).toBe('android');
    expect(perDay[0]!.attributes['delivered']).toBe(90);
    expect(perDay[0]!.attributes['delivery_rate']).toBeCloseTo(0.9, 6);
    expect(perDay[0]!.ts).toBe(Date.UTC(2024, 0, 1));

    expect(perTopic).toHaveLength(1);
    expect(perTopic[0]!.value).toBe(40);
    expect(perTopic[0]!.attributes['topic']).toBe('news');
    expect(perTopic[0]!.attributes['delivery_rate']).toBeCloseTo(0.9, 6);

    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('`my-firebase-project.firebase_messaging.data`');
    expect(calls[1]).toContain('rn <= 100');
  });

  it('follows pageToken across pages for messages_per_day', async () => {
    let call = 0;
    const bqRequests: Array<{ url: string; method: string }> = [];
    installFetch((url, init) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return { body: { access_token: 'tok' } };
      }
      bqRequests.push({ url, method: init.method ?? 'GET' });
      call += 1;
      if (call === 1) {
        return {
          body: {
            jobComplete: true,
            schema: DAY_SCHEMA,
            rows: [
              {
                f: [{ v: '2024-01-01' }, { v: 'ios' }, { v: '1' }, { v: '1' }],
              },
            ],
            pageToken: 'page-2',
            jobReference: {
              projectId: 'my-firebase-project',
              jobId: 'job-1',
              location: 'US',
            },
          },
        };
      }
      return {
        body: {
          jobComplete: true,
          schema: DAY_SCHEMA,
          rows: [
            { f: [{ v: '2024-01-02' }, { v: 'ios' }, { v: '2' }, { v: '2' }] },
          ],
        },
      };
    });

    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full', resources: new Set(['messages_per_day']) },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(metricsFor(storage).map((m) => m.value)).toEqual([1, 2]);

    expect(bqRequests[0]!.method).toBe('POST');
    expect(bqRequests[0]!.url).toContain(
      'projects/my-firebase-project/queries',
    );
    expect(bqRequests[1]!.method).toBe('GET');
    expect(bqRequests[1]!.url).toContain(
      'projects/my-firebase-project/queries/job-1',
    );
    expect(bqRequests[1]!.url).toContain('pageToken=page-2');
    expect(bqRequests[1]!.url).toContain('location=US');
  });

  it('reports a null delivery rate when no messages were accepted', async () => {
    installFetch((url, init) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return { body: { access_token: 'tok' } };
      }
      const parsed = JSON.parse(String(init.body)) as { query: string };
      if (parsed.query.includes('GROUP BY date, platform')) {
        return {
          body: {
            jobComplete: true,
            schema: DAY_SCHEMA,
            rows: [
              {
                f: [{ v: '2024-01-01' }, { v: 'web' }, { v: '0' }, { v: '0' }],
              },
            ],
          },
        };
      }
      return { body: { jobComplete: true, schema: TOPIC_SCHEMA, rows: [] } };
    });

    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full', resources: new Set(['messages_per_day']) },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    const perDay = metricsFor(storage).filter(
      (s) => s.name === 'messages_per_day',
    );
    expect(perDay).toHaveLength(1);
    expect(perDay[0]!.value).toBe(0);
    expect(perDay[0]!.attributes['delivery_rate']).toBeNull();
  });

  it('throws instead of persisting when the query does not complete', async () => {
    installFetch((url) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return { body: { access_token: 'tok' } };
      }
      return {
        body: {
          jobComplete: false,
          jobReference: { projectId: 'my-firebase-project', jobId: 'job-1' },
        },
      };
    });

    const storage = new InMemoryStorage();
    await expect(
      makeConnector().sync(
        { mode: 'full' },
        storage.getStorageHandle(CONNECTOR_ID),
      ),
    ).rejects.toThrow(/jobComplete=false/);
    expect(metricsFor(storage)).toHaveLength(0);
  });

  it('skips messages_per_topic when not in options.resources', async () => {
    installFetch((url, init) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return { body: { access_token: 'tok' } };
      }
      const parsed = JSON.parse(String(init.body)) as { query: string };
      expect(parsed.query).toContain('GROUP BY date, platform');
      return { body: { jobComplete: true, schema: DAY_SCHEMA, rows: [] } };
    });

    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full', resources: new Set(['messages_per_day']) },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(
      metricsFor(storage).filter((s) => s.name === 'messages_per_topic'),
    ).toHaveLength(0);
  });

  it('does not wipe older history when an incremental sync returns no rows', async () => {
    installFetch((url) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return { body: { access_token: 'tok' } };
      }
      return { body: { jobComplete: true, schema: DAY_SCHEMA, rows: [] } };
    });

    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle(CONNECTOR_ID);
    const oldTs = Date.now() - 60 * 86_400_000;
    await handle.metric({
      name: 'messages_per_day',
      ts: oldTs,
      value: 7,
      attributes: { platform: 'ios' },
    });

    await makeConnector().sync(
      { mode: 'latest', resources: new Set(['messages_per_day']) },
      handle,
    );

    const surviving = await handle.queryMetrics({ name: 'messages_per_day' });
    expect(surviving.map((m) => m.ts)).toContain(oldTs);
  });
});

describe('buildMessagesPerDaySql', () => {
  it('targets the delivery table and date window', () => {
    const sql = buildMessagesPerDaySql({
      projectId: 'p',
      bqDataset: 'd',
      startDate: '2024-01-01',
      endDate: '2024-02-01',
    });
    expect(sql).toContain('`p.d.data`');
    expect(sql).toContain("DATE('2024-01-01')");
    expect(sql).toContain("DATE('2024-02-01')");
    expect(sql).toContain("COUNTIF(event = 'MESSAGE_ACCEPTED')");
    expect(sql).toContain("COUNTIF(event = 'MESSAGE_DELIVERED')");
    expect(sql).toContain('GROUP BY date, platform');
  });
});

describe('buildMessagesPerTopicSql', () => {
  it('filters to topic sends and caps to the limit', () => {
    const sql = buildMessagesPerTopicSql({
      projectId: 'p',
      bqDataset: 'd',
      startDate: '2024-01-01',
      endDate: '2024-02-01',
      limit: 25,
    });
    expect(sql).toContain('`p.d.data`');
    expect(sql).toContain('topic IS NOT NULL');
    expect(sql).toContain("topic != ''");
    expect(sql).toContain('rn <= 25');
    expect(sql).toContain('GROUP BY date, topic');
  });
});

describe('getMessagingWindow', () => {
  const now = Date.UTC(2024, 0, 31, 12, 0, 0);

  it('uses the full lookback for a full sync', () => {
    expect(getMessagingWindow({ mode: 'full' }, 30, now)).toEqual({
      startDate: '2024-01-02',
      endDate: '2024-02-01',
    });
  });

  it('clamps to a short refetch window in latest mode', () => {
    expect(getMessagingWindow({ mode: 'latest' }, 90, now)).toEqual({
      startDate: '2024-01-30',
      endDate: '2024-02-01',
    });
  });

  it('uses since with a trailing refetch and clamps to lookbackDays', () => {
    expect(
      getMessagingWindow(
        { mode: 'full', since: new Date(now).toISOString() },
        90,
        now,
      ),
    ).toEqual({
      startDate: '2024-01-30',
      endDate: '2024-02-01',
    });

    expect(
      getMessagingWindow(
        { mode: 'full', since: '2024-01-01T00:00:00.000Z' },
        3,
        now,
      ),
    ).toEqual({
      startDate: '2024-01-29',
      endDate: '2024-02-01',
    });
  });
});

describe('buildMessagesPerDaySamplesFromBqResponse', () => {
  it('returns an empty list when the response has no rows', () => {
    expect(
      buildMessagesPerDaySamplesFromBqResponse({ jobComplete: true }),
    ).toEqual([]);
  });
});

describe('buildMessagesPerTopicSamplesFromBqResponse', () => {
  it('returns an empty list when the response has no rows', () => {
    expect(
      buildMessagesPerTopicSamplesFromBqResponse({ jobComplete: true }),
    ).toEqual([]);
  });

  it('drops rows with an empty topic', () => {
    const samples = buildMessagesPerTopicSamplesFromBqResponse({
      jobComplete: true,
      schema: TOPIC_SCHEMA,
      rows: [{ f: [{ v: '2024-01-01' }, { v: '' }, { v: '5' }, { v: '5' }] }],
    });
    expect(samples).toEqual([]);
  });
});

describe('configFields', () => {
  const base = {
    serviceAccountJson: { $secret: 'FB_SA' },
    projectId: 'my-firebase-project',
  };

  it('accepts a minimal valid config', () => {
    expect(() => configFields.parse(base)).not.toThrow();
  });

  it('rejects an invalid projectId', () => {
    expect(() =>
      configFields.parse({ ...base, projectId: 'has spaces' }),
    ).toThrow();
  });

  it('rejects a bqDataset containing a dash', () => {
    expect(() =>
      configFields.parse({ ...base, bqDataset: 'msg-export' }),
    ).toThrow();
  });

  it('rejects a topTopicsLimit above the cap', () => {
    expect(() =>
      configFields.parse({ ...base, topTopicsLimit: 5000 }),
    ).toThrow();
  });
});
