import {
  type InvariantViolation,
  assertConnectorResourceShapes,
  connectorMetricConformanceViolations,
  connectorResourceShapeViolations,
  entityStoreFor,
  installFetchMock,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { LangfuseConnector } from './langfuse';

const CONNECTOR_ID = 'langfuse';
const SECRET = 'LANGFUSE_SECRET_KEY' as unknown as { $secret: string };
const HOST = 'https://cloud.langfuse.com';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] => [
  ...connectorResourceShapeViolations(
    LangfuseConnector.resources,
    storage,
    connectorId,
  ),
  ...connectorMetricConformanceViolations(
    LangfuseConnector.resources,
    storage,
    connectorId,
  ),
];

type TracesSample = z.infer<typeof LangfuseConnector.schemas.traces>;
type DailyMetricsSample = z.infer<
  typeof LangfuseConnector.schemas.observations_per_day
>;
type ScoresSample = z.infer<typeof LangfuseConnector.schemas.scores>;

function uniqueTraceEntities(): (
  storage: InMemoryStorage,
  connectorId: string,
  sample: TracesSample,
) => InvariantViolation[] {
  return (storage, connectorId, sample) => {
    const violations: InvariantViolation[] = [];
    const unique = new Set(sample.data.map((t) => t.id)).size;
    const written =
      entityStoreFor(storage, connectorId).get('langfuse_trace')?.size ?? 0;
    if (written !== unique) {
      violations.push({
        invariant: 'one langfuse_trace entity per unique trace id',
        location: 'traces phase',
        detail: `expected ${unique} entities, got ${written}`,
      });
    }
    return violations;
  };
}

describe('LangfuseConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('traces: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<TracesSample>({
      connectorClass: LangfuseConnector,
      resource: 'traces',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [uniqueTraceEntities(), docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({
          data: sample.data,
          meta: { ...sample.meta, totalPages: 1 },
        }));
        const c = new LangfuseConnector(
          { publicKey: 'pk', host: HOST, resources: ['traces'] },
          { secretKey: SECRET },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('observations_per_day: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<DailyMetricsSample>({
      connectorClass: LangfuseConnector,
      resource: 'observations_per_day',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({
          data: sample.data,
          meta: { ...sample.meta, totalPages: 1 },
        }));
        const c = new LangfuseConnector(
          {
            publicKey: 'pk',
            host: HOST,
            resources: ['observations_per_day'],
          },
          { secretKey: SECRET },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('scores: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<ScoresSample>({
      connectorClass: LangfuseConnector,
      resource: 'scores',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({
          data: sample.data,
          meta: { ...sample.meta, totalPages: 1 },
        }));
        const c = new LangfuseConnector(
          { publicKey: 'pk', host: HOST, resources: ['scores'] },
          { secretKey: SECRET },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('full sync across every phase upholds doc/storage shapes', async () => {
    let call = 0;
    installFetchMock((url) => {
      const u = String(url);
      call += 1;
      if (u.includes('/traces')) {
        return {
          data: [
            {
              id: 'trace-1',
              name: 'completion',
              projectId: 'p',
              totalCost: 0.1,
              latency: 100,
              createdAt: '2026-05-01T00:00:00Z',
              updatedAt: '2026-05-01T00:00:00Z',
            },
          ],
          meta: { page: 1, limit: 50, totalItems: 1, totalPages: 1 },
        };
      }
      if (u.includes('/metrics/daily')) {
        return {
          data: [
            {
              date: '2026-05-01',
              countTraces: 1,
              countObservations: 2,
              totalCost: 0.1,
              usage: [
                {
                  model: 'gpt-4o',
                  inputUsage: 100,
                  outputUsage: 50,
                  totalUsage: 150,
                  countObservations: 2,
                  totalCost: 0.1,
                },
              ],
            },
          ],
          meta: { page: 1, limit: 50, totalItems: 1, totalPages: 1 },
        };
      }
      return {
        data: [
          {
            id: `s${call}`,
            name: 'helpfulness',
            value: 0.9,
            timestamp: '2026-05-01T00:00:00Z',
          },
        ],
        meta: { page: 1, limit: 50, totalItems: 1, totalPages: 1 },
      };
    });

    const storage = new InMemoryStorage();
    const c = new LangfuseConnector(
      { publicKey: 'pk', host: HOST },
      { secretKey: SECRET },
    );
    await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));

    assertConnectorResourceShapes(
      LangfuseConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
