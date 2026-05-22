import {
  type InvariantViolation,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { GA4Connector } from './google-analytics';

const CONNECTOR_ID = 'google-analytics';

function mockResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

function installFetchMock(
  reportBody: (
    op: string,
    body: { dimensions: Array<{ name: string }> },
  ) => unknown,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) {
      return Promise.resolve(
        mockResponse({ access_token: 'tok', expires_in: 3600 }),
      );
    }
    if (u.includes('analyticsdata.googleapis.com')) {
      const parsed = JSON.parse(String(init?.body ?? '{}')) as {
        dimensions: Array<{ name: string }>;
      };
      const firstDim = parsed.dimensions?.[0]?.name ?? '';
      return Promise.resolve(mockResponse(reportBody(firstDim, parsed)));
    }
    return Promise.resolve(mockResponse({}));
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function metricStoreFor(
  storage: InMemoryStorage,
): Array<{ name: string; ts: number; value: number }> {
  return (
    ((
      storage as unknown as { metricStore: Map<string, unknown[]> }
    ).metricStore.get(CONNECTOR_ID) as
      | Array<{ name: string; ts: number; value: number }>
      | undefined) ?? []
  );
}

function makeConnector(): GA4Connector {
  return new GA4Connector(
    { propertyId: '123456789' },
    {
      serviceAccountJson: undefined,
      refreshToken: 'rtoken' as unknown as { $secret: string },
      clientId: 'cid',
      clientSecret: 'csecret' as unknown as { $secret: string },
    },
  );
}

type TrafficByDaySample = z.infer<typeof GA4Connector.schemas.traffic_by_day>;

describe('GA4Connector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('traffic_by_day: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: TrafficByDaySample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const rows = sample.rows ?? [];
      const samples = metricStoreFor(storage).filter(
        (m) => m.name === 'ga4_traffic_by_day',
      );
      if (samples.length !== rows.length) {
        violations.push({
          invariant: 'one ga4_traffic_by_day metric per row',
          location: 'traffic_by_day phase',
          detail: `expected ${rows.length} metrics, got ${samples.length}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: GA4Connector,
      resource: 'traffic_by_day',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra],
      run: async (sample, storage) => {
        const rows = sample.rows ?? [];
        installFetchMock((firstDim) => {
          if (firstDim === 'date') {
            return { rows, rowCount: rows.length };
          }
          return { rows: [], rowCount: 0 };
        });
        await makeConnector().sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });
});
