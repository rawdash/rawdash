import {
  type InvariantViolation,
  assertConnectorResourceShapes,
  connectorResourceShapeViolations,
  eventStoreFor,
  installFetchMock,
  metricStoreFor,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { BranchConnector } from './branch';

const CONNECTOR_ID = 'branch';
const KEY = 'BRANCH_KEY' as unknown as { $secret: string };
const SECRET = 'BRANCH_SECRET' as unknown as { $secret: string };

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    BranchConnector.resources,
    storage,
    connectorId,
  );

type InstallSample = z.infer<
  typeof BranchConnector.schemas.install_metrics_installs
>;
type ClickSample = z.infer<typeof BranchConnector.schemas.deep_link_events>;

function makeConnector(resources?: string[]) {
  return new BranchConnector(
    { resources: resources as never, lookbackDays: 7 },
    { branchKey: KEY, branchSecret: SECRET },
  );
}

function distinctInstallBucketCount(sample: InstallSample): number {
  const keys = new Set<string>();
  for (const row of sample.results) {
    const r = row.result as Record<string, unknown>;
    const date = String((row as Record<string, unknown>)['timestamp']).slice(
      0,
      10,
    );
    const channel =
      (r['last_attributed_touch_data_tilde_channel'] as string | null) ?? '';
    const campaign =
      (r['last_attributed_touch_data_tilde_campaign'] as string | null) ?? '';
    keys.add(`${date}|${channel}|${campaign}`);
  }
  return keys.size;
}

function installSampleCountInvariant(
  storage: InMemoryStorage,
  connectorId: string,
  sample: InstallSample,
): InvariantViolation[] {
  const expected = distinctInstallBucketCount(sample);
  const samples = metricStoreFor(storage, connectorId).filter(
    (m) => m.name === 'branch_install_metrics',
  );
  if (samples.length !== expected) {
    return [
      {
        invariant:
          'one branch_install_metrics sample per distinct (date, channel, campaign) bucket',
        location: 'install_metrics phase',
        detail: `expected ${expected} metrics, got ${samples.length}`,
      },
    ];
  }
  return [];
}

function clickEventCountInvariant(
  storage: InMemoryStorage,
  connectorId: string,
  sample: ClickSample,
): InvariantViolation[] {
  const events = eventStoreFor<{ name: string }>(storage, connectorId).filter(
    (e) => e.name === 'branch_deep_link_event',
  );
  if (events.length !== sample.results.length) {
    return [
      {
        invariant: 'one branch_deep_link_event per click result row',
        location: 'deep_link_events phase',
        detail: `expected ${sample.results.length} events, got ${events.length}`,
      },
    ];
  }
  return [];
}

describe('BranchConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('install_metrics: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<InstallSample>({
      connectorClass: BranchConnector,
      resource: 'install_metrics_installs',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [installSampleCountInvariant, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({ results: sample.results }));
        await makeConnector(['install_metrics']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('deep_link_events: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<ClickSample>({
      connectorClass: BranchConnector,
      resource: 'deep_link_events',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [clickEventCountInvariant, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({ results: sample.results }));
        await makeConnector(['deep_link_events']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('full sync across all resources matches documented resource shapes', async () => {
    installFetchMock(() => ({
      results: [
        {
          timestamp: '2025-01-15T00:00:00.000-08:00',
          result: {
            unique_count: 42,
            last_attributed_touch_data_tilde_channel: 'organic',
            last_attributed_touch_data_tilde_campaign: 'launch',
            last_attributed_touch_data_tilde_feature: 'sharing',
          },
        },
      ],
    }));

    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    assertConnectorResourceShapes(
      BranchConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
