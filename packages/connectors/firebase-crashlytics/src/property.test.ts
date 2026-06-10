import {
  type InvariantViolation,
  connectorResourceShapeViolations,
  mockJsonResponse,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';

import { FirebaseCrashlyticsConnector } from './firebase-crashlytics';

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

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    FirebaseCrashlyticsConnector.resources,
    storage,
    connectorId,
  );

function makeConnector(): FirebaseCrashlyticsConnector {
  return new FirebaseCrashlyticsConnector(
    {
      projectId: 'p',
      bqDataset: 'd',
    },
    { serviceAccountJson: TEST_SA_JSON },
  );
}

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

describe('FirebaseCrashlyticsConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('crashes_per_day: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest({
      connectorClass: FirebaseCrashlyticsConnector,
      resource: 'crashes_per_day',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installMock(sample);
        await makeConnector().sync(
          { mode: 'full', resources: new Set(['crashes_per_day']) },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('top_issues: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest({
      connectorClass: FirebaseCrashlyticsConnector,
      resource: 'top_issues',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installMock(sample);
        await makeConnector().sync(
          { mode: 'full', resources: new Set(['top_issues']) },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });
});
