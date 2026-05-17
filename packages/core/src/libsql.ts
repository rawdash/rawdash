import type { Client, InValue } from '@libsql/client/web';
import { type CompiledQuery, type Insertable, Kysely } from 'kysely';
import { LibsqlDialect } from 'kysely-libsql';

import type {
  Distribution,
  DistributionQuery,
  Edge,
  EdgeQuery,
  Entity,
  EntityQuery,
  Event,
  EventQuery,
  JSONValue,
  MetricQuery,
  MetricSample,
  StorageHandle,
} from './connector';
import type {
  Database,
  EdgesTable,
  EntitiesTable,
  EventsTable,
  MetricsTable,
} from './db/schema';
import type { SyncState } from './engine';
import type { ServerStorage } from './server-storage';

type Attrs = Record<string, JSONValue>;

const SYNC_STATE_ID = 1;

const CREATE_TABLES_SQL = [
  `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connector_id TEXT NOT NULL,
    name TEXT NOT NULL,
    start_ts INTEGER NOT NULL,
    end_ts INTEGER,
    attributes TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE INDEX IF NOT EXISTS events_conn_name_start ON events (connector_id, name, start_ts)`,
  `CREATE TABLE IF NOT EXISTS entities (
    connector_id TEXT NOT NULL,
    type TEXT NOT NULL,
    id TEXT NOT NULL,
    attributes TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (connector_id, type, id)
  )`,
  `CREATE INDEX IF NOT EXISTS entities_conn_type ON entities (connector_id, type)`,
  `CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connector_id TEXT NOT NULL,
    name TEXT NOT NULL,
    ts INTEGER NOT NULL,
    value REAL NOT NULL,
    attributes TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE INDEX IF NOT EXISTS metrics_conn_name_ts ON metrics (connector_id, name, ts)`,
  `CREATE TABLE IF NOT EXISTS edges (
    connector_id TEXT NOT NULL,
    from_type TEXT NOT NULL,
    from_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    to_type TEXT NOT NULL,
    to_id TEXT NOT NULL,
    attributes TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (connector_id, from_type, from_id, kind, to_type, to_id)
  )`,
  `CREATE INDEX IF NOT EXISTS edges_conn_kind ON edges (connector_id, kind)`,
  `CREATE INDEX IF NOT EXISTS edges_conn_from ON edges (connector_id, from_type, from_id)`,
  `CREATE INDEX IF NOT EXISTS edges_conn_to ON edges (connector_id, to_type, to_id)`,
  `CREATE TABLE IF NOT EXISTS distributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connector_id TEXT NOT NULL,
    name TEXT NOT NULL,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    data TEXT NOT NULL,
    attributes TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE INDEX IF NOT EXISTS distributions_conn_name_ts ON distributions (connector_id, name, ts)`,
  `CREATE TABLE IF NOT EXISTS sync_state (
    id INTEGER PRIMARY KEY,
    status TEXT NOT NULL,
    last_sync_at TEXT,
    last_error TEXT
  )`,
];

export async function initLibsqlSchema(client: Client): Promise<void> {
  for (const stmt of CREATE_TABLES_SQL) {
    await client.execute(stmt);
  }
  await client.execute({
    sql: "INSERT OR IGNORE INTO sync_state (id, status, last_sync_at, last_error) VALUES (?, 'idle', NULL, NULL)",
    args: [SYNC_STATE_ID],
  });
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function createDb(client: Client): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new LibsqlDialect({ client }),
  });
}

function toBatchStmt(q: CompiledQuery): { sql: string; args: InValue[] } {
  return { sql: q.sql, args: q.parameters as InValue[] };
}

export interface LibsqlStorageOptions {
  client: Client;
  initSchema?: boolean;
}

export class LibsqlStorage implements ServerStorage {
  private client: Client;
  private db: Kysely<Database>;
  private ready: Promise<void>;
  private initError: string | null = null;

  constructor(options: LibsqlStorageOptions) {
    this.client = options.client;
    this.db = createDb(options.client);
    this.ready = options.initSchema === false ? Promise.resolve() : this.init();
  }

  private async init(): Promise<void> {
    try {
      await initLibsqlSchema(this.client);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.initError = `init failed: ${message}`;
      throw err;
    }
  }

  async waitUntilReady(): Promise<void> {
    return this.ready;
  }

  getStorageHandle(connectorId: string): StorageHandle {
    const ready = this.ready;
    const db = this.db;
    const client = this.client;

    const eventRow = (e: Event): Insertable<EventsTable> => ({
      connector_id: connectorId,
      name: e.name,
      start_ts: e.start_ts,
      end_ts: e.end_ts,
      attributes: JSON.stringify(e.attributes),
    });

    const entityRow = (e: Entity): Insertable<EntitiesTable> => ({
      connector_id: connectorId,
      type: e.type,
      id: e.id,
      attributes: JSON.stringify(e.attributes),
      updated_at: e.updated_at,
    });

    const metricRow = (m: MetricSample): Insertable<MetricsTable> => ({
      connector_id: connectorId,
      name: m.name,
      ts: m.ts,
      value: m.value,
      attributes: JSON.stringify(m.attributes),
    });

    const edgeRow = (e: Edge): Insertable<EdgesTable> => ({
      connector_id: connectorId,
      from_type: e.from_type,
      from_id: e.from_id,
      kind: e.kind,
      to_type: e.to_type,
      to_id: e.to_id,
      attributes: JSON.stringify(e.attributes),
      updated_at: e.updated_at,
    });

    const distributionRow = (d: Distribution) => ({
      connector_id: connectorId,
      name: d.name,
      ts: d.ts,
      kind: d.kind,
      data: JSON.stringify(d.data),
      attributes: JSON.stringify(d.attributes),
    });

    return {
      event: async (e) => {
        await ready;
        await db.insertInto('events').values(eventRow(e)).execute();
      },

      entity: async (e) => {
        await ready;
        await db
          .insertInto('entities')
          .values(entityRow(e))
          .onConflict((oc) =>
            oc.columns(['connector_id', 'type', 'id']).doUpdateSet({
              attributes: (eb) => eb.ref('excluded.attributes'),
              updated_at: (eb) => eb.ref('excluded.updated_at'),
            }),
          )
          .execute();
      },

      metric: async (m) => {
        await ready;
        await db.insertInto('metrics').values(metricRow(m)).execute();
      },

      edge: async (e) => {
        await ready;
        await db
          .insertInto('edges')
          .values(edgeRow(e))
          .onConflict((oc) =>
            oc
              .columns([
                'connector_id',
                'from_type',
                'from_id',
                'kind',
                'to_type',
                'to_id',
              ])
              .doUpdateSet({
                attributes: (eb) => eb.ref('excluded.attributes'),
                updated_at: (eb) => eb.ref('excluded.updated_at'),
              }),
          )
          .execute();
      },

      distribution: async (d) => {
        await ready;
        await db
          .insertInto('distributions')
          .values(distributionRow(d))
          .execute();
      },

      events: async (es, scope) => {
        await ready;
        const names = Array.from(
          new Set(scope?.names ?? es.map((e) => e.name)),
        );
        const stmts: { sql: string; args: InValue[] }[] = [];
        if (names.length > 0) {
          stmts.push(
            toBatchStmt(
              db
                .deleteFrom('events')
                .where('connector_id', '=', connectorId)
                .where('name', 'in', names)
                .compile(),
            ),
          );
        }
        if (es.length > 0) {
          stmts.push(
            toBatchStmt(
              db.insertInto('events').values(es.map(eventRow)).compile(),
            ),
          );
        }
        if (stmts.length > 0) {
          await client.batch(stmts, 'write');
        }
      },

      entities: async (es, scope) => {
        await ready;
        const types = Array.from(
          new Set(scope?.types ?? es.map((e) => e.type)),
        );
        const stmts: { sql: string; args: InValue[] }[] = [];
        if (types.length > 0) {
          stmts.push(
            toBatchStmt(
              db
                .deleteFrom('entities')
                .where('connector_id', '=', connectorId)
                .where('type', 'in', types)
                .compile(),
            ),
          );
        }
        if (es.length > 0) {
          stmts.push(
            toBatchStmt(
              db
                .insertInto('entities')
                .values(es.map(entityRow))
                .onConflict((oc) =>
                  oc.columns(['connector_id', 'type', 'id']).doUpdateSet({
                    attributes: (eb) => eb.ref('excluded.attributes'),
                    updated_at: (eb) => eb.ref('excluded.updated_at'),
                  }),
                )
                .compile(),
            ),
          );
        }
        if (stmts.length > 0) {
          await client.batch(stmts, 'write');
        }
      },

      metrics: async (ms, scope) => {
        await ready;
        const names = Array.from(
          new Set(scope?.names ?? ms.map((m) => m.name)),
        );
        const stmts: { sql: string; args: InValue[] }[] = [];
        if (names.length > 0) {
          stmts.push(
            toBatchStmt(
              db
                .deleteFrom('metrics')
                .where('connector_id', '=', connectorId)
                .where('name', 'in', names)
                .compile(),
            ),
          );
        }
        if (ms.length > 0) {
          stmts.push(
            toBatchStmt(
              db.insertInto('metrics').values(ms.map(metricRow)).compile(),
            ),
          );
        }
        if (stmts.length > 0) {
          await client.batch(stmts, 'write');
        }
      },

      edges: async (es, scope) => {
        await ready;
        const kinds = Array.from(
          new Set(scope?.kinds ?? es.map((e) => e.kind)),
        );
        const stmts: { sql: string; args: InValue[] }[] = [];
        if (kinds.length > 0) {
          stmts.push(
            toBatchStmt(
              db
                .deleteFrom('edges')
                .where('connector_id', '=', connectorId)
                .where('kind', 'in', kinds)
                .compile(),
            ),
          );
        }
        if (es.length > 0) {
          stmts.push(
            toBatchStmt(
              db
                .insertInto('edges')
                .values(es.map(edgeRow))
                .onConflict((oc) =>
                  oc
                    .columns([
                      'connector_id',
                      'from_type',
                      'from_id',
                      'kind',
                      'to_type',
                      'to_id',
                    ])
                    .doUpdateSet({
                      attributes: (eb) => eb.ref('excluded.attributes'),
                      updated_at: (eb) => eb.ref('excluded.updated_at'),
                    }),
                )
                .compile(),
            ),
          );
        }
        if (stmts.length > 0) {
          await client.batch(stmts, 'write');
        }
      },

      distributions: async (ds, scope) => {
        await ready;
        const names = Array.from(
          new Set(scope?.names ?? ds.map((d) => d.name)),
        );
        const stmts: { sql: string; args: InValue[] }[] = [];
        if (names.length > 0) {
          stmts.push(
            toBatchStmt(
              db
                .deleteFrom('distributions')
                .where('connector_id', '=', connectorId)
                .where('name', 'in', names)
                .compile(),
            ),
          );
        }
        if (ds.length > 0) {
          stmts.push(
            toBatchStmt(
              db
                .insertInto('distributions')
                .values(ds.map(distributionRow))
                .compile(),
            ),
          );
        }
        if (stmts.length > 0) {
          await client.batch(stmts, 'write');
        }
      },

      queryEvents: async (q: EventQuery) => {
        await ready;
        let qb = db
          .selectFrom('events')
          .select(['name', 'start_ts', 'end_ts', 'attributes'])
          .where('connector_id', '=', connectorId);
        if (q.name !== undefined) {
          qb = qb.where('name', '=', q.name);
        }
        if (q.start !== undefined) {
          qb = qb.where('start_ts', '>=', q.start);
        }
        if (q.end !== undefined) {
          qb = qb.where('start_ts', '<=', q.end);
        }
        const rows = await qb.execute();
        return rows.map(
          (r): Event => ({
            name: r.name,
            start_ts: Number(r.start_ts),
            end_ts: r.end_ts === null ? null : Number(r.end_ts),
            attributes: parseJson<Attrs>(r.attributes, {}),
          }),
        );
      },

      getEntity: async (type, id) => {
        await ready;
        const r = await db
          .selectFrom('entities')
          .select(['type', 'id', 'attributes', 'updated_at'])
          .where('connector_id', '=', connectorId)
          .where('type', '=', type)
          .where('id', '=', id)
          .limit(1)
          .executeTakeFirst();
        if (!r) {
          return null;
        }
        return {
          type: r.type,
          id: r.id,
          attributes: parseJson<Attrs>(r.attributes, {}),
          updated_at: Number(r.updated_at),
        };
      },

      queryEntities: async (q: EntityQuery) => {
        await ready;
        const rows = await db
          .selectFrom('entities')
          .select(['type', 'id', 'attributes', 'updated_at'])
          .where('connector_id', '=', connectorId)
          .where('type', '=', q.type)
          .execute();
        return rows.map(
          (r): Entity => ({
            type: r.type,
            id: r.id,
            attributes: parseJson<Attrs>(r.attributes, {}),
            updated_at: Number(r.updated_at),
          }),
        );
      },

      queryMetrics: async (q: MetricQuery) => {
        await ready;
        let qb = db
          .selectFrom('metrics')
          .select(['name', 'ts', 'value', 'attributes'])
          .where('connector_id', '=', connectorId);
        if (q.name !== undefined) {
          qb = qb.where('name', '=', q.name);
        }
        if (q.start !== undefined) {
          qb = qb.where('ts', '>=', q.start);
        }
        if (q.end !== undefined) {
          qb = qb.where('ts', '<=', q.end);
        }
        const rows = await qb.execute();
        return rows.map(
          (r): MetricSample => ({
            name: r.name,
            ts: Number(r.ts),
            value: Number(r.value),
            attributes: parseJson<Attrs>(r.attributes, {}),
          }),
        );
      },

      traverse: async (q: EdgeQuery) => {
        await ready;
        let qb = db
          .selectFrom('edges')
          .select([
            'from_type',
            'from_id',
            'kind',
            'to_type',
            'to_id',
            'attributes',
            'updated_at',
          ])
          .where('connector_id', '=', connectorId);
        if (q.fromType !== undefined) {
          qb = qb.where('from_type', '=', q.fromType);
        }
        if (q.fromId !== undefined) {
          qb = qb.where('from_id', '=', q.fromId);
        }
        if (q.kind !== undefined) {
          qb = qb.where('kind', '=', q.kind);
        }
        if (q.toType !== undefined) {
          qb = qb.where('to_type', '=', q.toType);
        }
        if (q.toId !== undefined) {
          qb = qb.where('to_id', '=', q.toId);
        }
        const rows = await qb.execute();
        return rows.map(
          (r): Edge => ({
            from_type: r.from_type,
            from_id: r.from_id,
            kind: r.kind,
            to_type: r.to_type,
            to_id: r.to_id,
            attributes: parseJson<Attrs>(r.attributes, {}),
            updated_at: Number(r.updated_at),
          }),
        );
      },

      queryDistributions: async (q: DistributionQuery) => {
        await ready;
        let qb = db
          .selectFrom('distributions')
          .select(['name', 'ts', 'kind', 'data', 'attributes'])
          .where('connector_id', '=', connectorId);
        if (q.name !== undefined) {
          qb = qb.where('name', '=', q.name);
        }
        if (q.start !== undefined) {
          qb = qb.where('ts', '>=', q.start);
        }
        if (q.end !== undefined) {
          qb = qb.where('ts', '<=', q.end);
        }
        const rows = await qb.execute();
        return rows.map((r) => {
          const base = {
            name: r.name,
            ts: Number(r.ts),
            attributes: parseJson<Attrs>(r.attributes, {}),
          };
          const data = parseJson<Distribution['data']>(r.data, {
            count: 0,
            sum: 0,
          } as unknown as Distribution['data']);
          if (r.kind === 'histogram') {
            return { ...base, kind: 'histogram', data } as Distribution;
          }
          if (r.kind === 'summary') {
            return { ...base, kind: 'summary', data } as Distribution;
          }
          throw new Error(
            `Unknown distribution kind: ${r.kind} (name=${base.name})`,
          );
        });
      },

      deleteOlderThan: async (shape, tsUnixMs) => {
        await ready;
        if (shape === 'events') {
          const r = await db
            .deleteFrom('events')
            .where('connector_id', '=', connectorId)
            .where('start_ts', '<', tsUnixMs)
            .executeTakeFirst();
          return { rowsDeleted: Number(r.numDeletedRows) };
        }
        if (shape === 'metrics') {
          const r = await db
            .deleteFrom('metrics')
            .where('connector_id', '=', connectorId)
            .where('ts', '<', tsUnixMs)
            .executeTakeFirst();
          return { rowsDeleted: Number(r.numDeletedRows) };
        }
        if (shape === 'distributions') {
          const r = await db
            .deleteFrom('distributions')
            .where('connector_id', '=', connectorId)
            .where('ts', '<', tsUnixMs)
            .executeTakeFirst();
          return { rowsDeleted: Number(r.numDeletedRows) };
        }
        throw new Error(
          `Unsupported shape for deleteOlderThan: ${String(shape)}`,
        );
      },
    };
  }

  async getSyncState(): Promise<SyncState> {
    if (this.initError !== null) {
      return { status: 'error', lastSyncAt: null, lastError: this.initError };
    }
    await this.ready;
    const r = await this.db
      .selectFrom('sync_state')
      .select(['status', 'last_sync_at', 'last_error'])
      .where('id', '=', SYNC_STATE_ID)
      .limit(1)
      .executeTakeFirst();
    if (!r) {
      return { status: 'idle', lastSyncAt: null, lastError: null };
    }
    return {
      status: r.status as SyncState['status'],
      lastSyncAt: r.last_sync_at,
      lastError: r.last_error,
    };
  }

  async setSyncing(): Promise<boolean> {
    await this.ready;
    const r = await this.db
      .updateTable('sync_state')
      .set({ status: 'syncing' })
      .where('id', '=', SYNC_STATE_ID)
      .where('status', '!=', 'syncing')
      .executeTakeFirst();
    return Number(r.numUpdatedRows) > 0;
  }

  async setSyncSuccess(): Promise<void> {
    await this.ready;
    await this.db
      .updateTable('sync_state')
      .set({
        status: 'idle',
        last_sync_at: new Date().toISOString(),
        last_error: null,
      })
      .where('id', '=', SYNC_STATE_ID)
      .execute();
  }

  async setSyncError(error: string): Promise<void> {
    await this.ready;
    await this.db
      .updateTable('sync_state')
      .set({ status: 'error', last_error: error })
      .where('id', '=', SYNC_STATE_ID)
      .execute();
  }
}
