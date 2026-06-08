import {
  type InvariantViolation,
  connectorResourceShapeViolations,
  entityStoreFor,
  installFetchMock,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { GreenhouseConnector } from './greenhouse';

const CONNECTOR_ID = 'greenhouse';
const TOKEN = 'GREENHOUSE_TOKEN' as unknown as { $secret: string };

type JobSample = z.infer<typeof GreenhouseConnector.schemas.jobs>;
type CandidateSample = z.infer<typeof GreenhouseConnector.schemas.candidates>;
type ApplicationSample = z.infer<
  typeof GreenhouseConnector.schemas.applications
>;
type OfferSample = z.infer<typeof GreenhouseConnector.schemas.offers>;

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    GreenhouseConnector.resources,
    storage,
    connectorId,
  );

function uniqueEntityInvariant(
  entityType: string,
  phase: string,
): (
  storage: InMemoryStorage,
  connectorId: string,
  sample: unknown[],
) => InvariantViolation[] {
  return (storage, _connectorId, sample) => {
    const violations: InvariantViolation[] = [];
    const records = sample as Array<{ id: number }>;
    const unique = new Set(records.map((r) => String(r.id))).size;
    const written =
      entityStoreFor(storage, CONNECTOR_ID).get(entityType)?.size ?? 0;
    if (written !== unique) {
      violations.push({
        invariant: `one ${entityType} entity per unique id`,
        location: `${phase} phase`,
        detail: `expected ${unique} entities, got ${written}`,
      });
    }
    return violations;
  };
}

describe('GreenhouseConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('jobs: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<JobSample>({
      connectorClass: GreenhouseConnector,
      resource: 'jobs',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        uniqueEntityInvariant('greenhouse_job', 'jobs'),
        docShapeExtra,
      ],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        const c = new GreenhouseConnector(
          { resources: ['jobs'] },
          { apiKey: TOKEN },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('candidates: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<CandidateSample>({
      connectorClass: GreenhouseConnector,
      resource: 'candidates',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        uniqueEntityInvariant('greenhouse_candidate', 'candidates'),
        docShapeExtra,
      ],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        const c = new GreenhouseConnector(
          { resources: ['candidates'] },
          { apiKey: TOKEN },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('applications: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<ApplicationSample>({
      connectorClass: GreenhouseConnector,
      resource: 'applications',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        uniqueEntityInvariant('greenhouse_application', 'applications'),
        docShapeExtra,
      ],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        const c = new GreenhouseConnector(
          { resources: ['applications'] },
          { apiKey: TOKEN },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('offers: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<OfferSample>({
      connectorClass: GreenhouseConnector,
      resource: 'offers',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        uniqueEntityInvariant('greenhouse_offer', 'offers'),
        docShapeExtra,
      ],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        const c = new GreenhouseConnector(
          { resources: ['offers'] },
          { apiKey: TOKEN },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });
});
