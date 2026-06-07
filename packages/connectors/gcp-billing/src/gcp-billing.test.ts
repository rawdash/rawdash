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
    const bqBodies: Array<Record<string, unknown>> = [];
    installFetch((url, init) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return { body: { access_token: 'tok' } };
      }
      bqBodies.push(JSON.parse(String(init.body)));
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
    expect(bqBodies[1]).toMatchObject({ pageToken: 'next-page' });
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

  it('throws instead of persisting when the query does not complete', async () => {
    installFetch((url) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return { body: { access_token: 'tok' } };
      }
      return {
        body: {
          jobComplete: false,
          jobReference: { projectId: 'my-billing-project', jobId: 'job-1' },
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

  it('rejects a bqDataset containing a dash', () => {
    expect(() =>
      configFields.parse({ ...base, bqDataset: 'billing-export' }),
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

  it('rejects a groupBy with duplicate dimensions', () => {
    expect(() =>
      configFields.parse({ ...base, groupBy: ['service', 'service'] }),
    ).toThrow();
  });
});
