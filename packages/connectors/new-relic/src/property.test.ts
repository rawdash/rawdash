import {
  type InvariantViolation,
  connectorResourceShapeViolations,
  entityStoreFor,
  eventStoreFor,
  mockJsonResponse,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { NewRelicConnector } from './new-relic';

const CONNECTOR_ID = 'new-relic';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    NewRelicConnector.resources,
    storage,
    connectorId,
  );

interface GraphQLCall {
  query: string;
  variables: Record<string, unknown>;
}

function operationName(query: string): string {
  return query.match(/query\s+(\w+)/)?.[1] ?? '';
}

function installGraphqlMock(
  responseFor: (op: string, variables: Record<string, unknown>) => unknown,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
    const parsed = JSON.parse(init.body as string) as GraphQLCall;
    const data = responseFor(operationName(parsed.query), parsed.variables);
    return Promise.resolve(mockJsonResponse({ data }));
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function makeConnector(
  overrides: Partial<{
    resources: readonly ('alerts' | 'alert_violations' | 'nrql_queries')[];
    nrqlQueries: readonly { name: string; query: string }[];
  }> = {},
): NewRelicConnector {
  return new NewRelicConnector(
    { accountId: 1, ...overrides },
    { apiKey: 'nrak_test' as unknown as { $secret: string } },
  );
}

type AlertConditionsSample = z.infer<
  typeof NewRelicConnector.schemas.alert_conditions
>;
type IncidentsSample = z.infer<typeof NewRelicConnector.schemas.incidents>;
type NrqlQueriesSample = z.infer<typeof NewRelicConnector.schemas.nrql_queries>;

describe('NewRelicConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('alert_conditions: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: AlertConditionsSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.nrqlConditions.map((c) => c.id)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('newrelic_alert_condition')
          ?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one newrelic_alert_condition per unique condition id',
          location: 'alert_conditions phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: NewRelicConnector,
      resource: 'alert_conditions',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        const single: AlertConditionsSample = {
          ...sample,
          nextCursor: null,
        };
        installGraphqlMock((op) => {
          if (op === 'AlertConditions') {
            return {
              actor: {
                account: {
                  alerts: { nrqlConditionsSearch: single },
                },
              },
            };
          }
          return {
            actor: {
              account: {
                alerts: {
                  nrqlConditionsSearch: {
                    nrqlConditions: [],
                    nextCursor: null,
                    totalCount: 0,
                  },
                },
                nrql: { results: [], metadata: null },
              },
            },
          };
        });
        await makeConnector({ resources: ['alerts'] }).sync(
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
      const validRows = sample.results.filter((r) => {
        const incidentId = r.incidentId;
        const openedAt = r.openedAt;
        return (
          (typeof incidentId === 'string' || typeof incidentId === 'number') &&
          typeof openedAt === 'number' &&
          Number.isFinite(openedAt)
        );
      });
      const events = eventStoreFor(storage, CONNECTOR_ID).filter(
        (e) => (e as { name: string }).name === 'newrelic_alert_violation',
      );
      if (events.length !== validRows.length) {
        violations.push({
          invariant:
            'one newrelic_alert_violation event per NRQL row with valid id + openedAt',
          location: 'incidents phase',
          detail: `expected ${validRows.length} events, got ${events.length}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: NewRelicConnector,
      resource: 'incidents',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installGraphqlMock((op) => {
          if (op === 'RunNrql') {
            return {
              actor: { account: { nrql: sample } },
            };
          }
          return {
            actor: {
              account: {
                alerts: {
                  nrqlConditionsSearch: {
                    nrqlConditions: [],
                    nextCursor: null,
                    totalCount: 0,
                  },
                },
              },
            },
          };
        });
        await makeConnector({ resources: ['alert_violations'] }).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('nrql_queries: sync upholds universal invariants for any valid API payload', async () => {
    await runPropertySyncTest({
      connectorClass: NewRelicConnector,
      resource: 'nrql_queries',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [docShapeExtra],
      run: async (sample: NrqlQueriesSample, storage) => {
        installGraphqlMock((op) => {
          if (op === 'RunNrql') {
            return {
              actor: { account: { nrql: sample } },
            };
          }
          return {
            actor: {
              account: {
                alerts: {
                  nrqlConditionsSearch: {
                    nrqlConditions: [],
                    nextCursor: null,
                    totalCount: 0,
                  },
                },
              },
            },
          };
        });
        await makeConnector({
          resources: ['nrql_queries'],
          nrqlQueries: [
            {
              name: 'error_rate',
              query: 'SELECT count(*) FROM Transaction',
            },
          ],
        }).sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });
});
