import { noopConnectorLogger } from '@rawdash/connector-shared';
import {
  type InvariantViolation,
  connectorMetricConformanceViolations,
  connectorResourceShapeViolations,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { describe, it } from 'vitest';
import type { z } from 'zod';

import {
  type PgClient,
  PostgresConnector,
  PostgresQueryExecutor,
} from './postgres';

const CONNECTOR_ID = 'postgres';

type QueryRowsSample = z.infer<
  typeof PostgresConnector.schemas.postgres_query_rows
>;

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] => [
  ...connectorResourceShapeViolations(
    PostgresConnector.resources,
    storage,
    connectorId,
  ),
  ...connectorMetricConformanceViolations(
    PostgresConnector.resources,
    storage,
    connectorId,
  ),
];

function clientReturning(rows: readonly Record<string, unknown>[]): PgClient {
  return {
    async connect() {},
    async query(sql) {
      return { rows: sql.startsWith('select') ? [...rows] : [] };
    },
    async end() {},
  };
}

class StubbedPostgresConnector extends PostgresConnector {
  constructor(
    settings: ConstructorParameters<typeof PostgresConnector>[0],
    private readonly client: PgClient,
  ) {
    super(settings, { connectionString: 'postgres://u:p@localhost:5432/app' });
  }

  protected override createExecutor(): PostgresQueryExecutor {
    return new PostgresQueryExecutor(() => this.client, noopConnectorLogger());
  }
}

describe('PostgresConnector property tests', () => {
  it('postgres_query_rows: sync upholds universal invariants for any valid row set', async () => {
    const expectedCount = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: QueryRowsSample,
    ): InvariantViolation[] => {
      const written =
        (
          storage as unknown as { metricStore: Map<string, unknown[]> }
        ).metricStore.get(CONNECTOR_ID)?.length ?? 0;
      if (written !== sample.rows.length) {
        return [
          {
            invariant: 'one metric sample per projected result row',
            location: 'postgres_query_rows',
            detail: `expected ${sample.rows.length} samples, got ${written}`,
          },
        ];
      }
      return [];
    };

    await runPropertySyncTest({
      connectorClass: PostgresConnector,
      resource: 'postgres_query_rows',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [expectedCount, docShapeExtra],
      run: async (sample, storage) => {
        const connector = new StubbedPostgresConnector(
          {
            maxRowsPerQuery: 100_000,
            queries: [
              {
                id: 'rows_per_day',
                shape: 'timeseries',
                sql: 'select ts, value, series from daily',
              },
            ],
          },
          clientReturning(sample.rows),
        );
        await connector.sync(
          { mode: 'full', since: '2026-01-01T00:00:00Z' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });
});
