import { InMemoryStorage } from '@rawdash/core';
import { describe, expect, it, vi } from 'vitest';

import type { QueryRow } from './project';
import type { QueryDefinition, QueryRunnerSettings } from './query-config';
import {
  type QueryExecutor,
  type QueryRequest,
  buildQueryRequest,
  computeSyncWindow,
  runQueries,
} from './run-queries';

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const CONNECTOR_ID = 'postgres';

const silentLogger = { info: vi.fn(), warn: vi.fn() };

function fakeExecutor(
  handler: (
    request: QueryRequest,
  ) => readonly QueryRow[] | Promise<readonly QueryRow[]>,
): QueryExecutor & { requests: QueryRequest[]; closed: number } {
  const requests: QueryRequest[] = [];
  return {
    requests,
    closed: 0,
    async run(request) {
      requests.push(request);
      return handler(request);
    },
    async close() {
      this.closed += 1;
    },
  };
}

function settingsFor(queries: QueryDefinition[]): QueryRunnerSettings {
  return { queries };
}

describe('computeSyncWindow', () => {
  it('uses the host-supplied since bound', () => {
    expect(
      computeSyncWindow(
        { mode: 'full', since: '2026-01-01T00:00:00Z' },
        settingsFor([]),
        NOW,
      ),
    ).toEqual({ startMs: Date.UTC(2026, 0, 1), endMs: NOW });
  });

  it('falls back to lookbackDays on a full sync', () => {
    expect(
      computeSyncWindow(
        { mode: 'full' },
        { queries: [], lookbackDays: 2 },
        NOW,
      ),
    ).toEqual({ startMs: NOW - 2 * 86_400_000, endMs: NOW });
  });

  it('uses a one-day window on a latest sync', () => {
    expect(computeSyncWindow({ mode: 'latest' }, settingsFor([]), NOW)).toEqual(
      {
        startMs: NOW - 86_400_000,
        endMs: NOW,
      },
    );
  });
});

describe('buildQueryRequest', () => {
  const base: QueryDefinition = {
    id: 'signups',
    sql: 'select count(*) as value from users',
    shape: 'stat',
  };

  it('wraps the query in a row-limited subquery', () => {
    const request = buildQueryRequest(base, settingsFor([base]), {
      startMs: NOW - 1000,
      endMs: NOW,
    });
    expect(request.sql).toBe(
      'select * from (select count(*) as value from users) as rawdash_query limit 5001',
    );
    expect(request.maxRows).toBe(5000);
    expect(request.params).toEqual([]);
  });

  it('binds the window bounds only for the placeholders the query references', () => {
    const oneParam = { ...base, sql: 'select 1 as value where now() >= $1' };
    expect(
      buildQueryRequest(oneParam, settingsFor([oneParam]), {
        startMs: Date.UTC(2026, 0, 1),
        endMs: NOW,
      }).params,
    ).toEqual(['2026-01-01T00:00:00.000Z']);

    const twoParams = {
      ...base,
      sql: 'select 1 as value where ts >= $1 and ts < $2',
    };
    expect(
      buildQueryRequest(twoParams, settingsFor([twoParams]), {
        startMs: Date.UTC(2026, 0, 1),
        endMs: NOW,
      }).params,
    ).toEqual(['2026-01-01T00:00:00.000Z', '2026-01-15T12:00:00.000Z']);
  });

  it('applies per-query overrides for row limit and timeout', () => {
    const request = buildQueryRequest(
      { ...base, maxRows: 10, statementTimeoutMs: 1000 },
      { queries: [base], maxRowsPerQuery: 20, statementTimeoutMs: 2000 },
      { startMs: NOW, endMs: NOW },
    );
    expect(request.maxRows).toBe(10);
    expect(request.statementTimeoutMs).toBe(1000);
  });

  it('strips a trailing semicolon before wrapping', () => {
    const request = buildQueryRequest(
      { ...base, sql: 'select 1 as value;' },
      settingsFor([base]),
      { startMs: NOW, endMs: NOW },
    );
    expect(request.sql).toContain('(select 1 as value)');
  });
});

describe('runQueries', () => {
  const statQuery: QueryDefinition = {
    id: 'signups',
    sql: 'select count(*) as value from users',
    shape: 'stat',
  };

  it('writes metric samples and closes the executor', async () => {
    const storage = new InMemoryStorage();
    const executor = fakeExecutor(() => [{ value: 12 }]);

    const result = await runQueries({
      settings: settingsFor([statQuery]),
      executor,
      storage: storage.getStorageHandle(CONNECTOR_ID),
      options: { mode: 'full' },
      logger: silentLogger,
      now: NOW,
    });

    expect(result).toEqual({ done: true });
    expect(executor.closed).toBe(1);
    const samples = await storage
      .getStorageHandle(CONNECTOR_ID)
      .queryMetrics({ name: 'signups' });
    expect(samples).toEqual([
      {
        name: 'signups',
        ts: NOW,
        value: 12,
        attributes: { queryId: 'signups' },
      },
    ]);
  });

  it('writes entities under the resolved resource name', async () => {
    const storage = new InMemoryStorage();
    const executor = fakeExecutor(() => [{ id: 'a', plan: 'pro' }]);

    await runQueries({
      settings: settingsFor([
        {
          id: 'accounts',
          sql: 'select id, plan from accounts',
          shape: 'entities',
          name: 'pg_accounts',
        },
      ]),
      executor,
      storage: storage.getStorageHandle(CONNECTOR_ID),
      options: { mode: 'full' },
      logger: silentLogger,
      now: NOW,
    });

    const entities = await storage
      .getStorageHandle(CONNECTOR_ID)
      .queryEntities({ type: 'pg_accounts' });
    expect(entities).toHaveLength(1);
    expect(entities[0]?.attributes).toEqual({ plan: 'pro' });
  });

  it('does not wipe metric history outside the samples it rewrites', async () => {
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle(CONNECTOR_ID);
    await handle.metric({
      name: 'orders_per_day',
      ts: Date.UTC(2025, 0, 1),
      value: 1,
      attributes: { queryId: 'orders_per_day' },
    });

    await runQueries({
      settings: settingsFor([
        {
          id: 'orders_per_day',
          sql: 'select ts, value from daily_orders',
          shape: 'timeseries',
        },
      ]),
      executor: fakeExecutor(() => [{ ts: '2026-01-14T00:00:00Z', value: 9 }]),
      storage: handle,
      options: { mode: 'full' },
      logger: silentLogger,
      now: NOW,
    });

    const samples = await handle.queryMetrics({ name: 'orders_per_day' });
    expect(samples.map((s) => s.value).sort()).toEqual([1, 9]);
  });

  it('skips queries whose resource the runner did not request', async () => {
    const storage = new InMemoryStorage();
    const executor = fakeExecutor(() => [{ value: 1 }]);

    await runQueries({
      settings: settingsFor([statQuery]),
      executor,
      storage: storage.getStorageHandle(CONNECTOR_ID),
      options: { mode: 'full', resources: new Set(['something_else']) },
      logger: silentLogger,
      now: NOW,
    });

    expect(executor.requests).toHaveLength(0);
  });

  it('fails the query that exceeds the row limit but still writes the healthy one', async () => {
    const storage = new InMemoryStorage();
    const executor = fakeExecutor((request) =>
      request.queryId === 'too_many'
        ? Array.from({ length: 3 }, (_, i) => ({ value: i }))
        : [{ value: 1 }],
    );

    await expect(
      runQueries({
        settings: settingsFor([
          { ...statQuery, id: 'too_many', shape: 'distribution', maxRows: 2 },
          statQuery,
        ]),
        executor,
        storage: storage.getStorageHandle(CONNECTOR_ID),
        options: { mode: 'full' },
        logger: silentLogger,
        now: NOW,
      }),
    ).rejects.toThrow(/row limit/);

    const samples = await storage
      .getStorageHandle(CONNECTOR_ID)
      .queryMetrics({ name: 'signups' });
    expect(samples).toHaveLength(1);
    expect(executor.closed).toBe(1);
  });

  it('rethrows the first executor failure after running the remaining queries', async () => {
    const storage = new InMemoryStorage();
    const executor = fakeExecutor((request) => {
      if (request.queryId === 'broken') {
        throw new Error('relation "nope" does not exist');
      }
      return [{ value: 1 }];
    });

    await expect(
      runQueries({
        settings: settingsFor([{ ...statQuery, id: 'broken' }, statQuery]),
        executor,
        storage: storage.getStorageHandle(CONNECTOR_ID),
        options: { mode: 'full' },
        logger: silentLogger,
        now: NOW,
      }),
    ).rejects.toThrow(/does not exist/);
    expect(executor.requests).toHaveLength(2);
  });

  it('yields without running anything when the signal is already aborted', async () => {
    const storage = new InMemoryStorage();
    const executor = fakeExecutor(() => [{ value: 1 }]);
    const controller = new AbortController();
    controller.abort();

    const result = await runQueries({
      settings: settingsFor([statQuery]),
      executor,
      storage: storage.getStorageHandle(CONNECTOR_ID),
      options: { mode: 'full' },
      logger: silentLogger,
      now: NOW,
      signal: controller.signal,
    });

    expect(result).toEqual({ done: false });
    expect(executor.requests).toHaveLength(0);
    expect(executor.closed).toBe(1);
  });
});
