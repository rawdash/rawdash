import {
  type InvariantViolation,
  entityStoreFor,
  installFetchMock,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { DatadogConnector } from './datadog';

const CONNECTOR_ID = 'datadog';

type MonitorsSample = z.infer<typeof DatadogConnector.schemas.monitors>;
type IncidentsSample = z.infer<typeof DatadogConnector.schemas.incidents>;
type SlosSample = z.infer<typeof DatadogConnector.schemas.slos>;

describe('DatadogConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('monitors: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: MonitorsSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const uniqueIds = new Set(sample.monitors.map((m) => String(m.id))).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('datadog_monitor')?.size ?? 0;
      if (written !== uniqueIds) {
        violations.push({
          invariant: 'one datadog_monitor entity per unique monitor id',
          location: 'monitors phase',
          detail: `expected ${uniqueIds} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: DatadogConnector,
      resource: 'monitors',
      connectorId: CONNECTOR_ID,
      runs: 25,
      extraInvariants: [extra],
      run: async (sample, storage) => {
        // Clamp metadata so the connector terminates pagination after a single
        // page — installFetchMock returns the same body for every call, so any
        // sample with `page + 1 < page_count` would loop forever.
        const single: MonitorsSample = {
          ...sample,
          metadata: {
            ...sample.metadata,
            page: 0,
            page_count: 1,
          },
        };
        installFetchMock(() => single);
        const connector = new DatadogConnector(
          { resources: ['monitors'] },
          {
            apiKey: 'k' as unknown as { $secret: string },
            appKey: 'a' as unknown as { $secret: string },
          },
        );
        await connector.sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('incidents: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: IncidentsSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const uniqueIds = new Set(sample.data.map((inc) => inc.id)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('datadog_incident')?.size ??
        0;
      if (written !== uniqueIds) {
        violations.push({
          invariant: 'one datadog_incident entity per unique incident id',
          location: 'incidents phase',
          detail: `expected ${uniqueIds} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: DatadogConnector,
      resource: 'incidents',
      connectorId: CONNECTOR_ID,
      runs: 25,
      extraInvariants: [extra],
      run: async (sample, storage) => {
        // Clamp pagination meta so the connector stops after one page.
        const single: IncidentsSample = {
          ...sample,
          meta: { pagination: { next_offset: null } },
        };
        installFetchMock(() => single);
        const connector = new DatadogConnector(
          { resources: ['incidents'] },
          {
            apiKey: 'k' as unknown as { $secret: string },
            appKey: 'a' as unknown as { $secret: string },
          },
        );
        await connector.sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('slos: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: SlosSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const uniqueIds = new Set(sample.data.map((s) => s.id)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('datadog_slo')?.size ?? 0;
      if (written !== uniqueIds) {
        violations.push({
          invariant: 'one datadog_slo entity per unique slo id',
          location: 'slos phase',
          detail: `expected ${uniqueIds} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: DatadogConnector,
      resource: 'slos',
      connectorId: CONNECTOR_ID,
      runs: 25,
      extraInvariants: [extra],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        const connector = new DatadogConnector(
          { resources: ['slos'] },
          {
            apiKey: 'k' as unknown as { $secret: string },
            appKey: 'a' as unknown as { $secret: string },
          },
        );
        await connector.sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });
});
