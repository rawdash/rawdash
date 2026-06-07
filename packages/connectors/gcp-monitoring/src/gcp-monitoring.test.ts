import { mockResponse } from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GcpMonitoringConnector,
  configFields,
  parseDurationSeconds,
} from './gcp-monitoring';

const CONNECTOR_ID = 'gcp-monitoring';

// Generate an ephemeral PKCS8 key per test run so no private key material is
// committed. The JWT this signs is never verified by these tests; any
// well-formed RSA key works. Uses WebCrypto to match the connector runtime
// (no node: imports).
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
