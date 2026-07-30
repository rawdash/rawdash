import {
  type QueryExecutor,
  type QueryRequest,
  type QueryRow,
  type QueryRunnerSettings,
  queryRunnerConfigShape,
  queryRunnerRowsSchema,
  runQueries,
  uniqueQueryIdsRefine,
  uniqueQueryNamesRefine,
} from '@rawdash/connector-query-runner-shared';
import {
  ClientBugError,
  type ConnectorLogger,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ConnectorContext,
  type ConnectorCost,
  type ConnectorDoc,
  type CredentialsSchema,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
  defineConnectorDoc,
  defineResources,
  schemasFromResources,
} from '@rawdash/core';
import pg from 'pg';
import { z } from 'zod';

import { mapPostgresError } from './errors';

export const configFields = defineConfigFields(
  z
    .object({
      connectionString: z.object({ $secret: z.string() }).meta({
        label: 'Connection string',
        description:
          'PostgreSQL connection URI for a read-only role, e.g. postgres://readonly:password@host:5432/app. Store it as a secret.',
        placeholder: 'postgres://readonly@db.internal:5432/app',
        secret: true,
      }),
      ssl: z.boolean().optional().meta({
        label: 'Require TLS',
        description:
          'Connect over TLS. Defaults to true unless the connection string already says otherwise (sslmode=disable) or the host is localhost.',
      }),
      ...queryRunnerConfigShape,
    })
    .refine(uniqueQueryIdsRefine.predicate, {
      path: ['queries'],
      message: uniqueQueryIdsRefine.message,
    })
    .refine(uniqueQueryNamesRefine.predicate, {
      path: ['queries'],
      message: uniqueQueryNamesRefine.message,
    }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'PostgreSQL',
  category: 'infrastructure',
  brandColor: '#4169E1',
  tagline:
    'Run declared read-only SQL against your own PostgreSQL database and turn the result rows into dashboard metrics or entities - no separate metrics endpoint to build.',
  vendor: {
    name: 'PostgreSQL',
    domain: 'postgresql.org',
    apiDocs: 'https://node-postgres.com/',
    website: 'https://www.postgresql.org/',
  },
  auth: {
    summary:
      'A PostgreSQL connection string. Point it at a dedicated role with SELECT-only grants; every query additionally runs inside a READ ONLY transaction with a statement timeout.',
    setup: [
      "Create a dedicated read-only role: `CREATE ROLE rawdash_readonly LOGIN PASSWORD '…';`",
      'Grant it read access to the tables the dashboard needs: `GRANT USAGE ON SCHEMA public TO rawdash_readonly; GRANT SELECT ON ALL TABLES IN SCHEMA public TO rawdash_readonly;`',
      'Allow the role to reach the database from wherever rawdash syncs run (VPC peering, an allowlisted egress IP, or a connection proxy).',
      'Store the connection URI as a secret and reference it from config as `connectionString: secret("PG_CONNECTION_STRING")`.',
      'Declare one entry in `queries` per number you want on a dashboard.',
    ],
  },
  rateLimit:
    'There is no upstream rate limit; the cost control is your own database. Every query runs with a statement timeout (15s by default) and a row ceiling, and the connector runs one query at a time on a single connection.',
  limitations: [
    'Queries must be a single read-only statement starting with SELECT, WITH, TABLE, or VALUES. The connector both rejects write keywords at config-parse time and runs every query in a READ ONLY transaction; it is not a substitute for a role with SELECT-only grants.',
    'Only one numeric per metric sample. A metric-shaped query projects one column into `value` plus an optional group label into the `series` dimension; use the `entities` shape when a row carries several numbers you want to keep together.',
    'There is no per-query schedule. The host decides sync cadence for the connector as a whole (see planSync), so all queries run on every sync tick.',
    'Incremental syncs are opt-in per query: reference $1 (window start) and optionally $2 (window end) in the SQL and the connector binds the sync window to them. A query without placeholders is re-run in full on every sync.',
    'A query returning more rows than the row ceiling fails rather than silently truncating, so a widget never shows a half-computed number.',
    'Result columns are projected by convention (`ts`/`bucket`, `value`/`count`/`total`, `series`/`label`, `id`, `updated_at`) with an optional per-query `columns` override; arbitrary column-to-attribute mapping beyond that is out of scope.',
  ],
});

export interface PostgresSettings extends QueryRunnerSettings {
  ssl?: boolean;
}

const postgresCredentials = {
  connectionString: {
    description: 'PostgreSQL connection URI for a read-only role',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type PostgresCredentials = typeof postgresCredentials;

export const postgresResources = defineResources({
  '<query id>': {
    shape: 'metric',
    dynamic: true,
    description:
      'One metric series per declared query whose shape is `stat`, `timeseries`, or `distribution`. The series name is the query `name` (defaulting to its id), so the actual keys depend on the configured `queries`. A `stat` query contributes one sample per sync (building history over time), a `timeseries` query one sample per result row at that row timestamp, and a `distribution` query one sample per group at the sync time.',
    endpoint: 'SQL (SELECT, in a READ ONLY transaction)',
    notes:
      'Each sync replaces only the timestamp span it rewrites (replaceWindow), so history outside the current window survives an incremental sync.',
    dimensions: [
      {
        name: 'queryId',
        description: 'The configured id of the query that produced the sample.',
      },
      {
        name: 'series',
        description:
          'Group label for grouped queries, taken from the `series`/`label` column (or the query `columns.series` override). Absent for ungrouped queries.',
      },
    ],
    responses: { postgres_query_rows: queryRunnerRowsSchema },
  },
  '<query id> (entities)': {
    shape: 'entity',
    dynamic: true,
    description:
      'One entity per result row for declared queries whose shape is `entities`. The entity type is the query `name` (defaulting to its id) and the id comes from the row `id` column; every other column becomes an attribute. Each sync replaces the full set of rows for that type.',
    endpoint: 'SQL (SELECT, in a READ ONLY transaction)',
    filterable: [],
  },
});

export const id = 'postgres';

export const cost: ConnectorCost = {
  warning:
    'Every sync runs each declared query against your production database. Keep the SQL aggregate-only and indexed, and raise the sync interval rather than the statement timeout if queries get heavy.',
};

interface PgQueryResult {
  rows: QueryRow[];
}

export interface PgClient {
  connect(): Promise<void>;
  query(sql: string, params?: readonly unknown[]): Promise<PgQueryResult>;
  end(): Promise<void>;
}

export class PostgresQueryExecutor implements QueryExecutor {
  private client: PgClient | undefined;

  constructor(
    private readonly createClient: () => PgClient,
    private readonly logger: ConnectorLogger,
  ) {}

  private async ensureClient(): Promise<PgClient> {
    if (!this.client) {
      const client = this.createClient();
      await client.connect();
      this.client = client;
    }
    return this.client;
  }

  async run(
    request: QueryRequest,
    signal?: AbortSignal,
  ): Promise<readonly QueryRow[]> {
    signal?.throwIfAborted();
    let client: PgClient;
    try {
      client = await this.ensureClient();
    } catch (err) {
      throw mapPostgresError(err, request.queryId);
    }

    try {
      await client.query('begin read only');
      await client.query(
        `set local statement_timeout = ${Math.floor(request.statementTimeoutMs)}`,
      );
      const result = await client.query(request.sql, request.params);
      await client.query('rollback');
      return result.rows;
    } catch (err) {
      try {
        await client.query('rollback');
      } catch (rollbackErr) {
        this.logger.warn('rollback failed', {
          resource: request.queryId,
          error:
            rollbackErr instanceof Error
              ? rollbackErr.message
              : String(rollbackErr),
        });
      }
      throw mapPostgresError(err, request.queryId);
    }
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    if (!client) {
      return;
    }
    try {
      await client.end();
    } catch (err) {
      this.logger.warn('connection close failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export function shouldUseTls(
  connectionString: string,
  explicit: boolean | undefined,
): boolean {
  if (explicit !== undefined) {
    return explicit;
  }
  if (/[?&]sslmode=(disable|allow)\b/i.test(connectionString)) {
    return false;
  }
  return !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/i.test(connectionString);
}

export class PostgresConnector extends BaseConnector<
  PostgresSettings,
  PostgresCredentials
> {
  static readonly id = id;

  static readonly resources = postgresResources;

  static readonly schemas = schemasFromResources(postgresResources);

  static readonly cost = cost;

  static create(input: unknown, ctx?: ConnectorContext): PostgresConnector {
    const parsed = configFields.parse(input);
    return new PostgresConnector(
      {
        ssl: parsed.ssl,
        queries: parsed.queries,
        statementTimeoutMs: parsed.statementTimeoutMs,
        maxRowsPerQuery: parsed.maxRowsPerQuery,
        lookbackDays: parsed.lookbackDays,
      },
      { connectionString: parsed.connectionString },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = postgresCredentials;

  protected createExecutor(): QueryExecutor {
    const connectionString = this.creds.connectionString;
    if (typeof connectionString !== 'string' || connectionString.length === 0) {
      throw new ClientBugError(
        'PostgreSQL connector is missing a connection string.',
      );
    }
    const ssl = shouldUseTls(connectionString, this.settings.ssl);
    return new PostgresQueryExecutor(
      () =>
        new pg.Client({
          connectionString,
          application_name: 'rawdash',
          ...(ssl ? { ssl: { rejectUnauthorized: true } } : {}),
        }) as unknown as PgClient,
      this.logger,
    );
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    return runQueries({
      settings: this.settings,
      executor: this.createExecutor(),
      storage,
      options,
      logger: this.logger,
      signal,
    });
  }
}
