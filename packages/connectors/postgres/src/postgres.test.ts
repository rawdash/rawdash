import {
  AuthError,
  ClientBugError,
  TransientError,
  noopConnectorLogger,
} from '@rawdash/connector-shared';
import { InMemoryStorage } from '@rawdash/core';
import { describe, expect, it, vi } from 'vitest';

import { mapPostgresError } from './errors';
import {
  type PgClient,
  PostgresConnector,
  PostgresQueryExecutor,
  configFields,
  shouldUseTls,
} from './postgres';

const CONNECTOR_ID = 'postgres';

function fakePgClient(
  handler: (sql: string, params?: readonly unknown[]) => unknown[],
): PgClient & { statements: string[]; ended: boolean } {
  return {
    statements: [],
    ended: false,
    async connect() {},
    async query(sql, params) {
      this.statements.push(sql);
      return { rows: handler(sql, params) as Record<string, unknown>[] };
    },
    async end() {
      this.ended = true;
    },
  };
}

describe('configFields', () => {
  const base = {
    connectionString: { $secret: 'PG_CONNECTION_STRING' },
    queries: [
      { id: 'signups', shape: 'stat', sql: 'select count(*) from users' },
    ],
  };

  it('accepts a minimal read-only query config', () => {
    expect(configFields.parse(base).queries[0]?.id).toBe('signups');
  });

  it('rejects a query that writes', () => {
    expect(() =>
      configFields.parse({
        ...base,
        queries: [{ id: 'bad', shape: 'stat', sql: 'delete from users' }],
      }),
    ).toThrow(/read-only/);
  });

  it('rejects multi-statement SQL', () => {
    expect(() =>
      configFields.parse({
        ...base,
        queries: [{ id: 'bad', shape: 'stat', sql: 'select 1; select 2' }],
      }),
    ).toThrow(/single statement/);
  });

  it('rejects duplicate query ids', () => {
    expect(() =>
      configFields.parse({
        ...base,
        queries: [
          { id: 'dup', shape: 'stat', sql: 'select 1' },
          { id: 'dup', shape: 'stat', sql: 'select 2' },
        ],
      }),
    ).toThrow(/unique/);
  });

  it('rejects two queries that resolve to the same resource name', () => {
    expect(() =>
      configFields.parse({
        ...base,
        queries: [
          { id: 'a', shape: 'stat', sql: 'select 1', name: 'shared' },
          { id: 'b', shape: 'stat', sql: 'select 2', name: 'shared' },
        ],
      }),
    ).toThrow(/distinct resource name/);
  });

  it('rejects an invalid query id', () => {
    expect(() =>
      configFields.parse({
        ...base,
        queries: [{ id: 'Bad Id', shape: 'stat', sql: 'select 1' }],
      }),
    ).toThrow();
  });
});

describe('shouldUseTls', () => {
  it('defaults to TLS for remote hosts', () => {
    expect(shouldUseTls('postgres://u:p@db.internal:5432/app', undefined)).toBe(
      true,
    );
  });

  it('defaults to plaintext for localhost', () => {
    expect(shouldUseTls('postgres://u:p@localhost:5432/app', undefined)).toBe(
      false,
    );
    expect(shouldUseTls('postgres://u:p@127.0.0.1:5432/app', undefined)).toBe(
      false,
    );
  });

  it('honors sslmode=disable and an explicit override', () => {
    expect(
      shouldUseTls(
        'postgres://u:p@db.internal:5432/app?sslmode=disable',
        undefined,
      ),
    ).toBe(false);
    expect(shouldUseTls('postgres://u:p@localhost:5432/app', true)).toBe(true);
  });
});

describe('PostgresQueryExecutor', () => {
  it('runs each query in a read-only transaction with a statement timeout', async () => {
    const client = fakePgClient(() => [{ value: 3 }]);
    const executor = new PostgresQueryExecutor(
      () => client,
      noopConnectorLogger(),
    );

    const rows = await executor.run({
      queryId: 'signups',
      sql: 'select * from (select 1 as value) as rawdash_query limit 11',
      params: [],
      maxRows: 10,
      statementTimeoutMs: 5000,
    });

    expect(rows).toEqual([{ value: 3 }]);
    expect(client.statements).toEqual([
      'begin read only',
      'set local statement_timeout = 5000',
      'select * from (select 1 as value) as rawdash_query limit 11',
      'rollback',
    ]);
  });

  it('rolls back and maps the driver error', async () => {
    const client = fakePgClient((sql) => {
      if (sql.startsWith('select')) {
        throw Object.assign(new Error('relation "nope" does not exist'), {
          code: '42P01',
        });
      }
      return [];
    });
    const executor = new PostgresQueryExecutor(
      () => client,
      noopConnectorLogger(),
    );

    await expect(
      executor.run({
        queryId: 'broken',
        sql: 'select 1',
        params: [],
        maxRows: 10,
        statementTimeoutMs: 5000,
      }),
    ).rejects.toBeInstanceOf(ClientBugError);
    expect(client.statements.filter((s) => s === 'rollback')).toHaveLength(1);
  });

  it('reuses one connection across queries and closes it once', async () => {
    const client = fakePgClient(() => [{ value: 1 }]);
    const connect = vi.fn(() => client);
    const executor = new PostgresQueryExecutor(connect, noopConnectorLogger());
    const request = {
      queryId: 'a',
      sql: 'select 1',
      params: [],
      maxRows: 10,
      statementTimeoutMs: 1000,
    };

    await executor.run(request);
    await executor.run({ ...request, queryId: 'b' });
    await executor.close();
    await executor.close();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(client.ended).toBe(true);
  });

  it('throws when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const executor = new PostgresQueryExecutor(
      () => fakePgClient(() => []),
      noopConnectorLogger(),
    );

    await expect(
      executor.run(
        {
          queryId: 'a',
          sql: 'select 1',
          params: [],
          maxRows: 10,
          statementTimeoutMs: 1000,
        },
        controller.signal,
      ),
    ).rejects.toThrow();
  });
});

describe('mapPostgresError', () => {
  it('maps authentication and permission failures to AuthError', () => {
    expect(
      mapPostgresError(
        Object.assign(new Error('nope'), { code: '28P01' }),
        'q',
      ),
    ).toBeInstanceOf(AuthError);
    expect(
      mapPostgresError(
        Object.assign(new Error('nope'), { code: '42501' }),
        'q',
      ),
    ).toBeInstanceOf(AuthError);
  });

  it('maps connection and cancellation failures to TransientError', () => {
    expect(
      mapPostgresError(
        Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
        'q',
      ),
    ).toBeInstanceOf(TransientError);
    expect(
      mapPostgresError(
        Object.assign(new Error('timeout'), { code: '57014' }),
        'q',
      ),
    ).toBeInstanceOf(TransientError);
  });

  it('maps a blocked write and bad SQL to ClientBugError', () => {
    expect(
      mapPostgresError(
        Object.assign(new Error('read-only transaction'), { code: '25006' }),
        'q',
      ),
    ).toBeInstanceOf(ClientBugError);
    expect(
      mapPostgresError(
        Object.assign(new Error('syntax'), { code: '42601' }),
        'q',
      ),
    ).toBeInstanceOf(ClientBugError);
  });
});

class TestPostgresConnector extends PostgresConnector {
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

describe('PostgresConnector.sync', () => {
  it('projects each declared query into storage', async () => {
    const storage = new InMemoryStorage();
    const client = fakePgClient((sql) =>
      sql.includes('users') ? [{ value: 41 }] : [{ id: 'acct_1', plan: 'pro' }],
    );

    const connector = new TestPostgresConnector(
      {
        queries: [
          {
            id: 'signups',
            shape: 'stat',
            sql: 'select count(*) as value from users',
          },
          {
            id: 'accounts',
            shape: 'entities',
            sql: 'select id, plan from accounts',
          },
        ],
      },
      client,
    );

    const result = await connector.sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    expect(result).toEqual({ done: true });
    const handle = storage.getStorageHandle(CONNECTOR_ID);
    expect(await handle.queryMetrics({ name: 'signups' })).toHaveLength(1);
    expect(await handle.queryEntities({ type: 'accounts' })).toHaveLength(1);
    expect(client.ended).toBe(true);
  });

  it('binds the sync window to the placeholders a query declares', async () => {
    const storage = new InMemoryStorage();
    const seen: (readonly unknown[] | undefined)[] = [];
    const client: PgClient = {
      async connect() {},
      async query(sql, params) {
        if (sql.startsWith('select')) {
          seen.push(params);
        }
        return { rows: [{ ts: '2026-01-14T00:00:00Z', value: 2 }] };
      },
      async end() {},
    };

    const connector = new TestPostgresConnector(
      {
        queries: [
          {
            id: 'signups_per_day',
            shape: 'timeseries',
            sql: 'select ts, value from daily where ts >= $1 and ts < $2',
          },
        ],
      },
      client,
    );

    await connector.sync(
      { mode: 'full', since: '2026-01-01T00:00:00.000Z' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    expect(seen[0]?.[0]).toBe('2026-01-01T00:00:00.000Z');
    expect(seen[0]).toHaveLength(2);
  });
});
