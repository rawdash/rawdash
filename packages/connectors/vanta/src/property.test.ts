import {
  type InvariantViolation,
  connectorResourceShapeViolations,
  entityStoreFor,
  eventStoreFor,
  installFetchMockAdvanced,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { VantaConnector } from './vanta';

const CONNECTOR_ID = 'vanta';
const CLIENT_SECRET = 'VANTA_CLIENT_SECRET' as unknown as { $secret: string };

type ControlsSample = z.infer<typeof VantaConnector.schemas.controls>;
type TestsSample = z.infer<typeof VantaConnector.schemas.tests>;
type FindingsSample = z.infer<typeof VantaConnector.schemas.findings>;

const shapeViolationsExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    VantaConnector.resources,
    storage,
    connectorId,
  );

function uniqueControlInvariant(
  storage: InMemoryStorage,
  _connectorId: string,
  sample: ControlsSample,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const unique = new Set(sample.results.data.map((c) => c.id)).size;
  const written =
    entityStoreFor(storage, CONNECTOR_ID).get('vanta_control')?.size ?? 0;
  if (written !== unique) {
    violations.push({
      invariant: 'one vanta_control entity per unique id',
      location: 'controls phase',
      detail: `expected ${unique} entities, got ${written}`,
    });
  }
  return violations;
}

function uniqueTestInvariant(
  storage: InMemoryStorage,
  _connectorId: string,
  sample: TestsSample,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const unique = new Set(sample.results.data.map((t) => t.id)).size;
  const written =
    entityStoreFor(storage, CONNECTOR_ID).get('vanta_test')?.size ?? 0;
  if (written !== unique) {
    violations.push({
      invariant: 'one vanta_test entity per unique id',
      location: 'tests phase',
      detail: `expected ${unique} entities, got ${written}`,
    });
  }
  return violations;
}

function findingsCountInvariant(
  storage: InMemoryStorage,
  _connectorId: string,
  sample: FindingsSample,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const valid = sample.results.data.filter((f) =>
    Number.isFinite(Date.parse(f.createdAt)),
  ).length;
  const events = eventStoreFor<{ name: string }>(storage, CONNECTOR_ID).filter(
    (e) => e.name === 'vanta_test_finding',
  );
  if (events.length !== valid) {
    violations.push({
      invariant:
        'one vanta_test_finding event per finding row with a parseable createdAt',
      location: 'findings phase',
      detail: `expected ${valid} events, got ${events.length}`,
    });
  }
  return violations;
}

describe('VantaConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('controls: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<ControlsSample>({
      connectorClass: VantaConnector,
      resource: 'controls',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [uniqueControlInvariant, shapeViolationsExtra],
      run: async (sample, storage) => {
        installFetchMockAdvanced((u) => {
          if (u.includes('/oauth/token')) {
            return { body: { access_token: 'tok' } };
          }
          if (u.includes('/v1/controls')) {
            return {
              body: {
                results: {
                  data: sample.results.data,
                  pageInfo: { hasNextPage: false },
                },
              },
            };
          }
          return { body: {} };
        });
        const c = new VantaConnector(
          { resources: ['controls'] },
          { clientId: 'vci_AbCdEf', clientSecret: CLIENT_SECRET },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('tests: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<TestsSample>({
      connectorClass: VantaConnector,
      resource: 'tests',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [uniqueTestInvariant, shapeViolationsExtra],
      run: async (sample, storage) => {
        installFetchMockAdvanced((u) => {
          if (u.includes('/oauth/token')) {
            return { body: { access_token: 'tok' } };
          }
          if (u.includes('/v1/tests')) {
            return {
              body: {
                results: {
                  data: sample.results.data,
                  pageInfo: { hasNextPage: false },
                },
              },
            };
          }
          return { body: {} };
        });
        const c = new VantaConnector(
          { resources: ['tests'] },
          { clientId: 'vci_AbCdEf', clientSecret: CLIENT_SECRET },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('findings: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<FindingsSample>({
      connectorClass: VantaConnector,
      resource: 'findings',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [findingsCountInvariant, shapeViolationsExtra],
      run: async (sample, storage) => {
        installFetchMockAdvanced((u) => {
          if (u.includes('/oauth/token')) {
            return { body: { access_token: 'tok' } };
          }
          if (u.includes('/v1/test-findings')) {
            return {
              body: {
                results: {
                  data: sample.results.data,
                  pageInfo: { hasNextPage: false },
                },
              },
            };
          }
          return { body: {} };
        });
        const c = new VantaConnector(
          { resources: ['findings'], findingsLookbackDays: 365 * 5 },
          { clientId: 'vci_AbCdEf', clientSecret: CLIENT_SECRET },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });
});
