import type {
  ConnectorHealth,
  Distribution,
  DistributionQuery,
  Edge,
  EdgeQuery,
  Entity,
  EntityQuery,
  Event,
  EventQuery,
  MetricQuery,
  MetricSample,
  RollupBucket,
  RollupQuery,
  StorageHandle,
} from './connector';
import type { SyncState } from './engine';
import { dimsKey } from './rollup';
import type { GetStorageHandleOptions, ServerStorage } from './server-storage';
import { withAbortSignal } from './storage-handle-guard';

function rollupBucketKey(b: RollupBucket): string {
  return `${b.resource}|${b.field}|${b.granularity}|${dimsKey(b.dims)}|${b.bucketStart}`;
}

export class InMemoryStorage implements ServerStorage {
  private eventStore = new Map<string, Event[]>();
  private entityStore = new Map<string, Map<string, Map<string, Entity>>>();
  private metricStore = new Map<string, MetricSample[]>();
  private edgeStore = new Map<string, Edge[]>();
  private distributionStore = new Map<string, Distribution[]>();
  private rollupStore = new Map<string, Map<string, RollupBucket>>();
  private rollupWatermark = new Map<string, number>();
  private lastWriteAt = new Map<string, string>();
  private syncState: SyncState = {
    status: 'idle',
    queuedAt: null,
    startedAt: null,
    lastSyncAt: null,
    lastError: null,
  };

  getStorageHandle(
    connectorId: string,
    options?: GetStorageHandleOptions,
  ): StorageHandle {
    const handle = this.buildHandle(connectorId);
    return options?.signal ? withAbortSignal(handle, options.signal) : handle;
  }

  private buildHandle(connectorId: string): StorageHandle {
    const touch = (): void => {
      this.lastWriteAt.set(connectorId, new Date().toISOString());
    };
    const getEntityMap = (): Map<string, Map<string, Entity>> => {
      if (!this.entityStore.has(connectorId)) {
        this.entityStore.set(connectorId, new Map());
      }
      return this.entityStore.get(connectorId)!;
    };

    const upsertEntities = (es: Entity[]): void => {
      const byType = getEntityMap();
      for (const e of es) {
        if (!byType.has(e.type)) {
          byType.set(e.type, new Map());
        }
        byType.get(e.type)!.set(e.id, e);
      }
    };

    const upsertEdges = (es: Edge[]): void => {
      const existing = this.edgeStore.get(connectorId) ?? [];
      const index = new Map<string, number>();
      for (let i = 0; i < existing.length; i++) {
        const e = existing[i]!;
        index.set(
          `${e.from_type}:${e.from_id}:${e.kind}:${e.to_type}:${e.to_id}`,
          i,
        );
      }
      for (const e of es) {
        const key = `${e.from_type}:${e.from_id}:${e.kind}:${e.to_type}:${e.to_id}`;
        const idx = index.get(key);
        if (idx !== undefined) {
          existing[idx] = e;
        } else {
          index.set(key, existing.length);
          existing.push(e);
        }
      }
      this.edgeStore.set(connectorId, existing);
    };

    return {
      event: async (e) => {
        if (!this.eventStore.has(connectorId)) {
          this.eventStore.set(connectorId, []);
        }
        this.eventStore.get(connectorId)!.push(e);
        touch();
      },

      entity: async (e) => {
        upsertEntities([e]);
        touch();
      },

      metric: async (m) => {
        if (!this.metricStore.has(connectorId)) {
          this.metricStore.set(connectorId, []);
        }
        this.metricStore.get(connectorId)!.push(m);
        touch();
      },

      edge: async (e) => {
        upsertEdges([e]);
        touch();
      },

      distribution: async (d) => {
        if (!this.distributionStore.has(connectorId)) {
          this.distributionStore.set(connectorId, []);
        }
        this.distributionStore.get(connectorId)!.push(d);
        touch();
      },

      events: async (es, scope) => {
        const names = new Set(scope?.names ?? es.map((e) => e.name));
        const kept = (this.eventStore.get(connectorId) ?? []).filter(
          (e) => !names.has(e.name),
        );
        this.eventStore.set(connectorId, [...kept, ...es]);
        touch();
      },

      entities: async (es, scope) => {
        const byType = getEntityMap();
        const types = new Set(scope?.types ?? es.map((e) => e.type));
        for (const type of types) {
          byType.set(type, new Map());
        }
        upsertEntities(es);
        touch();
      },

      metrics: async (ms, scope) => {
        const names = new Set(scope?.names ?? ms.map((m) => m.name));
        const kept = (this.metricStore.get(connectorId) ?? []).filter(
          (m) => !names.has(m.name),
        );
        this.metricStore.set(connectorId, [...kept, ...ms]);
        touch();
      },

      edges: async (es, scope) => {
        const kinds = new Set(scope?.kinds ?? es.map((e) => e.kind));
        const kept = (this.edgeStore.get(connectorId) ?? []).filter(
          (e) => !kinds.has(e.kind),
        );
        this.edgeStore.set(connectorId, kept);
        upsertEdges(es);
        touch();
      },

      distributions: async (ds, scope) => {
        const names = new Set(scope?.names ?? ds.map((d) => d.name));
        const kept = (this.distributionStore.get(connectorId) ?? []).filter(
          (d) => !names.has(d.name),
        );
        this.distributionStore.set(connectorId, [...kept, ...ds]);
        touch();
      },

      queryEvents: async (q: EventQuery) => {
        let results = this.eventStore.get(connectorId) ?? [];
        if (q.name !== undefined) {
          results = results.filter((e) => e.name === q.name);
        }
        if (q.start !== undefined) {
          results = results.filter((e) => e.start_ts >= q.start!);
        }
        if (q.end !== undefined) {
          results = results.filter((e) => e.start_ts <= q.end!);
        }
        return results;
      },

      getEntity: async (type: string, id: string) => {
        return getEntityMap().get(type)?.get(id) ?? null;
      },

      queryEntities: async (q: EntityQuery) => {
        const byType = getEntityMap().get(q.type);
        if (!byType) {
          return [];
        }
        return Array.from(byType.values());
      },

      queryMetrics: async (q: MetricQuery) => {
        let results = this.metricStore.get(connectorId) ?? [];
        if (q.name !== undefined) {
          results = results.filter((m) => m.name === q.name);
        }
        if (q.start !== undefined) {
          results = results.filter((m) => m.ts >= q.start!);
        }
        if (q.end !== undefined) {
          results = results.filter((m) => m.ts <= q.end!);
        }
        return results;
      },

      traverse: async (q: EdgeQuery) => {
        let results = this.edgeStore.get(connectorId) ?? [];
        if (q.fromType !== undefined) {
          results = results.filter((e) => e.from_type === q.fromType);
        }
        if (q.fromId !== undefined) {
          results = results.filter((e) => e.from_id === q.fromId);
        }
        if (q.kind !== undefined) {
          results = results.filter((e) => e.kind === q.kind);
        }
        if (q.toType !== undefined) {
          results = results.filter((e) => e.to_type === q.toType);
        }
        if (q.toId !== undefined) {
          results = results.filter((e) => e.to_id === q.toId);
        }
        return results;
      },

      queryDistributions: async (q: DistributionQuery) => {
        let results = this.distributionStore.get(connectorId) ?? [];
        if (q.name !== undefined) {
          results = results.filter((d) => d.name === q.name);
        }
        if (q.start !== undefined) {
          results = results.filter((d) => d.ts >= q.start!);
        }
        if (q.end !== undefined) {
          results = results.filter((d) => d.ts <= q.end!);
        }
        return results;
      },

      deleteOlderThan: async (shape, tsUnixMs) => {
        if (shape === 'events') {
          const before = this.eventStore.get(connectorId) ?? [];
          const after = before.filter((e) => e.start_ts >= tsUnixMs);
          this.eventStore.set(connectorId, after);
          return { rowsDeleted: before.length - after.length };
        } else if (shape === 'metrics') {
          const before = this.metricStore.get(connectorId) ?? [];
          const after = before.filter((m) => m.ts >= tsUnixMs);
          this.metricStore.set(connectorId, after);
          return { rowsDeleted: before.length - after.length };
        } else if (shape === 'distributions') {
          const before = this.distributionStore.get(connectorId) ?? [];
          const after = before.filter((d) => d.ts >= tsUnixMs);
          this.distributionStore.set(connectorId, after);
          return { rowsDeleted: before.length - after.length };
        } else {
          throw new Error(
            `Unsupported shape for deleteOlderThan: ${String(shape)}`,
          );
        }
      },

      writeRollups: async (buckets) => {
        let store = this.rollupStore.get(connectorId);
        if (!store) {
          store = new Map();
          this.rollupStore.set(connectorId, store);
        }
        for (const b of buckets) {
          store.set(rollupBucketKey(b), {
            ...b,
            dims: { ...b.dims },
            partials: { ...b.partials },
          });
        }
        touch();
      },

      queryRollups: async (q: RollupQuery) => {
        const store = this.rollupStore.get(connectorId);
        if (!store) {
          return [];
        }
        let results = [...store.values()].filter(
          (b) => b.resource === q.resource,
        );
        if (q.field !== undefined) {
          results = results.filter((b) => b.field === q.field);
        }
        if (q.granularity !== undefined) {
          results = results.filter((b) => b.granularity === q.granularity);
        }
        if (q.start !== undefined) {
          results = results.filter((b) => b.bucketStart >= q.start!);
        }
        if (q.end !== undefined) {
          results = results.filter((b) => b.bucketStart < q.end!);
        }
        return results.map((b) => ({
          ...b,
          dims: { ...b.dims },
          partials: { ...b.partials },
        }));
      },

      getRollupWatermark: async (resource: string) => {
        return this.rollupWatermark.get(`${connectorId}:${resource}`) ?? null;
      },

      setRollupWatermark: async (resource: string, tsUnixMs: number) => {
        const key = `${connectorId}:${resource}`;
        const prev = this.rollupWatermark.get(key);
        this.rollupWatermark.set(
          key,
          prev === undefined ? tsUnixMs : Math.max(prev, tsUnixMs),
        );
        touch();
      },

      getHealth: async (): Promise<ConnectorHealth> => {
        return {
          status: 'idle',
          lastSyncAt: this.lastWriteAt.get(connectorId) ?? null,
          lastError: null,
          syncIntervalSeconds: 0,
        };
      },
    };
  }

  async getSyncState(): Promise<SyncState> {
    return { ...this.syncState };
  }

  async markSyncQueued(): Promise<boolean> {
    if (
      this.syncState.status === 'queued' ||
      this.syncState.status === 'running'
    ) {
      return false;
    }
    this.syncState = {
      ...this.syncState,
      status: 'queued',
      queuedAt: new Date().toISOString(),
      startedAt: null,
    };
    return true;
  }

  async markSyncRunning(): Promise<boolean> {
    if (this.syncState.status !== 'queued') {
      return false;
    }
    this.syncState = {
      ...this.syncState,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    return true;
  }

  async markSyncSucceeded(): Promise<void> {
    const now = new Date().toISOString();
    this.syncState = {
      status: 'succeeded',
      queuedAt: null,
      startedAt: null,
      lastSyncAt: now,
      lastError: null,
    };
  }

  async markSyncFailed(error: string): Promise<void> {
    this.syncState = {
      ...this.syncState,
      status: 'failed',
      queuedAt: null,
      startedAt: null,
      lastError: error,
    };
  }
}
