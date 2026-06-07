import {
  type InvariantViolation,
  connectorResourceShapeViolations,
  mockJsonResponse,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';

import { GcpMonitoringConnector } from './gcp-monitoring';

const CONNECTOR_ID = 'gcp-monitoring';
const METRIC_TYPE = 'compute.googleapis.com/instance/cpu/utilization';

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

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    GcpMonitoringConnector.resources,
    storage,
    connectorId,
  );

function makeConnector(): GcpMonitoringConnector {
  return new GcpMonitoringConnector(
    {
      projectId: 'my-project',
      metricQueries: [
        {
          id: 'cpu',
          metricType: METRIC_TYPE,
          alignmentPeriod: '300s',
          perSeriesAligner: 'ALIGN_MEAN',
        },
      ],
    },
    { serviceAccountJson: TEST_SA_JSON },
  );
}

// Return the fuzzed time_series payload (with nextPageToken stripped so
// pagination terminates), but force every series under the configured query's
// metric type so connector.sync can match by name without filtering.
function installMock(sample: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.startsWith('https://oauth2.googleapis.com/token')) {
        return Promise.resolve(
          mockJsonResponse({ access_token: 'tok', expires_in: 3600 }),
        );
      }
      const body = { ...(sample as Record<string, unknown>) };
      delete body['nextPageToken'];
      const series = (body['timeSeries'] as unknown[] | undefined) ?? [];
      body['timeSeries'] = series.map((s) => ({
        ...(s as Record<string, unknown>),
        metric: {
          ...(((s as Record<string, unknown>).metric as Record<
            string,
            unknown
          >) ?? {}),
          type: METRIC_TYPE,
        },
      }));
      return Promise.resolve(mockJsonResponse(body));
    }),
  );
}

describe('GcpMonitoringConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('time_series: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest({
      connectorClass: GcpMonitoringConnector,
      resource: 'time_series',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installMock(sample);
        await makeConnector().sync(
          { mode: 'full', since: '2024-01-01T00:00:00Z' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });
});
