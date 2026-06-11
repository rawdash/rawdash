import type { StorageHandle } from './connector';

export function withAbortSignal(
  handle: StorageHandle,
  signal: AbortSignal,
): StorageHandle {
  let warned = false;
  const warnOnce = (method: string): void => {
    if (warned) {
      return;
    }
    warned = true;
    console.warn(
      `[rawdash storage] dropping post-abort write '${method}' — connector continued writing after AbortSignal fired`,
    );
  };

  return {
    event: async (e) => {
      if (signal.aborted) {
        warnOnce('event');
        return;
      }
      await handle.event(e);
    },
    entity: async (e) => {
      if (signal.aborted) {
        warnOnce('entity');
        return;
      }
      await handle.entity(e);
    },
    metric: async (m) => {
      if (signal.aborted) {
        warnOnce('metric');
        return;
      }
      await handle.metric(m);
    },
    edge: async (e) => {
      if (signal.aborted) {
        warnOnce('edge');
        return;
      }
      await handle.edge(e);
    },
    distribution: async (d) => {
      if (signal.aborted) {
        warnOnce('distribution');
        return;
      }
      await handle.distribution(d);
    },
    events: async (es, scope) => {
      if (signal.aborted) {
        warnOnce('events');
        return;
      }
      await handle.events(es, scope);
    },
    entities: async (es, scope) => {
      if (signal.aborted) {
        warnOnce('entities');
        return;
      }
      await handle.entities(es, scope);
    },
    metrics: async (ms, scope) => {
      if (signal.aborted) {
        warnOnce('metrics');
        return;
      }
      await handle.metrics(ms, scope);
    },
    edges: async (es, scope) => {
      if (signal.aborted) {
        warnOnce('edges');
        return;
      }
      await handle.edges(es, scope);
    },
    distributions: async (ds, scope) => {
      if (signal.aborted) {
        warnOnce('distributions');
        return;
      }
      await handle.distributions(ds, scope);
    },
    deleteOlderThan: async (shape, tsUnixMs) => {
      if (signal.aborted) {
        warnOnce('deleteOlderThan');
        return { rowsDeleted: 0 };
      }
      return handle.deleteOlderThan(shape, tsUnixMs);
    },
    queryEvents: (q) => handle.queryEvents(q),
    getEntity: (type, id) => handle.getEntity(type, id),
    queryEntities: (q) => handle.queryEntities(q),
    queryMetrics: (q) => handle.queryMetrics(q),
    traverse: (q) => handle.traverse(q),
    queryDistributions: (q) => handle.queryDistributions(q),
    ...(handle.writeRollups
      ? {
          writeRollups: async (buckets) => {
            if (signal.aborted) {
              warnOnce('writeRollups');
              return;
            }
            await handle.writeRollups!(buckets);
          },
        }
      : {}),
    ...(handle.queryRollups
      ? { queryRollups: (q) => handle.queryRollups!(q) }
      : {}),
    ...(handle.getRollupWatermark
      ? {
          getRollupWatermark: (resource) =>
            handle.getRollupWatermark!(resource),
        }
      : {}),
    ...(handle.setRollupWatermark
      ? {
          setRollupWatermark: async (resource, tsUnixMs) => {
            if (signal.aborted) {
              warnOnce('setRollupWatermark');
              return;
            }
            await handle.setRollupWatermark!(resource, tsUnixMs);
          },
        }
      : {}),
    ...(handle.getHealth ? { getHealth: handle.getHealth.bind(handle) } : {}),
  };
}
