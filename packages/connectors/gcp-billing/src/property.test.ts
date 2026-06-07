import {
  type InvariantViolation,
  connectorResourceShapeViolations,
  mockJsonResponse,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';

import { GcpBillingConnector } from './gcp-billing';

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

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    GcpBillingConnector.resources,
    storage,
    connectorId,
  );

function makeConnector(): GcpBillingConnector {
  return new GcpBillingConnector(
    {
      bqProject: 'p',
      bqDataset: 'd',
      groupBy: ['service'],
    },
    { serviceAccountJson: TEST_SA_JSON },
  );
}

// Return the fuzzed BigQuery response. pageToken is stripped so pagination
// terminates after a single page, and jobComplete is pinned true: both are
// query control-flow signals rather than data shape (a jobComplete:false
// payload means the query timed out, which sync rejects by design). The schema
// fuzzer drives every field type so any rows that don't include the required
// 'date'/'cost' fields just yield zero samples — still a valid sync, still
// invariants-clean.
function installMock(sample: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
        return Promise.resolve(
          mockJsonResponse({ access_token: 'tok', expires_in: 3600 }),
        );
      }
      const body = { ...(sample as Record<string, unknown>) };
      delete body['pageToken'];
      body['jobComplete'] = true;
      return Promise.resolve(mockJsonResponse(body));
    }),
  );
}

describe('GcpBillingConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('daily_cost: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest({
      connectorClass: GcpBillingConnector,
      resource: 'daily_cost',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installMock(sample);
        await makeConnector().sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });
});
