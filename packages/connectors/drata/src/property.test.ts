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

import { DrataConnector } from './drata';

const CONNECTOR_ID = 'drata';
const API_KEY = 'DRATA_API_KEY' as unknown as { $secret: string };

type ControlsSample = z.infer<typeof DrataConnector.schemas.controls>;
type TestsSample = z.infer<typeof DrataConnector.schemas.tests>;
type PersonnelSample = z.infer<typeof DrataConnector.schemas.personnel>;
type FindingsSample = z.infer<typeof DrataConnector.schemas.findings>;

const shapeViolationsExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    DrataConnector.resources,
    storage,
    connectorId,
  );

function uniqueControlInvariant(
  storage: InMemoryStorage,
  _connectorId: string,
  sample: ControlsSample,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const unique = new Set(sample.data.map((c) => c.id)).size;
  const written =
    entityStoreFor(storage, CONNECTOR_ID).get('drata_control')?.size ?? 0;
  if (written !== unique) {
    violations.push({
      invariant: 'one drata_control entity per unique id',
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
  const unique = new Set(sample.data.map((t) => t.id)).size;
  const written =
    entityStoreFor(storage, CONNECTOR_ID).get('drata_test')?.size ?? 0;
  if (written !== unique) {
    violations.push({
      invariant: 'one drata_test entity per unique id',
      location: 'tests phase',
      detail: `expected ${unique} entities, got ${written}`,
    });
  }
  return violations;
}

function uniquePersonnelInvariant(
  storage: InMemoryStorage,
  _connectorId: string,
  sample: PersonnelSample,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const unique = new Set(sample.data.map((p) => p.id)).size;
  const written =
    entityStoreFor(storage, CONNECTOR_ID).get('drata_personnel')?.size ?? 0;
  if (written !== unique) {
    violations.push({
      invariant: 'one drata_personnel entity per unique id',
      location: 'personnel phase',
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
  const valid = sample.data.filter((f) =>
    Number.isFinite(Date.parse(f.createdAt)),
  ).length;
  const events = eventStoreFor<{ name: string }>(storage, CONNECTOR_ID).filter(
    (e) => e.name === 'drata_test_finding',
  );
  if (events.length !== valid) {
    violations.push({
      invariant:
        'one drata_test_finding event per finding row with a parseable createdAt',
      location: 'findings phase',
      detail: `expected ${valid} events, got ${events.length}`,
    });
  }
  return violations;
}

describe('DrataConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('controls: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<ControlsSample>({
      connectorClass: DrataConnector,
      resource: 'controls',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [uniqueControlInvariant, shapeViolationsExtra],
      run: async (sample, storage) => {
        installFetchMockAdvanced((u) => {
          if (u.includes('/v1/controls')) {
            return {
              body: {
                data: sample.data,
                pagination: { hasMore: false },
              },
            };
          }
          return { body: {} };
        });
        const c = new DrataConnector(
          { resources: ['controls'] },
          { apiKey: API_KEY },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('tests: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<TestsSample>({
      connectorClass: DrataConnector,
      resource: 'tests',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [uniqueTestInvariant, shapeViolationsExtra],
      run: async (sample, storage) => {
        installFetchMockAdvanced((u) => {
          if (u.includes('/v1/tests')) {
            return {
              body: {
                data: sample.data,
                pagination: { hasMore: false },
              },
            };
          }
          return { body: {} };
        });
        const c = new DrataConnector(
          { resources: ['tests'] },
          { apiKey: API_KEY },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('personnel: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<PersonnelSample>({
      connectorClass: DrataConnector,
      resource: 'personnel',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [uniquePersonnelInvariant, shapeViolationsExtra],
      run: async (sample, storage) => {
        installFetchMockAdvanced((u) => {
          if (u.includes('/v1/personnel')) {
            return {
              body: {
                data: sample.data,
                pagination: { hasMore: false },
              },
            };
          }
          return { body: {} };
        });
        const c = new DrataConnector(
          { resources: ['personnel'] },
          { apiKey: API_KEY },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('findings: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<FindingsSample>({
      connectorClass: DrataConnector,
      resource: 'findings',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [findingsCountInvariant, shapeViolationsExtra],
      run: async (sample, storage) => {
        installFetchMockAdvanced((u) => {
          if (u.includes('/v1/findings')) {
            return {
              body: {
                data: sample.data,
                pagination: { hasMore: false },
              },
            };
          }
          return { body: {} };
        });
        const c = new DrataConnector(
          { resources: ['findings'], findingsLookbackDays: 365 * 5 },
          { apiKey: API_KEY },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });
});
