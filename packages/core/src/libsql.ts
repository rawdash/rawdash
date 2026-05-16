import type { Client, InValue } from '@libsql/client/web';

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
  Metric,
  MetricQuery,
  StorageHandle,
} from './connector';
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
  for (const sql of CREATE_TABLES_SQL) {
    await client.execute(sql);
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

export interface LibsqlStorageOptions {
  client: Client;
  initSchema?: boolean;
}

export class LibsqlStorage implements ServerStorage {
  private client: Client;
  private ready: Promise<void>;
  private initError: string | null = null;

  constructor(options: LibsqlStorageOptions) {
    this.client = options.client;
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
    const client = this.client;

    const insertEvent = (e: Event): { sql: string; args: InValue[] } => ({
      sql: 'INSERT INTO events (connector_id, name, start_ts, end_ts, attributes) VALUES (?, ?, ?, ?, ?)',
      args: [
        connectorId,
        e.name,
        e.start_ts,
        e.end_ts,
        JSON.stringify(e.attributes),
      ],
    });

    const upsertEntity = (e: Entity): { sql: string; args: InValue[] } => ({
      sql: `INSERT INTO entities (connector_id, type, id, attributes, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (connector_id, type, id)
            DO UPDATE SET attributes = excluded.attributes, updated_at = excluded.updated_at`,
      args: [
        connectorId,
        e.type,
        e.id,
        JSON.stringify(e.attributes),
        e.updated_at,
      ],
    });

    const insertMetric = (m: Metric): { sql: string; args: InValue[] } => ({
      sql: 'INSERT INTO metrics (connector_id, name, ts, value, attributes) VALUES (?, ?, ?, ?, ?)',
      args: [connectorId, m.name, m.ts, m.value, JSON.stringify(m.attributes)],
    });

    const upsertEdge = (e: Edge): { sql: string; args: InValue[] } => ({
      sql: `INSERT INTO edges (connector_id, from_type, from_id, kind, to_type, to_id, attributes, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (connector_id, from_type, from_id, kind, to_type, to_id)
            DO UPDATE SET attributes = excluded.attributes, updated_at = excluded.updated_at`,
      args: [
        connectorId,
        e.from_type,
        e.from_id,
        e.kind,
        e.to_type,
        e.to_id,
        JSON.stringify(e.attributes),
        e.updated_at,
      ],
    });

    const insertDistribution = (
      d: Distribution,
    ): { sql: string; args: InValue[] } => ({
      sql: 'INSERT INTO distributions (connector_id, name, ts, kind, data, attributes) VALUES (?, ?, ?, ?, ?, ?)',
      args: [
        connectorId,
        d.name,
        d.ts,
        d.kind,
        JSON.stringify(d.data),
        JSON.stringify(d.attributes),
      ],
    });

    const inPlaceholders = (n: number): string =>
      Array.from({ length: n }, () => '?').join(', ');

    return {
      event: async (e) => {
        await ready;
        await client.execute(insertEvent(e));
      },

      entity: async (e) => {
        await ready;
        await client.execute(upsertEntity(e));
      },

      metric: async (m) => {
        await ready;
        await client.execute(insertMetric(m));
      },

      edge: async (e) => {
        await ready;
        await client.execute(upsertEdge(e));
      },

      distribution: async (d) => {
        await ready;
        await client.execute(insertDistribution(d));
      },

      events: async (es, scope) => {
        await ready;
        const names = Array.from(
          new Set(scope?.names ?? es.map((e) => e.name)),
        );
        const stmts: { sql: string; args: InValue[] }[] = [];
        if (names.length > 0) {
          stmts.push({
            sql: `DELETE FROM events WHERE connector_id = ? AND name IN (${inPlaceholders(names.length)})`,
            args: [connectorId, ...names],
          });
        }
        for (const e of es) {
          stmts.push(insertEvent(e));
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
          stmts.push({
            sql: `DELETE FROM entities WHERE connector_id = ? AND type IN (${inPlaceholders(types.length)})`,
            args: [connectorId, ...types],
          });
        }
        for (const e of es) {
          stmts.push(upsertEntity(e));
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
          stmts.push({
            sql: `DELETE FROM metrics WHERE connector_id = ? AND name IN (${inPlaceholders(names.length)})`,
            args: [connectorId, ...names],
          });
        }
        for (const m of ms) {
          stmts.push(insertMetric(m));
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
          stmts.push({
            sql: `DELETE FROM edges WHERE connector_id = ? AND kind IN (${inPlaceholders(kinds.length)})`,
            args: [connectorId, ...kinds],
          });
        }
        for (const e of es) {
          stmts.push(upsertEdge(e));
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
          stmts.push({
            sql: `DELETE FROM distributions WHERE connector_id = ? AND name IN (${inPlaceholders(names.length)})`,
            args: [connectorId, ...names],
          });
        }
        for (const d of ds) {
          stmts.push(insertDistribution(d));
        }
        if (stmts.length > 0) {
          await client.batch(stmts, 'write');
        }
      },

      queryEvents: async (q: EventQuery) => {
        await ready;
        const conds = ['connector_id = ?'];
        const args: InValue[] = [connectorId];
        if (q.name !== undefined) {
          conds.push('name = ?');
          args.push(q.name);
        }
        if (q.start !== undefined) {
          conds.push('start_ts >= ?');
          args.push(q.start);
        }
        if (q.end !== undefined) {
          conds.push('start_ts <= ?');
          args.push(q.end);
        }
        const result = await client.execute({
          sql: `SELECT name, start_ts, end_ts, attributes FROM events WHERE ${conds.join(' AND ')}`,
          args,
        });
        return result.rows.map(
          (r): Event => ({
            name: r.name as string,
            start_ts: Number(r.start_ts),
            end_ts: r.end_ts === null ? null : Number(r.end_ts),
            attributes: parseJson<Attrs>(r.attributes, {}),
          }),
        );
      },

      getEntity: async (type, id) => {
        await ready;
        const result = await client.execute({
          sql: 'SELECT type, id, attributes, updated_at FROM entities WHERE connector_id = ? AND type = ? AND id = ? LIMIT 1',
          args: [connectorId, type, id],
        });
        const r = result.rows[0];
        if (!r) {
          return null;
        }
        return {
          type: r.type as string,
          id: r.id as string,
          attributes: parseJson<Attrs>(r.attributes, {}),
          updated_at: Number(r.updated_at),
        };
      },

      queryEntities: async (q: EntityQuery) => {
        await ready;
        const result = await client.execute({
          sql: 'SELECT type, id, attributes, updated_at FROM entities WHERE connector_id = ? AND type = ?',
          args: [connectorId, q.type],
        });
        return result.rows.map(
          (r): Entity => ({
            type: r.type as string,
            id: r.id as string,
            attributes: parseJson<Attrs>(r.attributes, {}),
            updated_at: Number(r.updated_at),
          }),
        );
      },

      queryMetrics: async (q: MetricQuery) => {
        await ready;
        const conds = ['connector_id = ?'];
        const args: InValue[] = [connectorId];
        if (q.name !== undefined) {
          conds.push('name = ?');
          args.push(q.name);
        }
        if (q.start !== undefined) {
          conds.push('ts >= ?');
          args.push(q.start);
        }
        if (q.end !== undefined) {
          conds.push('ts <= ?');
          args.push(q.end);
        }
        const result = await client.execute({
          sql: `SELECT name, ts, value, attributes FROM metrics WHERE ${conds.join(' AND ')}`,
          args,
        });
        return result.rows.map(
          (r): Metric => ({
            name: r.name as string,
            ts: Number(r.ts),
            value: Number(r.value),
            attributes: parseJson<Attrs>(r.attributes, {}),
          }),
        );
      },

      traverse: async (q: EdgeQuery) => {
        await ready;
        const conds = ['connector_id = ?'];
        const args: InValue[] = [connectorId];
        if (q.fromType !== undefined) {
          conds.push('from_type = ?');
          args.push(q.fromType);
        }
        if (q.fromId !== undefined) {
          conds.push('from_id = ?');
          args.push(q.fromId);
        }
        if (q.kind !== undefined) {
          conds.push('kind = ?');
          args.push(q.kind);
        }
        if (q.toType !== undefined) {
          conds.push('to_type = ?');
          args.push(q.toType);
        }
        if (q.toId !== undefined) {
          conds.push('to_id = ?');
          args.push(q.toId);
        }
        const result = await client.execute({
          sql: `SELECT from_type, from_id, kind, to_type, to_id, attributes, updated_at FROM edges WHERE ${conds.join(' AND ')}`,
          args,
        });
        return result.rows.map(
          (r): Edge => ({
            from_type: r.from_type as string,
            from_id: r.from_id as string,
            kind: r.kind as string,
            to_type: r.to_type as string,
            to_id: r.to_id as string,
            attributes: parseJson<Attrs>(r.attributes, {}),
            updated_at: Number(r.updated_at),
          }),
        );
      },

      queryDistributions: async (q: DistributionQuery) => {
        await ready;
        const conds = ['connector_id = ?'];
        const args: InValue[] = [connectorId];
        if (q.name !== undefined) {
          conds.push('name = ?');
          args.push(q.name);
        }
        if (q.start !== undefined) {
          conds.push('ts >= ?');
          args.push(q.start);
        }
        if (q.end !== undefined) {
          conds.push('ts <= ?');
          args.push(q.end);
        }
        const result = await client.execute({
          sql: `SELECT name, ts, kind, data, attributes FROM distributions WHERE ${conds.join(' AND ')}`,
          args,
        });
        return result.rows.map((r) => {
          const base = {
            name: r.name as string,
            ts: Number(r.ts),
            attributes: parseJson<Attrs>(r.attributes, {}),
          };
          const kind = r.kind as string;
          const data = parseJson<Distribution['data']>(r.data, {
            count: 0,
            sum: 0,
          } as unknown as Distribution['data']);
          if (kind === 'histogram') {
            return { ...base, kind: 'histogram', data } as Distribution;
          }
          if (kind === 'summary') {
            return { ...base, kind: 'summary', data } as Distribution;
          }
          throw new Error(
            `Unknown distribution kind: ${kind} (name=${base.name})`,
          );
        });
      },

      deleteOlderThan: async (shape, tsUnixMs) => {
        await ready;
        const tsCol = shape === 'events' ? 'start_ts' : 'ts';
        if (
          shape !== 'events' &&
          shape !== 'metrics' &&
          shape !== 'distributions'
        ) {
          throw new Error(
            `Unsupported shape for deleteOlderThan: ${String(shape)}`,
          );
        }
        const result = await client.execute({
          sql: `DELETE FROM ${shape} WHERE connector_id = ? AND ${tsCol} < ?`,
          args: [connectorId, tsUnixMs],
        });
        return { rowsDeleted: result.rowsAffected };
      },
    };
  }

  async getSyncState(): Promise<SyncState> {
    if (this.initError !== null) {
      return { status: 'error', lastSyncAt: null, lastError: this.initError };
    }
    await this.ready;
    const result = await this.client.execute({
      sql: 'SELECT status, last_sync_at, last_error FROM sync_state WHERE id = ? LIMIT 1',
      args: [SYNC_STATE_ID],
    });
    const r = result.rows[0];
    if (!r) {
      return { status: 'idle', lastSyncAt: null, lastError: null };
    }
    return {
      status: r.status as SyncState['status'],
      lastSyncAt: r.last_sync_at as string | null,
      lastError: r.last_error as string | null,
    };
  }

  async setSyncing(): Promise<boolean> {
    await this.ready;
    const result = await this.client.execute({
      sql: "UPDATE sync_state SET status = 'syncing' WHERE id = ? AND status != 'syncing'",
      args: [SYNC_STATE_ID],
    });
    return result.rowsAffected > 0;
  }

  async setSyncSuccess(): Promise<void> {
    await this.ready;
    await this.client.execute({
      sql: "UPDATE sync_state SET status = 'idle', last_sync_at = ?, last_error = NULL WHERE id = ?",
      args: [new Date().toISOString(), SYNC_STATE_ID],
    });
  }

  async setSyncError(error: string): Promise<void> {
    await this.ready;
    await this.client.execute({
      sql: "UPDATE sync_state SET status = 'error', last_error = ? WHERE id = ?",
      args: [error, SYNC_STATE_ID],
    });
  }
}
