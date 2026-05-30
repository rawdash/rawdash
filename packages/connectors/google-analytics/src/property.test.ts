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

import { GA4Connector } from './google-analytics';

const CONNECTOR_ID = 'google-analytics';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    GA4Connector.resources,
    storage,
    connectorId,
  );

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
        mockJsonResponse({ access_token: 'tok', expires_in: 3600 }),
      );
    }
    if (u.includes('analyticsdata.googleapis.com')) {
      const parsed = JSON.parse(String(init?.body ?? '{}')) as {
        dimensions: Array<{ name: string }>;
      };
      const firstDim = parsed.dimensions?.[0]?.name ?? '';
      return Promise.resolve(mockJsonResponse(reportBody(firstDim, parsed)));
    }
    return Promise.resolve(mockJsonResponse({}));
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function metricStoreFor(
  storage: InMemoryStorage,
): Array<{ name: string; ts: number; value: number }> {
  return sharedMetricStoreFor(storage, CONNECTOR_ID);
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
      extraInvariants: [extra, docShapeExtra],
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

  it('full sync writes only documented metric resources', async () => {
    installFetchMock((_firstDim, body) => {
      const dimensions = body.dimensions ?? [];
      const parsed = body as unknown as {
        dimensions: Array<{ name: string }>;
        metrics?: Array<{ name: string }>;
      };
      const metrics = parsed.metrics ?? [];
      return {
        rows: [
          {
            dimensionValues: dimensions.map((d) => ({
              value: d.name === 'date' ? '20250101' : 'sample',
            })),
            metricValues: metrics.map(() => ({ value: '1' })),
          },
        ],
        rowCount: 1,
        dimensionHeaders: dimensions.map((d) => ({ name: d.name })),
        metricHeaders: metrics.map((m) => ({
          name: m.name,
          type: 'TYPE_INTEGER',
        })),
      };
    });

    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const writtenNames = new Set(metricStoreFor(storage).map((m) => m.name));
    expect(writtenNames).toEqual(
      new Set([
        'ga4_traffic_by_day',
        'ga4_traffic_by_source',
        'ga4_top_pages',
        'ga4_events',
        'ga4_conversions',
        'ga4_geo',
      ]),
    );

    expect(
      connectorResourceShapeViolations(
        GA4Connector.resources,
        storage,
        CONNECTOR_ID,
      ),
    ).toEqual([]);
  });
});
