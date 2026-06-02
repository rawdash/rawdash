import { mockResponse } from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GcpBillingConnector,
  buildBillingSql,
  buildSamplesFromBqResponse,
  configFields,
  getCostWindow,
} from './gcp-billing';

const CONNECTOR_ID = 'gcp-billing';

const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDFvX2hX9MZqaQz
G0nVHkBcLG8K7AaH7SkB1tJ7w7K3M7ICX/dQOX4xs0Ja/Cn1nMSgPHWGEDsq3qDV
SLZbX7l4PgTzaLZqYG1f0aSV52L4cmDhfP3T9TLcXY3WIuhJpsyEr2QnPzKuY7y4
yzM4DAuD2Wg4lwOIyXX6r1L3RWAnZj1J7K0pwGcVabVhV/U3hk1cBhrJlVRz8oig
b/SgXr5hHbA8e2zRSnZbOTHEZcVcd2dnUFG6hLwO1Tlc0n0HoEvg1AaXdz/3LhqW
4lOX7Bys9MIgQyJZIbDvX0+xJZ0p4S9aXcHgnTw/F8RYxQyTfTdYz1cF4iVPmW0z
J0eVQrTjAgMBAAECggEAUlqMyKt0wWWcg5L9k3CkPzhFxBxJoF6X0jvfqzPHc+I8
sx/L6yu6vTNTQCqWBxQy+x9KX4qVe93h8DTrYdyKzKR1yYXqVxV6V5gKVtZ4iySV
ZQEz0BexcZGu5+UmTSqLs7DZpZ4l9OmM4mxF9N1tQEKZAYjGzG1+OBHTQ7zaCv6X
SnyHo3pjJyKAhsmkA0jYZ4rwwYZP0VzqyD3PxFcXJ8YqV5MgPV3LZGsBTb2DfDuh
M9JLNVN/W3iwLDcWoq5xWNJL4tVw6mIQDmUSZQ1ZuvtCb/Vz4ahKaqDOJzHs7sLD
S0YrIfWXC9Q1lLkxR5cMZRhYpr0JOzJzTKZGcjsLAQKBgQDi/eHrkXxc0KPlGtT9
SAJ/MR7ucC5RIZSLqQYJ7yHJOyW7yk5HrG3VqK9z7qbqJh9NwwY7d8sIuvJv3Z7E
RGqJ0+SfYDPVRcq7TZ1WkV0qGc8VxR5DSCfMrAyzqMdJyGfX+jVxlh+r6yK7TLNB
F4HHRMTQyZuS3xCN3SP1nq3PgQKBgQDfBmqkBJBV6yLZ3DkVCi5fX1cZc/r2dDZH
oWZSm4G6+s5lJ4rGxOLY4yMR8aNCv4n3wKyo7BAS9pkKVL5RtkdY8XYpwQEKfYS+
W3Ks1iDk0Js9HRkVB1y0HzwSfx0M8oCwGc7Pj4q1mhqlMNG7BpJXz0nF7yBkP0Ld
qaInZ6tOgwKBgC9wdj6pV3IhrqcZpr0PnAhmMfMZuwsKmkBy0lH7DfvgVe5J0aHQ
LCBWdrRXBRxJYK4yYdJYBL1jR4w6c92qFu2W3yWMqOgD3SY+B+yX8m9o0c2sBl3I
9ALzpRl8j5LVPZl7vNT0lFlcZ0jOlS8z9oP6/A5oUOcS6rRcfYUWuxKBAoGBAJTC
fL0jr5pYAaP3Ow3KFsCQrjA0OxKnSpfm66JFRDH4hCT2KdJtFnK4z8c9jZNlMnFy
xBYqLZJ7XdL2dQXTpKDFvU/W2N6ZRBgFG/yWiVZjsiAYsRz0w0YwRyZxnVlSP4vS
NEcG+gAIaIaiRGw3J/sZHmh7uIZ+JN7Xz6JEKgyTAoGBANLOLJ9MNQTUKtOyA/sw
qCEZ8sBVfQGmJWELRBNcc/zwa3z6jr/lASS2VBhsyExSAQE0LcXX9C6Pog+UEHJ4
RmEYx5G8nFXrm0L7CCY1FdJh+1WiOyQ7Q9V9ID0+1uFmS4owmtZTPNTpd5jPTPMR
HJC2BqGwSGRPDx9bPo8Bd6Mq
-----END PRIVATE KEY-----`;

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
    groupBy: readonly ('service' | 'project' | 'sku' | 'location')[];
  }> = {},
): GcpBillingConnector {
  return new GcpBillingConnector(
    {
      bqProject: 'my-billing-project',
      bqDataset: 'billing_export',
      bqLocation: 'US',
      lookbackDays: 30,
      groupBy: overrides.groupBy ?? (['service'] as const),
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

describe('GcpBillingConnector sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exchanges the JWT for a token, then queries BigQuery for daily costs', async () => {
    const spy = installFetch((url) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return { body: { access_token: 'tok', expires_in: 3600 } };
      }
      return {
        body: {
          jobComplete: true,
          schema: {
            fields: [
              { name: 'date', type: 'DATE' },
              { name: 'service', type: 'STRING' },
              { name: 'cost', type: 'NUMERIC' },
              { name: 'currency', type: 'STRING' },
            ],
          },
          rows: [
            {
              f: [
                { v: '2024-01-01' },
                { v: 'Compute Engine' },
                { v: '12.34' },
                { v: 'USD' },
              ],
            },
            {
              f: [
                { v: '2024-01-02' },
                { v: 'BigQuery' },
                { v: '0.75' },
                { v: 'USD' },
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
    expect(
      samples.map((m) => ({
        value: m.value,
        service: m.attributes['service'],
      })),
    ).toEqual([
      { value: 12.34, service: 'Compute Engine' },
      { value: 0.75, service: 'BigQuery' },
    ]);
    expect(samples[0]!.attributes['currency']).toBe('USD');
    expect(samples[0]!.ts).toBe(Date.UTC(2024, 0, 1));

    const bqCall = spy.mock.calls.find(([u]) =>
      String(u).includes('bigquery.googleapis.com'),
    )!;
    expect(String(bqCall[0])).toContain('projects/my-billing-project/queries');
    const parsed = JSON.parse(String(bqCall[1].body)) as {
      query: string;
      location: string;
    };
    expect(parsed.location).toBe('US');
    expect(parsed.query).toContain(
      '`my-billing-project.billing_export.gcp_billing_export_v1_*`',
    );
    expect(parsed.query).toContain('service.description AS service');
  });

  it('follows pageToken across pages', async () => {
    let call = 0;
    installFetch((url) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return { body: { access_token: 'tok' } };
      }
      call += 1;
      const fields = [
        { name: 'date', type: 'DATE' },
        { name: 'service', type: 'STRING' },
        { name: 'cost', type: 'NUMERIC' },
        { name: 'currency', type: 'STRING' },
      ];
      if (call === 1) {
        return {
          body: {
            jobComplete: true,
            schema: { fields },
            rows: [
              {
                f: [{ v: '2024-01-01' }, { v: 'A' }, { v: '1' }, { v: 'USD' }],
              },
            ],
            pageToken: 'next-page',
          },
        };
      }
      return {
        body: {
          jobComplete: true,
          schema: { fields },
          rows: [
            { f: [{ v: '2024-01-02' }, { v: 'B' }, { v: '2' }, { v: 'USD' }] },
          ],
        },
      };
    });

    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(metricsFor(storage).map((m) => m.value)).toEqual([1, 2]);
  });

  it('drops rows whose cost is null or not finite', async () => {
    installFetch((url) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return { body: { access_token: 'tok' } };
      }
      return {
        body: {
          jobComplete: true,
          schema: {
            fields: [
              { name: 'date', type: 'DATE' },
              { name: 'service', type: 'STRING' },
              { name: 'cost', type: 'NUMERIC' },
              { name: 'currency', type: 'STRING' },
            ],
          },
          rows: [
            {
              f: [{ v: '2024-01-01' }, { v: 'A' }, { v: null }, { v: 'USD' }],
            },
            {
              f: [{ v: '2024-01-02' }, { v: 'B' }, { v: 'NaN' }, { v: 'USD' }],
            },
            {
              f: [{ v: '2024-01-03' }, { v: 'C' }, { v: '3.14' }, { v: 'USD' }],
            },
          ],
        },
      };
    });

    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(metricsFor(storage).map((m) => m.value)).toEqual([3.14]);
  });
});

describe('buildBillingSql', () => {
  it('selects the requested groupBy dimensions and the wildcard table', () => {
    const sql = buildBillingSql({
      bqProject: 'p',
      bqDataset: 'd',
      groupBy: ['service', 'project'],
      startDate: '2024-01-01',
      endDate: '2024-02-01',
    });
    expect(sql).toContain('service.description AS service');
    expect(sql).toContain('project.id AS project');
    expect(sql).toContain('SUM(cost) AS cost');
    expect(sql).toContain('`p.d.gcp_billing_export_v1_*`');
    expect(sql).toContain("DATE('2024-01-01')");
    expect(sql).toContain("DATE('2024-02-01')");
    expect(sql).toContain('GROUP BY date, service, project');
  });
});

describe('getCostWindow', () => {
  const now = Date.UTC(2024, 0, 31, 12, 0, 0);

  it('uses the full lookback for a full sync', () => {
    expect(getCostWindow({ mode: 'full' }, 30, now)).toEqual({
      startDate: '2024-01-02',
      endDate: '2024-02-01',
    });
  });

  it('clamps to a short refetch window in latest mode', () => {
    expect(getCostWindow({ mode: 'latest' }, 90, now)).toEqual({
      startDate: '2024-01-27',
      endDate: '2024-02-01',
    });
  });

  it('uses the time elapsed since `options.since` plus a back-revision buffer', () => {
    // since = 25 days ago: elapsed=25 + buffer=5 = 30
    const since = new Date(now - 25 * 86_400_000).toISOString();
    expect(getCostWindow({ mode: 'full', since }, 90, now)).toEqual({
      startDate: '2024-01-02',
      endDate: '2024-02-01',
    });
  });
});

describe('buildSamplesFromBqResponse', () => {
  it('returns an empty list when the response carries no rows', () => {
    expect(
      buildSamplesFromBqResponse({ jobComplete: true }, ['service']),
    ).toEqual([]);
  });

  it('handles missing schema fields gracefully', () => {
    // No schema, no rows -> no samples; sanity check that the helper does not
    // throw against a stub response.
    expect(buildSamplesFromBqResponse({}, ['service'])).toEqual([]);
  });
});

describe('configFields', () => {
  const base = {
    serviceAccountJson: { $secret: 'GCP_SA' },
    bqProject: 'p',
    bqDataset: 'd',
  };

  it('accepts a minimal valid config', () => {
    expect(() => configFields.parse(base)).not.toThrow();
  });

  it('rejects an invalid bqProject', () => {
    expect(() =>
      configFields.parse({ ...base, bqProject: 'has spaces' }),
    ).toThrow();
  });

  it('rejects an invalid bqDataset', () => {
    expect(() =>
      configFields.parse({ ...base, bqDataset: 'with.dots' }),
    ).toThrow();
  });

  it('rejects a groupBy that is too wide', () => {
    expect(() =>
      configFields.parse({
        ...base,
        groupBy: ['service', 'project', 'sku', 'location'],
      }),
    ).toThrow();
  });
});
