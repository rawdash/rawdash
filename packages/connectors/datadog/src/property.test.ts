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

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const v of a) {
    if (!b.has(v)) {
      return false;
    }
  }
  return true;
}

function formatIds(ids: Set<string>): string {
  return `[${[...ids].sort().join(', ')}]`;
}

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
      const expectedIds = new Set(sample.monitors.map((m) => String(m.id)));
      const storedIds = new Set(
        entityStoreFor(storage, CONNECTOR_ID).get('datadog_monitor')?.keys() ??
          [],
      );
      if (!setsEqual(expectedIds, storedIds)) {
        violations.push({
          invariant: 'one datadog_monitor entity per unique monitor id',
          location: 'monitors phase',
          detail: `expected ids ${formatIds(expectedIds)}, got ${formatIds(storedIds)}`,
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
      const expectedIds = new Set(sample.data.map((inc) => inc.id));
      const storedIds = new Set(
        entityStoreFor(storage, CONNECTOR_ID).get('datadog_incident')?.keys() ??
          [],
      );
      if (!setsEqual(expectedIds, storedIds)) {
        violations.push({
          invariant: 'one datadog_incident entity per unique incident id',
          location: 'incidents phase',
          detail: `expected ids ${formatIds(expectedIds)}, got ${formatIds(storedIds)}`,
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
      const expectedIds = new Set(sample.data.map((s) => s.id));
      const storedIds = new Set(
        entityStoreFor(storage, CONNECTOR_ID).get('datadog_slo')?.keys() ?? [],
      );
      if (!setsEqual(expectedIds, storedIds)) {
        violations.push({
          invariant: 'one datadog_slo entity per unique slo id',
          location: 'slos phase',
          detail: `expected ids ${formatIds(expectedIds)}, got ${formatIds(storedIds)}`,
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
