import {
  type InvariantViolation,
  assertConnectorResourceShapes,
  connectorResourceShapeViolations,
  mockJsonResponse,
  runPropertySyncTest,
  metricStoreFor as sharedMetricStoreFor,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { MixpanelConnector } from './mixpanel';

const CONNECTOR_ID = 'mixpanel';

function metricStoreFor(
  storage: InMemoryStorage,
): Array<{ name: string; ts: number; value: number }> {
  return sharedMetricStoreFor(storage, CONNECTOR_ID);
}

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    MixpanelConnector.resources,
    storage,
    connectorId,
  );

function installEventsMock(
  payload: SegmentationSample,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn().mockImplementation((url: string | URL) => {
    const u = String(url);
    if (u.includes('/events')) {
      return Promise.resolve(mockJsonResponse(payload));
    }
    return Promise.resolve(
      mockJsonResponse({ data: { series: [], values: {} } }),
    );
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function makeConnector(opts: {
  event?: string;
  funnelId?: number;
  retentionEvent?: string;
}): MixpanelConnector {
  return new MixpanelConnector(
    {
      projectId: '1234567',
      events: opts.event ? [opts.event] : undefined,
      funnels: opts.funnelId ? [{ id: opts.funnelId }] : undefined,
      retentionEvent: opts.retentionEvent,
      activeUserEvent: opts.event,
    },
    {
      username: 'svc',
      secret: 'svc-secret' as unknown as { $secret: string },
    },
  );
}

type SegmentationSample = z.infer<typeof MixpanelConnector.schemas.dau>;
type FunnelSample = z.infer<typeof MixpanelConnector.schemas.funnel_results>;
type RetentionSample = z.infer<typeof MixpanelConnector.schemas.retention>;

describe('MixpanelConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dau: writes one metric per unique date in the values map', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: SegmentationSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const uniqueDates = new Set<string>();
      for (const series of Object.values(sample.data.values)) {
        for (const date of Object.keys(series)) {
          uniqueDates.add(date);
        }
      }
      const dauSamples = metricStoreFor(storage).filter(
        (m) => m.name === 'mixpanel_dau',
      );
      if (dauSamples.length !== uniqueDates.size) {
        violations.push({
          invariant: 'one mixpanel_dau sample per unique date',
          location: 'dau phase',
          detail: `expected ${uniqueDates.size}, got ${dauSamples.length}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest<SegmentationSample>({
      connectorClass: MixpanelConnector,
      resource: 'dau',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installEventsMock(sample);
        await makeConnector({ event: 'Signed Up' }).sync(
          {
            mode: 'full',
            resources: new Set(['mixpanel_dau']),
          },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('funnel_results: writes one metric per (date, step)', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: FunnelSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      let expected = 0;
      for (const bucket of Object.values(sample.data)) {
        expected += bucket.steps.length;
      }
      const written = metricStoreFor(storage).filter(
        (m) => m.name === 'mixpanel_funnel_results',
      ).length;
      if (written !== expected) {
        violations.push({
          invariant: 'one funnel sample per (date, step)',
          location: 'funnel_results phase',
          detail: `expected ${expected}, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest<FunnelSample>({
      connectorClass: MixpanelConnector,
      resource: 'funnel_results',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        const spy = vi.fn().mockImplementation((url: string | URL) => {
          if (String(url).includes('/funnels')) {
            return Promise.resolve(mockJsonResponse(sample));
          }
          return Promise.resolve(
            mockJsonResponse({ data: { series: [], values: {} } }),
          );
        });
        vi.stubGlobal('fetch', spy);
        await makeConnector({ funnelId: 42 }).sync(
          {
            mode: 'full',
            resources: new Set(['mixpanel_funnel_results']),
          },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('retention: writes one metric per (cohort, period)', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: RetentionSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      let expected = 0;
      for (const cohort of Object.values(sample)) {
        expected += cohort.counts.length;
      }
      const written = metricStoreFor(storage).filter(
        (m) => m.name === 'mixpanel_retention',
      ).length;
      if (written !== expected) {
        violations.push({
          invariant: 'one retention sample per (cohort, period)',
          location: 'retention phase',
          detail: `expected ${expected}, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest<RetentionSample>({
      connectorClass: MixpanelConnector,
      resource: 'retention',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        const spy = vi.fn().mockImplementation((url: string | URL) => {
          if (String(url).includes('/retention')) {
            return Promise.resolve(mockJsonResponse(sample));
          }
          return Promise.resolve(
            mockJsonResponse({ data: { series: [], values: {} } }),
          );
        });
        vi.stubGlobal('fetch', spy);
        await makeConnector({ retentionEvent: 'Signed Up' }).sync(
          {
            mode: 'full',
            resources: new Set(['mixpanel_retention']),
          },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('full sync: every written metric matches its documented shape', async () => {
    const segmentation: SegmentationSample = {
      data: {
        series: ['2024-01-01'],
        values: { 'Signed Up': { '2024-01-01': 5 } },
      },
    };
    const funnel: FunnelSample = {
      meta: { dates: ['2024-01-01'] },
      data: {
        '2024-01-01': {
          steps: [
            { step_label: 'Step 1', count: 10, overall_conv_ratio: 1 },
            { step_label: 'Step 2', count: 4, overall_conv_ratio: 0.4 },
          ],
        },
      },
    };
    const retention: RetentionSample = {
      '2024-01-01': { first: 10, counts: [10, 6, 3] },
    };

    const spy = vi.fn().mockImplementation((url: string | URL) => {
      const u = String(url);
      if (u.includes('/funnels')) {
        return Promise.resolve(mockJsonResponse(funnel));
      }
      if (u.includes('/retention')) {
        return Promise.resolve(mockJsonResponse(retention));
      }
      return Promise.resolve(mockJsonResponse(segmentation));
    });
    vi.stubGlobal('fetch', spy);

    const connector = new MixpanelConnector(
      {
        projectId: '1234567',
        events: ['Signed Up'],
        activeUserEvent: 'Signed Up',
        funnels: [{ id: 42, name: 'Signup → Purchase' }],
        retentionEvent: 'Signed Up',
      },
      {
        username: 'svc',
        secret: 'svc-secret' as unknown as { $secret: string },
      },
    );

    const storage = new InMemoryStorage();
    await connector.sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const names = new Set(metricStoreFor(storage).map((m) => m.name));
    expect(names).toEqual(
      new Set([
        'mixpanel_dau',
        'mixpanel_wau',
        'mixpanel_mau',
        'mixpanel_events_per_day',
        'mixpanel_funnel_results',
        'mixpanel_retention',
      ]),
    );
    assertConnectorResourceShapes(
      MixpanelConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
