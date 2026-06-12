import {
  type InvariantViolation,
  assertConnectorResourceShapes,
  connectorResourceShapeViolations,
  mockJsonResponse,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VertexAiConnector } from './vertex-ai';

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

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    VertexAiConnector.resources,
    storage,
    connectorId,
  );

function makeConnector(): VertexAiConnector {
  return new VertexAiConnector(
    {
      projectId: 'my-project',
      bqProject: 'my-billing',
      bqDataset: 'billing_export',
      bqLocation: 'US',
      lookbackDays: 30,
    },
    { serviceAccountJson: TEST_SA_JSON },
  );
}

function installInvocationsMock(sample: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.startsWith('https://oauth2.googleapis.com/token')) {
        return Promise.resolve(
          mockJsonResponse({ access_token: 'tok', expires_in: 3600 }),
        );
      }
      if (u.includes('model_invocation_count')) {
        const body = { ...(sample as Record<string, unknown>) };
        delete body['nextPageToken'];
        const series = (body['timeSeries'] as unknown[] | undefined) ?? [];
        body['timeSeries'] = series.map((s) => {
          const item = s as Record<string, unknown>;
          const metric = (item.metric as Record<string, unknown>) ?? {};
          return {
            ...item,
            metric: {
              ...metric,
              type: 'aiplatform.googleapis.com/publisher/online_serving/model_invocation_count',
              labels: {
                model_user_id: 'gemini-pro',
                response_code: '200',
                ...((metric.labels as Record<string, string> | undefined) ??
                  {}),
              },
            },
          };
        });
        return Promise.resolve(mockJsonResponse(body));
      }
      if (u.includes('token_count')) {
        return Promise.resolve(mockJsonResponse({ timeSeries: [] }));
      }
      if (u.includes('bigquery.googleapis.com')) {
        return Promise.resolve(
          mockJsonResponse({
            jobComplete: true,
            schema: { fields: [] },
            rows: [],
          }),
        );
      }
      return Promise.resolve(mockJsonResponse({}));
    }),
  );
}

function installTokensMock(sample: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.startsWith('https://oauth2.googleapis.com/token')) {
        return Promise.resolve(
          mockJsonResponse({ access_token: 'tok', expires_in: 3600 }),
        );
      }
      if (u.includes('token_count')) {
        const body = { ...(sample as Record<string, unknown>) };
        delete body['nextPageToken'];
        const series = (body['timeSeries'] as unknown[] | undefined) ?? [];
        body['timeSeries'] = series.map((s) => {
          const item = s as Record<string, unknown>;
          const metric = (item.metric as Record<string, unknown>) ?? {};
          return {
            ...item,
            metric: {
              ...metric,
              type: 'aiplatform.googleapis.com/publisher/online_serving/token_count',
              labels: {
                model_user_id: 'gemini-pro',
                type: 'input',
                ...((metric.labels as Record<string, string> | undefined) ??
                  {}),
              },
            },
          };
        });
        return Promise.resolve(mockJsonResponse(body));
      }
      if (u.includes('model_invocation_count')) {
        return Promise.resolve(mockJsonResponse({ timeSeries: [] }));
      }
      if (u.includes('bigquery.googleapis.com')) {
        return Promise.resolve(
          mockJsonResponse({
            jobComplete: true,
            schema: { fields: [] },
            rows: [],
          }),
        );
      }
      return Promise.resolve(mockJsonResponse({}));
    }),
  );
}

function installSpendMock(sample: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.startsWith('https://oauth2.googleapis.com/token')) {
        return Promise.resolve(
          mockJsonResponse({ access_token: 'tok', expires_in: 3600 }),
        );
      }
      if (u.includes('monitoring.googleapis.com')) {
        return Promise.resolve(mockJsonResponse({ timeSeries: [] }));
      }
      if (u.includes('bigquery.googleapis.com')) {
        const body = { ...(sample as Record<string, unknown>) };
        // jobComplete must be true so the run does not error.
        body['jobComplete'] = true;
        delete body['pageToken'];
        return Promise.resolve(mockJsonResponse(body));
      }
      return Promise.resolve(mockJsonResponse({}));
    }),
  );
}

describe('VertexAiConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('invocations: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest({
      connectorClass: VertexAiConnector,
      resource: 'invocations',
      connectorId: CONNECTOR_ID,
      runs: 30,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installInvocationsMock(sample);
        await makeConnector().sync(
          { mode: 'full', since: '2024-01-01T00:00:00Z' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('tokens: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest({
      connectorClass: VertexAiConnector,
      resource: 'tokens',
      connectorId: CONNECTOR_ID,
      runs: 30,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installTokensMock(sample);
        await makeConnector().sync(
          { mode: 'full', since: '2024-01-01T00:00:00Z' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('spend: sync upholds universal invariants for any valid BigQuery response', async () => {
    await runPropertySyncTest({
      connectorClass: VertexAiConnector,
      resource: 'spend',
      connectorId: CONNECTOR_ID,
      runs: 30,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installSpendMock(sample);
        await makeConnector().sync(
          { mode: 'full', since: '2024-01-01T00:00:00Z' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('full sync writes only resources declared in static resources', async () => {
    installInvocationsMock({ timeSeries: [] });
    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full', since: '2024-01-01T00:00:00Z' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(() =>
      assertConnectorResourceShapes(
        VertexAiConnector.resources,
        storage,
        CONNECTOR_ID,
      ),
    ).not.toThrow();
  });
});
