import type {
  Distribution,
  DistributionQuery,
  Edge,
  EdgeQuery,
  Entity,
  EntityQuery,
  Event,
  EventQuery,
  Metric,
  MetricQuery,
  StorageHandle,
  SyncState,
} from '@rawdash/core';

export class InMemoryStorage {
  private eventStore = new Map<string, Event[]>();
  private entityStore = new Map<string, Map<string, Map<string, Entity>>>();
  private metricStore = new Map<string, Metric[]>();
  private edgeStore = new Map<string, Edge[]>();
  private distributionStore = new Map<string, Distribution[]>();
  private syncState: SyncState = {
    status: 'idle',
    lastSyncAt: null,
    lastError: null,
  };

  getStorageHandle(connectorId: string): StorageHandle {
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
        index.set(`${e.from_type}:${e.from_id}:${e.kind}:${e.to_id}`, i);
      }
      for (const e of es) {
        const key = `${e.from_type}:${e.from_id}:${e.kind}:${e.to_id}`;
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
      },

      entity: async (e) => {
        upsertEntities([e]);
      },

      metric: async (m) => {
        if (!this.metricStore.has(connectorId)) {
          this.metricStore.set(connectorId, []);
        }
        this.metricStore.get(connectorId)!.push(m);
      },

      edge: async (e) => {
        upsertEdges([e]);
      },

      distribution: async (d) => {
        if (!this.distributionStore.has(connectorId)) {
          this.distributionStore.set(connectorId, []);
        }
        this.distributionStore.get(connectorId)!.push(d);
      },

      events: async (es) => {
        this.eventStore.set(connectorId, [...es]);
      },

      entities: async (es) => {
        this.entityStore.set(connectorId, new Map());
        upsertEntities(es);
      },

      metrics: async (ms) => {
        this.metricStore.set(connectorId, [...ms]);
      },

      edges: async (es) => {
        this.edgeStore.set(connectorId, []);
        upsertEdges(es);
      },

      distributions: async (ds) => {
        this.distributionStore.set(connectorId, [...ds]);
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
        if (!byType) {return [];}
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
}
