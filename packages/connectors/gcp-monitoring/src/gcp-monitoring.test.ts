import { mockResponse } from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GcpMonitoringConnector,
  configFields,
  parseDurationSeconds,
} from './gcp-monitoring';

const CONNECTOR_ID = 'gcp-monitoring';

// Minimal valid RSA PKCS8 key for tests - generated once and reused. The crypto
// subtle importKey only checks that the bytes form a valid PKCS8 blob; sign()
// produces a JWT we never verify, so any well-formed key works.
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
  client_email: 'test-sa@test-project.iam.gserviceaccount.com',
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

function makeConnector(): GcpMonitoringConnector {
  return new GcpMonitoringConnector(
    {
      projectId: 'my-project',
      metricQueries: [
        {
          id: 'cpu',
          metricType: 'compute.googleapis.com/instance/cpu/utilization',
          alignmentPeriod: '300s',
          perSeriesAligner: 'ALIGN_MEAN',
        },
      ],
      lookbackMinutes: 180,
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

describe('GcpMonitoringConnector sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exchanges the service-account JWT for a token, then lists time series', async () => {
    const spy = installFetch((url) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return { body: { access_token: 'token-abc', expires_in: 3600 } };
      }
      return {
        body: {
          timeSeries: [
            {
              metric: {
                type: 'compute.googleapis.com/instance/cpu/utilization',
                labels: { instance_name: 'web-1' },
              },
              resource: {
                type: 'gce_instance',
                labels: { zone: 'us-central1-a' },
              },
              points: [
                {
                  interval: {
                    startTime: '2024-01-01T00:00:00Z',
                    endTime: '2024-01-01T00:05:00Z',
                  },
                  value: { doubleValue: 0.42 },
                },
                {
                  interval: { endTime: '2024-01-01T00:10:00Z' },
                  value: { doubleValue: 0.51 },
                },
              ],
            },
          ],
        },
      };
    });

    const storage = new InMemoryStorage();
    const result = await makeConnector().sync(
      { mode: 'full', since: '2024-01-01T00:00:00Z' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(result).toEqual({ done: true });

    const metrics = metricsFor(storage);
    expect(metrics.map((m) => m.value)).toEqual([0.42, 0.51]);
    expect(metrics[0]!.name).toBe(
      'compute.googleapis.com/instance/cpu/utilization',
    );
    expect(metrics[0]!.attributes).toMatchObject({
      perSeriesAligner: 'ALIGN_MEAN',
      alignmentPeriod: '300s',
      queryId: 'cpu',
      resourceType: 'gce_instance',
      'metric.instance_name': 'web-1',
      'resource.zone': 'us-central1-a',
    });

    const calls = spy.mock.calls.map(([u]) => String(u));
    expect(calls[0]).toMatch(/oauth2\.googleapis\.com\/token/);
    expect(calls[1]).toMatch(
      /monitoring\.googleapis\.com\/v3\/projects\/my-project\/timeSeries/,
    );
    const monitoringUrl = new URL(calls[1]!);
    expect(monitoringUrl.searchParams.get('filter')).toBe(
      'metric.type = "compute.googleapis.com/instance/cpu/utilization"',
    );
    expect(monitoringUrl.searchParams.get('aggregation.alignmentPeriod')).toBe(
      '300s',
    );
    expect(monitoringUrl.searchParams.get('aggregation.perSeriesAligner')).toBe(
      'ALIGN_MEAN',
    );
  });

  it('follows nextPageToken across pages', async () => {
    let call = 0;
    installFetch((url) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return { body: { access_token: 'tok', expires_in: 3600 } };
      }
      call += 1;
      if (call === 1) {
        return {
          body: {
            timeSeries: [
              {
                metric: {
                  type: 'compute.googleapis.com/instance/cpu/utilization',
                },
                points: [
                  {
                    interval: { endTime: '2024-01-01T00:05:00Z' },
                    value: { doubleValue: 1 },
                  },
                ],
              },
            ],
            nextPageToken: 'page-2',
          },
        };
      }
      return {
        body: {
          timeSeries: [
            {
              metric: {
                type: 'compute.googleapis.com/instance/cpu/utilization',
              },
              points: [
                {
                  interval: { endTime: '2024-01-01T00:10:00Z' },
                  value: { doubleValue: 2 },
                },
              ],
            },
          ],
        },
      };
    });

    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full', since: '2024-01-01T00:00:00Z' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(metricsFor(storage).map((m) => m.value)).toEqual([1, 2]);
  });

  it('appends an extra filter clause when supplied', async () => {
    const spy = installFetch((url) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return { body: { access_token: 'tok' } };
      }
      return { body: { timeSeries: [] } };
    });

    const connector = new GcpMonitoringConnector(
      {
        projectId: 'p',
        metricQueries: [
          {
            id: 'cpu',
            metricType: 'compute.googleapis.com/instance/cpu/utilization',
            filter: 'resource.labels.zone="us-central1-a"',
            alignmentPeriod: '60s',
            perSeriesAligner: 'ALIGN_MEAN',
          },
        ],
      },
      { serviceAccountJson: TEST_SA_JSON },
    );

    await connector.sync(
      { mode: 'full' },
      new InMemoryStorage().getStorageHandle(CONNECTOR_ID),
    );
    const url = new URL(
      String(
        spy.mock.calls.find(([u]) =>
          String(u).startsWith('https://monitoring.'),
        )![0],
      ),
    );
    expect(url.searchParams.get('filter')).toBe(
      'metric.type = "compute.googleapis.com/instance/cpu/utilization" AND resource.labels.zone="us-central1-a"',
    );
  });

  it('coerces int64 string values to numbers and drops non-scalars', async () => {
    installFetch((url) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return { body: { access_token: 'tok' } };
      }
      return {
        body: {
          timeSeries: [
            {
              metric: {
                type: 'compute.googleapis.com/instance/cpu/utilization',
              },
              points: [
                {
                  interval: { endTime: '2024-01-01T00:00:00Z' },
                  value: { int64Value: '42' },
                },
                {
                  interval: { endTime: '2024-01-01T00:05:00Z' },
                  value: { boolValue: true },
                },
                {
                  interval: { endTime: '2024-01-01T00:10:00Z' },
                  value: { stringValue: 'ignored' },
                },
              ],
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
    expect(metricsFor(storage).map((m) => m.value)).toEqual([42, 1]);
  });
});

describe('parseDurationSeconds', () => {
  it('parses a seconds-only duration', () => {
    expect(parseDurationSeconds('300s')).toBe(300);
  });
  it('rejects anything else', () => {
    expect(parseDurationSeconds('5m')).toBeNull();
    expect(parseDurationSeconds('300')).toBeNull();
  });
});

describe('configFields', () => {
  const baseQuery = {
    id: 'cpu',
    metricType: 'compute.googleapis.com/instance/cpu/utilization',
    alignmentPeriod: '300s',
    perSeriesAligner: 'ALIGN_MEAN' as const,
  };
  const baseConfig = {
    projectId: 'p',
    serviceAccountJson: { $secret: 'SA' },
    metricQueries: [baseQuery],
  };

  it('accepts a minimal valid config', () => {
    expect(() => configFields.parse(baseConfig)).not.toThrow();
  });

  it('rejects a query id that does not start with a lowercase letter', () => {
    expect(() =>
      configFields.parse({
        ...baseConfig,
        metricQueries: [{ ...baseQuery, id: 'BadId' }],
      }),
    ).toThrow();
  });

  it('rejects an alignmentPeriod that is not a seconds duration', () => {
    expect(() =>
      configFields.parse({
        ...baseConfig,
        metricQueries: [{ ...baseQuery, alignmentPeriod: '5m' }],
      }),
    ).toThrow();
  });

  it('rejects duplicate query ids', () => {
    expect(() =>
      configFields.parse({
        ...baseConfig,
        metricQueries: [baseQuery, baseQuery],
      }),
    ).toThrow();
  });
});
