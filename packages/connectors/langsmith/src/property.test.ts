import {
  type InvariantViolation,
  assertConnectorResourceShapes,
  connectorResourceShapeViolations,
  metricStoreFor,
  mockJsonResponse,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { LangSmithConnector } from './langsmith';

const CONNECTOR_ID = 'langsmith';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    LangSmithConnector.resources,
    storage,
    connectorId,
  );

function makeConnector(
  overrides: Partial<{
    resources: readonly ('runs' | 'runs_per_day' | 'feedback')[];
  }> = {},
): LangSmithConnector {
  return new LangSmithConnector(
    { endpoint: 'https://api.smith.langchain.com', ...overrides },
    { apiKey: 'lsv2_test' },
  );
}

type RunsSample = z.infer<typeof LangSmithConnector.schemas.runs>;
type FeedbackSample = z.infer<typeof LangSmithConnector.schemas.feedback>;

describe('LangSmithConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs: sync upholds universal invariants for any valid API payload', async () => {
    await runPropertySyncTest({
      connectorClass: LangSmithConnector,
      resource: 'runs',
      connectorId: CONNECTOR_ID,
      runs: 30,
      extraInvariants: [docShapeExtra],
      run: async (sample: RunsSample, storage) => {
        let callCount = 0;
        vi.stubGlobal(
          'fetch',
          vi.fn().mockImplementation((url: string) => {
            callCount += 1;
            if (url.includes('/runs/query')) {
              const body = callCount === 1 ? sample : { runs: [] };
              return Promise.resolve(mockJsonResponse(body));
            }
            return Promise.resolve(mockJsonResponse([]));
          }),
        );
        await makeConnector({ resources: ['runs', 'runs_per_day'] }).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('feedback: sync upholds universal invariants for any valid API payload', async () => {
    await runPropertySyncTest({
      connectorClass: LangSmithConnector,
      resource: 'feedback',
      connectorId: CONNECTOR_ID,
      runs: 30,
      extraInvariants: [
        docShapeExtra,
        (storage, _connectorId, sample: FeedbackSample) => {
          const violations: InvariantViolation[] = [];
          const datedRows = sample.filter((row) => {
            const ts = row.created_at;
            return typeof ts === 'string' && Number.isFinite(Date.parse(ts));
          });
          const samples = metricStoreFor(storage, CONNECTOR_ID).filter(
            (m) => (m as { name: string }).name === 'langsmith_feedback',
          );
          if (samples.length !== datedRows.length) {
            violations.push({
              invariant:
                'one langsmith_feedback sample per feedback row with a parseable created_at',
              location: 'feedback phase',
              detail: `expected ${datedRows.length} samples, got ${samples.length}`,
            });
          }
          return violations;
        },
      ],
      run: async (sample: FeedbackSample, storage) => {
        let callCount = 0;
        vi.stubGlobal(
          'fetch',
          vi.fn().mockImplementation((url: string) => {
            callCount += 1;
            if (url.includes('/feedback')) {
              const body = callCount === 1 ? sample : [];
              return Promise.resolve(mockJsonResponse(body));
            }
            return Promise.resolve(mockJsonResponse({ runs: [] }));
          }),
        );
        await makeConnector({ resources: ['feedback'] }).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('full sync: resource shapes match declared definitions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/runs/query')) {
          return Promise.resolve(
            mockJsonResponse({
              runs: [
                {
                  id: 'run-1',
                  name: 'demo',
                  run_type: 'chain',
                  status: 'success',
                  session_id: 'sess-1',
                  session_name: 'default',
                  start_time: '2026-06-01T00:00:00Z',
                  end_time: '2026-06-01T00:00:01Z',
                  total_tokens: 100,
                  total_cost: 0.5,
                },
              ],
              cursors: { next: null },
            }),
          );
        }
        if (url.includes('/feedback')) {
          return Promise.resolve(
            mockJsonResponse([
              {
                id: 'fb-1',
                run_id: 'run-1',
                session_id: 'sess-1',
                key: 'quality',
                score: 0.9,
                created_at: '2026-06-01T00:00:02Z',
              },
            ]),
          );
        }
        return Promise.resolve(mockJsonResponse({ runs: [] }));
      }),
    );
    const { InMemoryStorage } = await import('@rawdash/core');
    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    assertConnectorResourceShapes(
      LangSmithConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
