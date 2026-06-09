import {
  type InvariantViolation,
  connectorResourceShapeViolations,
  mockJsonResponse,
  runPropertySyncTest,
  metricStoreFor as sharedMetricStoreFor,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { GooglePlayConsoleConnector } from './google-play-console';

const CONNECTOR_ID = 'google-play-console';
const PACKAGE_NAME = 'com.example.app';

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

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    GooglePlayConsoleConnector.resources,
    storage,
    connectorId,
  );

function makeConnector(): GooglePlayConsoleConnector {
  return new GooglePlayConsoleConnector(
    { packageName: PACKAGE_NAME },
    { serviceAccountJson: TEST_SA_JSON },
  );
}

function metricStoreFor(
  storage: InMemoryStorage,
): Array<{ name: string; ts: number; value: number }> {
  return sharedMetricStoreFor(storage, CONNECTOR_ID);
}

function installMetricFetchMock(
  metricSet: string,
  body: unknown,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn().mockImplementation((url: string, _init?: RequestInit) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) {
      return Promise.resolve(
        mockJsonResponse({ access_token: 'tok', expires_in: 3600 }),
      );
    }
    if (u.includes('androidpublisher.googleapis.com')) {
      return Promise.resolve(
        mockJsonResponse({ defaultLanguage: 'en-US', listings: [] }),
      );
    }
    if (u.includes(`${metricSet}:query`)) {
      const stripped = { ...(body as Record<string, unknown>) };
      delete stripped['nextPageToken'];
      return Promise.resolve(mockJsonResponse(stripped));
    }
    return Promise.resolve(mockJsonResponse({}));
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

type CrashRateSample = z.infer<
  typeof GooglePlayConsoleConnector.schemas.crash_rate
>;

describe('GooglePlayConsoleConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('crash_rate: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: CrashRateSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const rows = sample.rows ?? [];
      const samples = metricStoreFor(storage).filter(
        (m) => m.name === 'gplay_crash_rate_by_day',
      );
      if (samples.length > rows.length) {
        violations.push({
          invariant:
            'never emit more gplay_crash_rate_by_day metrics than the API returned rows',
          location: 'crash_rate phase',
          detail: `got ${samples.length} metrics for ${rows.length} rows`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: GooglePlayConsoleConnector,
      resource: 'crash_rate',
      connectorId: CONNECTOR_ID,
      runs: 30,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installMetricFetchMock('crashRateMetricSet', sample);
        await makeConnector().sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('full sync writes only documented metric resources', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        const u = String(url);
        if (u.includes('oauth2.googleapis.com/token')) {
          return Promise.resolve(
            mockJsonResponse({ access_token: 'tok', expires_in: 3600 }),
          );
        }
        if (u.includes('androidpublisher.googleapis.com')) {
          return Promise.resolve(
            mockJsonResponse({ defaultLanguage: 'en-US', listings: [] }),
          );
        }
        return Promise.resolve(
          mockJsonResponse({
            rows: [
              {
                startTime: { year: 2025, month: 1, day: 1 },
                metrics: [
                  { metric: 'crashRate', decimalValue: { value: '0.01' } },
                ],
              },
            ],
          }),
        );
      }),
    );

    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const writtenNames = new Set(metricStoreFor(storage).map((m) => m.name));
    expect(writtenNames.size).toBeGreaterThan(0);
    for (const n of writtenNames) {
      expect(
        [
          'gplay_crash_rate_by_day',
          'gplay_anr_rate_by_day',
          'gplay_ratings_by_day',
          'gplay_error_count_by_day',
        ].includes(n),
      ).toBe(true);
    }

    expect(
      connectorResourceShapeViolations(
        GooglePlayConsoleConnector.resources,
        storage,
        CONNECTOR_ID,
      ),
    ).toEqual([]);
  });
});
