import { mockResponse } from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ERRORS_METRIC_NAME,
  INVOCATIONS_METRIC_NAME,
  SPEND_METRIC_NAME,
  TOKENS_METRIC_NAME,
  VertexAiConnector,
  buildVertexSpendSql,
  configFields,
  getMonitoringWindow,
  getSpendWindow,
} from './vertex-ai';

const CONNECTOR_ID = 'vertex-ai';

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
    bqProject: string | undefined;
    bqDataset: string | undefined;
  }> = {},
): VertexAiConnector {
  return new VertexAiConnector(
    {
      projectId: 'my-project',
      bqProject: 'bqProject' in overrides ? overrides.bqProject : 'my-billing',
      bqDataset:
        'bqDataset' in overrides ? overrides.bqDataset : 'billing_export',
      bqLocation: 'US',
      lookbackDays: 30,
    },
    { serviceAccountJson: TEST_SA_JSON },
  );
}

function metricsFor(
  storage: InMemoryStorage,
  name?: string,
): Array<{
  name: string;
  ts: number;
  value: number;
  attributes: Record<string, unknown>;
}> {
  const all =
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
    ).metricStore.get(CONNECTOR_ID) ?? [];
  return name === undefined ? all : all.filter((m) => m.name === name);
}

const INVOCATIONS_TIMESERIES = {
  timeSeries: [
    {
      metric: {
        type: 'aiplatform.googleapis.com/publisher/online_serving/model_invocation_count',
        labels: { model_user_id: 'gemini-pro', response_code: '200' },
      },
      points: [
        {
          interval: {
            startTime: '2024-01-01T00:00:00Z',
            endTime: '2024-01-02T00:00:00Z',
          },
          value: { int64Value: '12' },
        },
        {
          interval: {
            startTime: '2024-01-02T00:00:00Z',
            endTime: '2024-01-03T00:00:00Z',
          },
          value: { int64Value: '8' },
        },
      ],
    },
    {
      metric: {
        type: 'aiplatform.googleapis.com/publisher/online_serving/model_invocation_count',
        labels: { model_user_id: 'gemini-pro', response_code: '429' },
      },
      points: [
        {
          interval: {
            startTime: '2024-01-01T00:00:00Z',
            endTime: '2024-01-02T00:00:00Z',
          },
          value: { int64Value: '3' },
        },
      ],
    },
  ],
};

const TOKENS_TIMESERIES = {
  timeSeries: [
    {
      metric: {
        type: 'aiplatform.googleapis.com/publisher/online_serving/token_count',
        labels: { model_user_id: 'gemini-pro', type: 'input' },
      },
      points: [
        {
          interval: {
            startTime: '2024-01-01T00:00:00Z',
            endTime: '2024-01-02T00:00:00Z',
          },
          value: { int64Value: '1500' },
        },
      ],
    },
    {
      metric: {
        type: 'aiplatform.googleapis.com/publisher/online_serving/token_count',
        labels: { model_user_id: 'gemini-pro', type: 'output' },
      },
      points: [
        {
          interval: {
            startTime: '2024-01-01T00:00:00Z',
            endTime: '2024-01-02T00:00:00Z',
          },
          value: { int64Value: '420' },
        },
      ],
    },
  ],
};

const SPEND_BQ_RESPONSE = {
  jobComplete: true,
  schema: {
    fields: [
      { name: 'date', type: 'DATE' },
      { name: 'service', type: 'STRING' },
      { name: 'sku', type: 'STRING' },
      { name: 'cost', type: 'NUMERIC' },
      { name: 'currency', type: 'STRING' },
    ],
  },
  rows: [
    {
      f: [
        { v: '2024-01-02' },
        { v: 'Vertex AI' },
        { v: 'Gemini 1.5 Pro Online Inference - Input Tokens' },
        { v: '4.20' },
        { v: 'USD' },
      ],
    },
    {
      f: [
        { v: '2024-01-02' },
        { v: 'Vertex AI' },
        { v: 'Gemini 1.5 Pro Online Inference - Output Tokens' },
        { v: '1.13' },
        { v: 'USD' },
      ],
    },
  ],
};

describe('VertexAiConnector sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exchanges the JWT for a token, then syncs invocations, tokens, and spend', async () => {
    const calls: string[] = [];
    installFetch((url) => {
      calls.push(url);
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return { body: { access_token: 'token-abc', expires_in: 3600 } };
      }
      if (url.includes('aiplatform.googleapis.com/publisher')) {
        // Should not happen — we hit monitoring, not Vertex AI directly.
        throw new Error('unexpected URL: ' + url);
      }
      if (url.includes('monitoring.googleapis.com')) {
        if (url.includes('model_invocation_count')) {
          return { body: INVOCATIONS_TIMESERIES };
        }
        if (url.includes('token_count')) {
          return { body: TOKENS_TIMESERIES };
        }
      }
      if (url.includes('bigquery.googleapis.com')) {
        return { body: SPEND_BQ_RESPONSE };
      }
      throw new Error('unexpected URL: ' + url);
    });

    const storage = new InMemoryStorage();
    const result = await makeConnector().sync(
      { mode: 'full', since: '2024-01-01T00:00:00Z' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(result).toEqual({ done: true });

    const invocations = metricsFor(storage, INVOCATIONS_METRIC_NAME);
    expect(invocations.map((m) => m.value)).toEqual([12, 8]);
    expect(invocations[0]!.attributes).toMatchObject({
      modelId: 'gemini-pro',
      responseCode: '200',
    });
    expect(invocations[0]!.ts).toBe(Date.UTC(2024, 0, 1));

    const errors = metricsFor(storage, ERRORS_METRIC_NAME);
    expect(errors.map((m) => m.value)).toEqual([3]);
    expect(errors[0]!.attributes).toMatchObject({
      modelId: 'gemini-pro',
      errorType: '429',
    });

    const tokens = metricsFor(storage, TOKENS_METRIC_NAME);
    expect(tokens.map((m) => m.value)).toEqual([1500, 420]);
    expect(tokens.map((m) => m.attributes['tokenType'])).toEqual([
      'input',
      'output',
    ]);

    const spend = metricsFor(storage, SPEND_METRIC_NAME);
    expect(spend.map((m) => m.value)).toEqual([4.2, 1.13]);
    expect(spend[0]!.attributes).toMatchObject({
      service: 'Vertex AI',
      sku: 'Gemini 1.5 Pro Online Inference - Input Tokens',
      currency: 'USD',
    });

    // Confirm we hit the two monitoring URLs and one BigQuery URL.
    const monitoringCalls = calls.filter((u) =>
      u.includes('monitoring.googleapis.com'),
    );
    expect(monitoringCalls).toHaveLength(2);
    expect(monitoringCalls[0]).toContain('model_invocation_count');
    expect(monitoringCalls[1]).toContain('token_count');

    const monitoringUrl = new URL(monitoringCalls[0]!);
    expect(monitoringUrl.searchParams.get('aggregation.alignmentPeriod')).toBe(
      '86400s',
    );
    expect(monitoringUrl.searchParams.get('aggregation.perSeriesAligner')).toBe(
      'ALIGN_SUM',
    );
    expect(
      monitoringUrl.searchParams.getAll('aggregation.groupByFields'),
    ).toEqual(['metric.labels.model_user_id', 'metric.labels.response_code']);
  });

  it('preserves history outside the incremental window on a latest sync', async () => {
    installFetch((url) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return { body: { access_token: 'tok' } };
      }
      if (url.includes('monitoring.googleapis.com')) {
        return { body: { timeSeries: [] } };
      }
      if (url.includes('bigquery.googleapis.com')) {
        return {
          body: { jobComplete: true, schema: { fields: [] }, rows: [] },
        };
      }
      throw new Error('unexpected URL: ' + url);
    });

    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle(CONNECTOR_ID);

    const oldTs = Date.now() - 60 * 24 * 60 * 60 * 1000;
    await handle.metrics([
      {
        name: INVOCATIONS_METRIC_NAME,
        ts: oldTs,
        value: 99,
        attributes: { modelId: 'gemini-pro', responseCode: '200' },
      },
      {
        name: TOKENS_METRIC_NAME,
        ts: oldTs,
        value: 77,
        attributes: { modelId: 'gemini-pro', tokenType: 'input' },
      },
      {
        name: SPEND_METRIC_NAME,
        ts: oldTs,
        value: 5.5,
        attributes: { sku: 'sku-x', service: 'Vertex AI', currency: 'USD' },
      },
    ]);

    const result = await makeConnector().sync({ mode: 'latest' }, handle);
    expect(result).toEqual({ done: true });

    const survivingInvocations = await handle.queryMetrics({
      name: INVOCATIONS_METRIC_NAME,
    });
    expect(survivingInvocations.map((m) => m.value)).toContain(99);

    const survivingTokens = await handle.queryMetrics({
      name: TOKENS_METRIC_NAME,
    });
    expect(survivingTokens.map((m) => m.value)).toContain(77);

    const survivingSpend = await handle.queryMetrics({
      name: SPEND_METRIC_NAME,
    });
    expect(survivingSpend.map((m) => m.value)).toContain(5.5);
  });

  it('skips the spend phase when bqProject is not configured', async () => {
    const calls: string[] = [];
    installFetch((url) => {
      calls.push(url);
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return { body: { access_token: 'tok' } };
      }
      if (url.includes('monitoring.googleapis.com')) {
        if (url.includes('model_invocation_count')) {
          return { body: INVOCATIONS_TIMESERIES };
        }
        return { body: TOKENS_TIMESERIES };
      }
      throw new Error('unexpected URL: ' + url);
    });

    const storage = new InMemoryStorage();
    const result = await makeConnector({
      bqProject: undefined,
      bqDataset: undefined,
    }).sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
    expect(result).toEqual({ done: true });
    expect(metricsFor(storage, SPEND_METRIC_NAME)).toHaveLength(0);
    expect(metricsFor(storage, INVOCATIONS_METRIC_NAME).length).toBeGreaterThan(
      0,
    );
    expect(calls.some((u) => u.includes('bigquery.googleapis.com'))).toBe(
      false,
    );
  });

  it('skips the spend phase when only bqProject is configured (no bqDataset)', async () => {
    const calls: string[] = [];
    installFetch((url) => {
      calls.push(url);
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return { body: { access_token: 'tok' } };
      }
      if (url.includes('monitoring.googleapis.com')) {
        if (url.includes('model_invocation_count')) {
          return { body: INVOCATIONS_TIMESERIES };
        }
        return { body: TOKENS_TIMESERIES };
      }
      throw new Error('unexpected URL: ' + url);
    });

    const storage = new InMemoryStorage();
    const result = await makeConnector({ bqDataset: undefined }).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(result).toEqual({ done: true });
    expect(metricsFor(storage, SPEND_METRIC_NAME)).toHaveLength(0);
    expect(metricsFor(storage, INVOCATIONS_METRIC_NAME).length).toBeGreaterThan(
      0,
    );
    expect(calls.some((u) => u.includes('bigquery.googleapis.com'))).toBe(
      false,
    );
  });

  it('skips the spend phase when only bqDataset is configured (no bqProject)', async () => {
    const calls: string[] = [];
    installFetch((url) => {
      calls.push(url);
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return { body: { access_token: 'tok' } };
      }
      if (url.includes('monitoring.googleapis.com')) {
        if (url.includes('model_invocation_count')) {
          return { body: INVOCATIONS_TIMESERIES };
        }
        return { body: TOKENS_TIMESERIES };
      }
      throw new Error('unexpected URL: ' + url);
    });

    const storage = new InMemoryStorage();
    const result = await makeConnector({ bqProject: undefined }).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(result).toEqual({ done: true });
    expect(metricsFor(storage, SPEND_METRIC_NAME)).toHaveLength(0);
    expect(metricsFor(storage, INVOCATIONS_METRIC_NAME).length).toBeGreaterThan(
      0,
    );
    expect(calls.some((u) => u.includes('bigquery.googleapis.com'))).toBe(
      false,
    );
  });

  it('resumes from a cursor at the tokens phase, skipping invocations', async () => {
    const calls: string[] = [];
    installFetch((url) => {
      calls.push(url);
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return { body: { access_token: 'tok' } };
      }
      if (url.includes('monitoring.googleapis.com')) {
        return { body: TOKENS_TIMESERIES };
      }
      if (url.includes('bigquery.googleapis.com')) {
        return {
          body: { jobComplete: true, schema: { fields: [] }, rows: [] },
        };
      }
      throw new Error('unexpected URL: ' + url);
    });

    const storage = new InMemoryStorage();
    const result = await makeConnector().sync(
      { mode: 'full', cursor: { phase: 'tokens', page: null } },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(result).toEqual({ done: true });
    expect(metricsFor(storage, INVOCATIONS_METRIC_NAME)).toHaveLength(0);
    expect(metricsFor(storage, TOKENS_METRIC_NAME).length).toBeGreaterThan(0);
    expect(calls.some((u) => u.includes('model_invocation_count'))).toBe(false);
  });

  it('resumes from a cursor at the spend phase, skipping invocations and tokens', async () => {
    const calls: string[] = [];
    installFetch((url) => {
      calls.push(url);
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return { body: { access_token: 'tok' } };
      }
      if (url.includes('bigquery.googleapis.com')) {
        return { body: SPEND_BQ_RESPONSE };
      }
      throw new Error('unexpected URL: ' + url);
    });

    const storage = new InMemoryStorage();
    const result = await makeConnector().sync(
      { mode: 'full', cursor: { phase: 'spend', page: null } },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(result).toEqual({ done: true });
    expect(metricsFor(storage, INVOCATIONS_METRIC_NAME)).toHaveLength(0);
    expect(metricsFor(storage, TOKENS_METRIC_NAME)).toHaveLength(0);
    expect(metricsFor(storage, SPEND_METRIC_NAME).length).toBeGreaterThan(0);
    expect(calls.some((u) => u.includes('monitoring.googleapis.com'))).toBe(
      false,
    );
  });

  it('honors options.resources by skipping phases whose resources are not requested', async () => {
    const calls: string[] = [];
    installFetch((url) => {
      calls.push(url);
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return { body: { access_token: 'tok' } };
      }
      if (url.includes('monitoring.googleapis.com')) {
        return { body: TOKENS_TIMESERIES };
      }
      throw new Error('unexpected URL: ' + url);
    });

    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full', resources: new Set([TOKENS_METRIC_NAME]) },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(metricsFor(storage, TOKENS_METRIC_NAME).length).toBeGreaterThan(0);
    expect(metricsFor(storage, INVOCATIONS_METRIC_NAME)).toHaveLength(0);
    expect(calls.some((u) => u.includes('model_invocation_count'))).toBe(false);
    expect(calls.some((u) => u.includes('bigquery.googleapis.com'))).toBe(
      false,
    );
  });

  it('follows nextPageToken across pages on the invocations resource', async () => {
    let call = 0;
    installFetch((url) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return { body: { access_token: 'tok' } };
      }
      if (url.includes('model_invocation_count')) {
        call += 1;
        if (call === 1) {
          return {
            body: {
              timeSeries: [
                {
                  metric: {
                    type: 'aiplatform.googleapis.com/publisher/online_serving/model_invocation_count',
                    labels: {
                      model_user_id: 'gemini-pro',
                      response_code: '200',
                    },
                  },
                  points: [
                    {
                      interval: { endTime: '2024-01-02T00:00:00Z' },
                      value: { int64Value: '1' },
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
                  type: 'aiplatform.googleapis.com/publisher/online_serving/model_invocation_count',
                  labels: { model_user_id: 'gemini-pro', response_code: '200' },
                },
                points: [
                  {
                    interval: { endTime: '2024-01-03T00:00:00Z' },
                    value: { int64Value: '2' },
                  },
                ],
              },
            ],
          },
        };
      }
      // Tokens + spend should return empty data — only invocations matter for this test.
      if (url.includes('token_count')) {
        return { body: { timeSeries: [] } };
      }
      if (url.includes('bigquery.googleapis.com')) {
        return {
          body: { jobComplete: true, schema: { fields: [] }, rows: [] },
        };
      }
      throw new Error('unexpected URL: ' + url);
    });

    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(
      metricsFor(storage, INVOCATIONS_METRIC_NAME).map((m) => m.value),
    ).toEqual([1, 2]);
  });
});

describe('buildVertexSpendSql', () => {
  it('produces a daily group-by-sku query against the billing export wildcard table', () => {
    const sql = buildVertexSpendSql({
      bqProject: 'p',
      bqDataset: 'd',
      startDate: '2024-01-01',
      endDate: '2024-02-01',
      serviceFilter: 'Vertex AI%',
    });
    expect(sql).toContain('sku.description AS sku');
    expect(sql).toContain('service.description AS service');
    expect(sql).toContain('SUM(cost) AS cost');
    expect(sql).toContain('`p.d.gcp_billing_export_v1_*`');
    expect(sql).toContain("DATE('2024-01-01')");
    expect(sql).toContain("DATE('2024-02-01')");
    expect(sql).toContain("service.description LIKE 'Vertex AI%'");
    expect(sql).toContain('GROUP BY date, service, sku');
  });

  it('escapes single quotes in the service filter', () => {
    const sql = buildVertexSpendSql({
      bqProject: 'p',
      bqDataset: 'd',
      startDate: '2024-01-01',
      endDate: '2024-02-01',
      serviceFilter: "Vertex'AI",
    });
    expect(sql).toContain("LIKE 'Vertex\\'AI'");
  });
});

describe('getMonitoringWindow', () => {
  const now = Date.UTC(2024, 0, 31, 12, 0, 0);

  it('uses the full lookback for a full sync', () => {
    expect(getMonitoringWindow({ mode: 'full' }, 30, now)).toEqual({
      startMs: Date.UTC(2024, 0, 2),
      endMs: Date.UTC(2024, 1, 1),
    });
  });

  it('clamps to a short refetch window in latest mode', () => {
    expect(getMonitoringWindow({ mode: 'latest' }, 30, now)).toEqual({
      startMs: Date.UTC(2024, 0, 27),
      endMs: Date.UTC(2024, 1, 1),
    });
  });
});

describe('getSpendWindow', () => {
  const now = Date.UTC(2024, 0, 31, 12, 0, 0);

  it('uses the full lookback for a full sync', () => {
    expect(getSpendWindow({ mode: 'full' }, 30, now)).toEqual({
      startDate: '2024-01-02',
      endDate: '2024-02-01',
      startMs: Date.UTC(2024, 0, 2),
      endMs: Date.UTC(2024, 1, 1),
    });
  });

  it('clamps to a short refetch window in latest mode', () => {
    expect(getSpendWindow({ mode: 'latest' }, 90, now)).toEqual({
      startDate: '2024-01-27',
      endDate: '2024-02-01',
      startMs: Date.UTC(2024, 0, 27),
      endMs: Date.UTC(2024, 1, 1),
    });
  });
});

describe('configFields', () => {
  const base = {
    projectId: 'p',
    serviceAccountJson: { $secret: 'GCP_SA' },
  };

  it('accepts a minimal valid config', () => {
    expect(() => configFields.parse(base)).not.toThrow();
  });

  it('accepts a config with BigQuery billing settings', () => {
    expect(() =>
      configFields.parse({
        ...base,
        bqProject: 'b',
        bqDataset: 'export',
      }),
    ).not.toThrow();
  });

  it('rejects an invalid projectId', () => {
    expect(() =>
      configFields.parse({ ...base, projectId: 'has spaces' }),
    ).toThrow();
  });

  it('rejects a bqDataset containing a dash', () => {
    expect(() =>
      configFields.parse({
        ...base,
        bqProject: 'b',
        bqDataset: 'billing-export',
      }),
    ).toThrow();
  });

  it('rejects a config with bqProject but no bqDataset', () => {
    expect(() => configFields.parse({ ...base, bqProject: 'b' })).toThrow();
  });

  it('rejects a config with bqDataset but no bqProject', () => {
    expect(() =>
      configFields.parse({ ...base, bqDataset: 'export' }),
    ).toThrow();
  });

  it('rejects a non-positive lookbackDays', () => {
    expect(() => configFields.parse({ ...base, lookbackDays: 0 })).toThrow();
  });
});
