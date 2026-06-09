import { entityStoreFor, mockResponse } from '@rawdash/connector-test-utils';
import { type Entity, InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FirebaseCrashlyticsConnector,
  buildCrashesPerDaySql,
  buildCrashesSamplesFromBqResponse,
  buildTopIssuesEntitiesFromBqResponse,
  buildTopIssuesSql,
  configFields,
  getCrashlyticsWindow,
} from './firebase-crashlytics';

const CONNECTOR_ID = 'firebase-crashlytics';

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
    topIssuesLimit: number;
  }> = {},
): FirebaseCrashlyticsConnector {
  return new FirebaseCrashlyticsConnector(
    {
      projectId: 'my-firebase-project',
      bqDataset: overrides.bqDataset ?? 'firebase_crashlytics',
      bqLocation: overrides.bqLocation ?? 'US',
      lookbackDays: overrides.lookbackDays ?? 30,
      topIssuesLimit: overrides.topIssuesLimit ?? 50,
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

function entitiesFor(storage: InMemoryStorage): Entity[] {
  const byType = entityStoreFor<Entity>(storage, CONNECTOR_ID);
  const out: Entity[] = [];
  for (const byId of byType.values()) {
    for (const e of byId.values()) {
      out.push(e);
    }
  }
  return out;
}

const CRASH_SCHEMA = {
  fields: [
    { name: 'date', type: 'DATE' },
    { name: 'app_id', type: 'STRING' },
    { name: 'platform', type: 'STRING' },
    { name: 'version', type: 'STRING' },
    { name: 'crashes', type: 'INT64' },
    { name: 'crashing_users', type: 'INT64' },
    { name: 'total_users', type: 'INT64' },
  ],
};

const ISSUE_SCHEMA = {
  fields: [
    { name: 'issue_id', type: 'STRING' },
    { name: 'title', type: 'STRING' },
    { name: 'subtitle', type: 'STRING' },
    { name: 'app_id', type: 'STRING' },
    { name: 'platform', type: 'STRING' },
    { name: 'event_count', type: 'INT64' },
    { name: 'user_count', type: 'INT64' },
    { name: 'last_seen', type: 'TIMESTAMP' },
  ],
};

describe('FirebaseCrashlyticsConnector sync', () => {
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
      if (parsed.query.includes('crashes,')) {
        return {
          body: {
            jobComplete: true,
            schema: CRASH_SCHEMA,
            rows: [
              {
                f: [
                  { v: '2024-01-01' },
                  { v: 'com.example.app' },
                  { v: 'ios' },
                  { v: '2.4.1' },
                  { v: '5' },
                  { v: '4' },
                  { v: '400' },
                ],
              },
            ],
          },
        };
      }
      return {
        body: {
          jobComplete: true,
          schema: ISSUE_SCHEMA,
          rows: [
            {
              f: [
                { v: 'issue-1' },
                { v: 'NSException' },
                { v: 'AppDelegate.swift line 42' },
                { v: 'com.example.app' },
                { v: 'ios' },
                { v: '20' },
                { v: '15' },
                { v: '1704067200000000' },
              ],
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
    expect(samples).toHaveLength(1);
    expect(samples[0]!.value).toBe(5);
    expect(samples[0]!.attributes['app_id']).toBe('com.example.app');
    expect(samples[0]!.attributes['platform']).toBe('ios');
    expect(samples[0]!.attributes['version']).toBe('2.4.1');
    expect(samples[0]!.attributes['crashing_users']).toBe(4);
    expect(samples[0]!.attributes['crash_free_user_rate']).toBeCloseTo(
      1 - 4 / 400,
      6,
    );
    expect(samples[0]!.ts).toBe(Date.UTC(2024, 0, 1));

    const entities = entitiesFor(storage);
    expect(entities).toHaveLength(1);
    expect(entities[0]!.id).toBe('issue-1');
    expect(entities[0]!.type).toBe('firebase_crashlytics_issue');
    expect(entities[0]!.attributes['event_count']).toBe(20);
    expect(entities[0]!.attributes['user_count']).toBe(15);
    expect(entities[0]!.attributes['title']).toBe('NSException');

    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('`my-firebase-project.firebase_crashlytics.*`');
    expect(calls[1]).toContain('LIMIT 50');
  });

  it('follows pageToken across pages for crashes_per_day', async () => {
    let crashCall = 0;
    installFetch((url, init) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return { body: { access_token: 'tok' } };
      }
      const parsed = JSON.parse(String(init.body)) as {
        query: string;
        pageToken?: string;
      };
      if (parsed.query.includes('crashes,')) {
        crashCall += 1;
        if (crashCall === 1) {
          return {
            body: {
              jobComplete: true,
              schema: CRASH_SCHEMA,
              rows: [
                {
                  f: [
                    { v: '2024-01-01' },
                    { v: 'app' },
                    { v: 'android' },
                    { v: '1.0' },
                    { v: '1' },
                    { v: '1' },
                    { v: '100' },
                  ],
                },
              ],
              pageToken: 'page-2',
            },
          };
        }
        expect(parsed.pageToken).toBe('page-2');
        return {
          body: {
            jobComplete: true,
            schema: CRASH_SCHEMA,
            rows: [
              {
                f: [
                  { v: '2024-01-02' },
                  { v: 'app' },
                  { v: 'android' },
                  { v: '1.0' },
                  { v: '2' },
                  { v: '2' },
                  { v: '200' },
                ],
              },
            ],
          },
        };
      }
      return {
        body: { jobComplete: true, schema: ISSUE_SCHEMA, rows: [] },
      };
    });

    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(metricsFor(storage).map((m) => m.value)).toEqual([1, 2]);
  });

  it('drops crash rows with no count', async () => {
    installFetch((url, init) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return { body: { access_token: 'tok' } };
      }
      const parsed = JSON.parse(String(init.body)) as { query: string };
      if (parsed.query.includes('crashes,')) {
        return {
          body: {
            jobComplete: true,
            schema: CRASH_SCHEMA,
            rows: [
              {
                f: [
                  { v: '2024-01-01' },
                  { v: 'a' },
                  { v: 'ios' },
                  { v: '1' },
                  { v: null },
                  { v: '0' },
                  { v: '0' },
                ],
              },
              {
                f: [
                  { v: '2024-01-02' },
                  { v: 'b' },
                  { v: 'android' },
                  { v: '1' },
                  { v: '3' },
                  { v: '2' },
                  { v: '50' },
                ],
              },
            ],
          },
        };
      }
      return {
        body: { jobComplete: true, schema: ISSUE_SCHEMA, rows: [] },
      };
    });

    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(metricsFor(storage).map((m) => m.value)).toEqual([3]);
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
    expect(entitiesFor(storage)).toHaveLength(0);
  });

  it('skips top_issues when not in options.resources', async () => {
    installFetch((url, init) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return { body: { access_token: 'tok' } };
      }
      const parsed = JSON.parse(String(init.body)) as { query: string };
      expect(parsed.query).toContain('crashes,');
      return {
        body: { jobComplete: true, schema: CRASH_SCHEMA, rows: [] },
      };
    });

    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full', resources: new Set(['crashes_per_day']) },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(entitiesFor(storage)).toHaveLength(0);
  });
});

describe('buildCrashesPerDaySql', () => {
  it('targets the configured wildcard table and date window', () => {
    const sql = buildCrashesPerDaySql({
      projectId: 'p',
      bqDataset: 'd',
      startDate: '2024-01-01',
      endDate: '2024-02-01',
    });
    expect(sql).toContain('`p.d.*`');
    expect(sql).toContain("DATE('2024-01-01')");
    expect(sql).toContain("DATE('2024-02-01')");
    expect(sql).toContain('GROUP BY date, app_id, platform, version');
  });
});

describe('buildTopIssuesSql', () => {
  it('honours the limit and sorts by event count', () => {
    const sql = buildTopIssuesSql({
      projectId: 'p',
      bqDataset: 'd',
      startDate: '2024-01-01',
      endDate: '2024-02-01',
      limit: 25,
    });
    expect(sql).toContain('LIMIT 25');
    expect(sql).toContain('ORDER BY event_count DESC');
    expect(sql).toContain('issue_id IS NOT NULL');
  });
});

describe('getCrashlyticsWindow', () => {
  const now = Date.UTC(2024, 0, 31, 12, 0, 0);

  it('uses the full lookback for a full sync', () => {
    expect(getCrashlyticsWindow({ mode: 'full' }, 30, now)).toEqual({
      startDate: '2024-01-02',
      endDate: '2024-02-01',
    });
  });

  it('clamps to a short refetch window in latest mode', () => {
    expect(getCrashlyticsWindow({ mode: 'latest' }, 90, now)).toEqual({
      startDate: '2024-01-30',
      endDate: '2024-02-01',
    });
  });
});

describe('buildCrashesSamplesFromBqResponse', () => {
  it('returns an empty list when the response has no rows', () => {
    expect(buildCrashesSamplesFromBqResponse({ jobComplete: true })).toEqual(
      [],
    );
  });
});

describe('buildTopIssuesEntitiesFromBqResponse', () => {
  it('returns an empty list when the response has no rows', () => {
    expect(buildTopIssuesEntitiesFromBqResponse({ jobComplete: true })).toEqual(
      [],
    );
  });

  it('drops rows with a missing issue_id', () => {
    const entities = buildTopIssuesEntitiesFromBqResponse({
      jobComplete: true,
      schema: ISSUE_SCHEMA,
      rows: [
        {
          f: [
            { v: null },
            { v: 't' },
            { v: 's' },
            { v: 'app' },
            { v: 'ios' },
            { v: '1' },
            { v: '1' },
            { v: '1704067200000000' },
          ],
        },
      ],
    });
    expect(entities).toEqual([]);
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
      configFields.parse({ ...base, bqDataset: 'crash-export' }),
    ).toThrow();
  });

  it('rejects a topIssuesLimit above the cap', () => {
    expect(() =>
      configFields.parse({ ...base, topIssuesLimit: 5000 }),
    ).toThrow();
  });
});
