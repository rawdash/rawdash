import { type Client, createClient } from '@libsql/client';
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
  SyncState,
} from '@rawdash/core';
import type { ServerStorage } from '@rawdash/server';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { type LibSQLDatabase, drizzle } from 'drizzle-orm/libsql';

import { DDL, distributions, edges, entities, events, metrics } from './schema';

export interface TursoStorageOptions {
  url: string;
  authToken?: string;
}

type Attrs = Record<string, JSONValue>;

export class TursoStorage implements ServerStorage {
  private client: Client;
  private db: LibSQLDatabase<Record<string, never>>;
  private ready: Promise<void>;
  private syncState: SyncState = {
    status: 'idle',
    lastSyncAt: null,
    lastError: null,
  };

  constructor(options: TursoStorageOptions) {
    this.client = createClient({
      url: options.url,
      authToken: options.authToken,
    });
    this.db = drizzle(this.client);
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    for (const stmt of DDL) {
      await this.client.execute(stmt);
    }
  }

  getStorageHandle(connectorId: string): StorageHandle {
    const ready = this.ready;
    const db = this.db;

    return {
      event: async (e) => {
        await ready;
        await db.insert(events).values({
          connector_id: connectorId,
          name: e.name,
          start_ts: e.start_ts,
          end_ts: e.end_ts,
          attributes: e.attributes,
        });
      },

      entity: async (e) => {
        await ready;
        await db
          .insert(entities)
          .values({
            connector_id: connectorId,
            type: e.type,
            id: e.id,
            attributes: e.attributes,
            updated_at: e.updated_at,
          })
          .onConflictDoUpdate({
            target: [entities.connector_id, entities.type, entities.id],
            set: {
              attributes: e.attributes,
              updated_at: e.updated_at,
            },
          });
      },

      metric: async (m) => {
        await ready;
        await db.insert(metrics).values({
          connector_id: connectorId,
          name: m.name,
          ts: m.ts,
          value: m.value,
          attributes: m.attributes,
        });
      },

      edge: async (e) => {
        await ready;
        await db
          .insert(edges)
          .values({
            connector_id: connectorId,
            from_type: e.from_type,
            from_id: e.from_id,
            kind: e.kind,
            to_type: e.to_type,
            to_id: e.to_id,
            attributes: e.attributes,
            updated_at: e.updated_at,
          })
          .onConflictDoUpdate({
            target: [
              edges.connector_id,
              edges.from_type,
              edges.from_id,
              edges.kind,
              edges.to_type,
              edges.to_id,
            ],
            set: {
              attributes: e.attributes,
              updated_at: e.updated_at,
            },
          });
      },

      distribution: async (d) => {
        await ready;
        await db.insert(distributions).values({
          connector_id: connectorId,
          name: d.name,
          ts: d.ts,
          kind: d.kind,
          data: d.data as unknown as Attrs,
          attributes: d.attributes,
        });
      },

      events: async (es, scope) => {
        await ready;
        const names = Array.from(
          new Set(scope?.names ?? es.map((e) => e.name)),
        );
        const batch: BatchItem<'sqlite'>[] = [];
        if (names.length > 0) {
          batch.push(
            db
              .delete(events)
              .where(
                and(
                  eq(events.connector_id, connectorId),
                  inArray(events.name, names),
                ),
              ),
          );
        }
        if (es.length > 0) {
          batch.push(
            db.insert(events).values(
              es.map((e) => ({
                connector_id: connectorId,
                name: e.name,
                start_ts: e.start_ts,
                end_ts: e.end_ts,
                attributes: e.attributes,
              })),
            ),
          );
        }
        if (batch.length > 0) {
          await db.batch(
            batch as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]],
          );
        }
      },

      entities: async (es, scope) => {
        await ready;
        const types = Array.from(
          new Set(scope?.types ?? es.map((e) => e.type)),
        );
        const batch: BatchItem<'sqlite'>[] = [];
        if (types.length > 0) {
          batch.push(
            db
              .delete(entities)
              .where(
                and(
                  eq(entities.connector_id, connectorId),
                  inArray(entities.type, types),
                ),
              ),
          );
        }
        if (es.length > 0) {
          batch.push(
            db.insert(entities).values(
              es.map((e) => ({
                connector_id: connectorId,
                type: e.type,
                id: e.id,
                attributes: e.attributes,
                updated_at: e.updated_at,
              })),
            ),
          );
        }
        if (batch.length > 0) {
          await db.batch(
            batch as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]],
          );
        }
      },

      metrics: async (ms, scope) => {
        await ready;
        const names = Array.from(
          new Set(scope?.names ?? ms.map((m) => m.name)),
        );
        const batch: BatchItem<'sqlite'>[] = [];
        if (names.length > 0) {
          batch.push(
            db
              .delete(metrics)
              .where(
                and(
                  eq(metrics.connector_id, connectorId),
                  inArray(metrics.name, names),
                ),
              ),
          );
        }
        if (ms.length > 0) {
          batch.push(
            db.insert(metrics).values(
              ms.map((m) => ({
                connector_id: connectorId,
                name: m.name,
                ts: m.ts,
                value: m.value,
                attributes: m.attributes,
              })),
            ),
          );
        }
        if (batch.length > 0) {
          await db.batch(
            batch as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]],
          );
        }
      },

      edges: async (es, scope) => {
        await ready;
        const kinds = Array.from(
          new Set(scope?.kinds ?? es.map((e) => e.kind)),
        );
        const batch: BatchItem<'sqlite'>[] = [];
        if (kinds.length > 0) {
          batch.push(
            db
              .delete(edges)
              .where(
                and(
                  eq(edges.connector_id, connectorId),
                  inArray(edges.kind, kinds),
                ),
              ),
          );
        }
        for (const e of es) {
          batch.push(
            db
              .insert(edges)
              .values({
                connector_id: connectorId,
                from_type: e.from_type,
                from_id: e.from_id,
                kind: e.kind,
                to_type: e.to_type,
                to_id: e.to_id,
                attributes: e.attributes,
                updated_at: e.updated_at,
              })
              .onConflictDoUpdate({
                target: [
                  edges.connector_id,
                  edges.from_type,
                  edges.from_id,
                  edges.kind,
                  edges.to_type,
                  edges.to_id,
                ],
                set: {
                  attributes: e.attributes,
                  updated_at: e.updated_at,
                },
              }),
          );
        }
        if (batch.length > 0) {
          await db.batch(
            batch as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]],
          );
        }
      },

      distributions: async (ds, scope) => {
        await ready;
        const names = Array.from(
          new Set(scope?.names ?? ds.map((d) => d.name)),
        );
        const batch: BatchItem<'sqlite'>[] = [];
        if (names.length > 0) {
          batch.push(
            db
              .delete(distributions)
              .where(
                and(
                  eq(distributions.connector_id, connectorId),
                  inArray(distributions.name, names),
                ),
              ),
          );
        }
        if (ds.length > 0) {
          batch.push(
            db.insert(distributions).values(
              ds.map((d) => ({
                connector_id: connectorId,
                name: d.name,
                ts: d.ts,
                kind: d.kind,
                data: d.data as unknown as Attrs,
                attributes: d.attributes,
              })),
            ),
          );
        }
        if (batch.length > 0) {
          await db.batch(
            batch as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]],
          );
        }
      },

      queryEvents: async (q: EventQuery) => {
        await ready;
        const conds = [eq(events.connector_id, connectorId)];
        if (q.name !== undefined) {
          conds.push(eq(events.name, q.name));
        }
        if (q.start !== undefined) {
          conds.push(gte(events.start_ts, q.start));
        }
        if (q.end !== undefined) {
          conds.push(lte(events.start_ts, q.end));
        }
        const rows = await db
          .select()
          .from(events)
          .where(and(...conds));
        return rows.map(
          (r): Event => ({
            name: r.name,
            start_ts: r.start_ts,
            end_ts: r.end_ts,
            attributes: (r.attributes ?? {}) as Attrs,
          }),
        );
      },

      getEntity: async (type, id) => {
        await ready;
        const rows = await db
          .select()
          .from(entities)
          .where(
            and(
              eq(entities.connector_id, connectorId),
              eq(entities.type, type),
              eq(entities.id, id),
            ),
          )
          .limit(1);
        const r = rows[0];
        if (!r) {
          return null;
        }
        return {
          type: r.type,
          id: r.id,
          attributes: (r.attributes ?? {}) as Attrs,
          updated_at: r.updated_at,
        };
      },

      queryEntities: async (q: EntityQuery) => {
        await ready;
        const rows = await db
          .select()
          .from(entities)
          .where(
            and(
              eq(entities.connector_id, connectorId),
              eq(entities.type, q.type),
            ),
          );
        return rows.map(
          (r): Entity => ({
            type: r.type,
            id: r.id,
            attributes: (r.attributes ?? {}) as Attrs,
            updated_at: r.updated_at,
          }),
        );
      },

      queryMetrics: async (q: MetricQuery) => {
        await ready;
        const conds = [eq(metrics.connector_id, connectorId)];
        if (q.name !== undefined) {
          conds.push(eq(metrics.name, q.name));
        }
        if (q.start !== undefined) {
          conds.push(gte(metrics.ts, q.start));
        }
        if (q.end !== undefined) {
          conds.push(lte(metrics.ts, q.end));
        }
        const rows = await db
          .select()
          .from(metrics)
          .where(and(...conds));
        return rows.map(
          (r): Metric => ({
            name: r.name,
            ts: r.ts,
            value: r.value,
            attributes: (r.attributes ?? {}) as Attrs,
          }),
        );
      },

      traverse: async (q: EdgeQuery) => {
        await ready;
        const conds = [eq(edges.connector_id, connectorId)];
        if (q.fromType !== undefined) {
          conds.push(eq(edges.from_type, q.fromType));
        }
        if (q.fromId !== undefined) {
          conds.push(eq(edges.from_id, q.fromId));
        }
        if (q.kind !== undefined) {
          conds.push(eq(edges.kind, q.kind));
        }
        if (q.toType !== undefined) {
          conds.push(eq(edges.to_type, q.toType));
        }
        if (q.toId !== undefined) {
          conds.push(eq(edges.to_id, q.toId));
        }
        const rows = await db
          .select()
          .from(edges)
          .where(and(...conds));
        return rows.map(
          (r): Edge => ({
            from_type: r.from_type,
            from_id: r.from_id,
            kind: r.kind,
            to_type: r.to_type,
            to_id: r.to_id,
            attributes: (r.attributes ?? {}) as Attrs,
            updated_at: r.updated_at,
          }),
        );
      },

      queryDistributions: async (q: DistributionQuery) => {
        await ready;
        const conds = [eq(distributions.connector_id, connectorId)];
        if (q.name !== undefined) {
          conds.push(eq(distributions.name, q.name));
        }
        if (q.start !== undefined) {
          conds.push(gte(distributions.ts, q.start));
        }
        if (q.end !== undefined) {
          conds.push(lte(distributions.ts, q.end));
        }
        const rows = await db
          .select()
          .from(distributions)
          .where(and(...conds));
        return rows.map((r) => {
          const base = {
            name: r.name,
            ts: r.ts,
            attributes: (r.attributes ?? {}) as Attrs,
          };
          if (r.kind === 'histogram') {
            return {
              ...base,
              kind: 'histogram',
              data: r.data as Distribution['data'],
            } as Distribution;
          }
          if (r.kind === 'summary') {
            return {
              ...base,
              kind: 'summary',
              data: r.data as Distribution['data'],
            } as Distribution;
          }
          throw new Error(
            `Unknown distribution kind: ${r.kind} (name=${r.name})`,
          );
        });
      },
    };
  }

  getSyncState(): SyncState {
    return { ...this.syncState };
  }

  setSyncing(): void {
    this.syncState = { ...this.syncState, status: 'syncing' };
  }

  setSyncSuccess(): void {
    this.syncState = {
      status: 'idle',
      lastSyncAt: new Date().toISOString(),
      lastError: null,
    };
  }

  setSyncError(error: string): void {
    this.syncState = {
      status: 'error',
      lastSyncAt: this.syncState.lastSyncAt,
      lastError: error,
    };
  }

  async close(): Promise<void> {
    await this.ready.catch(() => undefined);
    this.client.close();
  }

  async waitUntilReady(): Promise<void> {
    return this.ready;
  }
}
