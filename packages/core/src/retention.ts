import type {
  Distribution,
  Event,
  MetricSample,
  StorageHandle,
} from './connector';

export interface RetentionConfig {
  maxAge?: number;
  maxSize?: number;
  floor?: number;
  intervalMs?: number;
}

export interface RetentionDeletionPlan {
  events: Event[];
  metrics: MetricSample[];
  distributions: Distribution[];
}

export function selectForDeletion<T>(
  rows: T[],
  getTs: (row: T) => number,
  config: RetentionConfig,
  nowMs: number = Date.now(),
): T[] {
  const { maxAge, maxSize, floor = 0 } = config;

  if (maxAge === undefined && maxSize === undefined) {
    return [];
  }

  const toDelete: T[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (i < floor) {
      continue;
    }

    const overSize = maxSize !== undefined && i >= maxSize;
    const tooOld = maxAge !== undefined && getTs(row) < nowMs - maxAge;

    if (overSize || tooOld) {
      toDelete.push(row);
    }
  }

  return toDelete;
}

export async function computeRetention(
  handle: StorageHandle,
  config: RetentionConfig,
  nowMs: number = Date.now(),
): Promise<RetentionDeletionPlan> {
  const [events, metrics, distributions] = await Promise.all([
    handle.queryEvents({}),
    handle.queryMetrics({}),
    handle.queryDistributions({}),
  ]);

  const sortedEvents = [...events].sort((a, b) => b.start_ts - a.start_ts);
  const sortedMetrics = [...metrics].sort((a, b) => b.ts - a.ts);
  const sortedDistributions = [...distributions].sort((a, b) => b.ts - a.ts);

  return {
    events: selectForDeletion(sortedEvents, (e) => e.start_ts, config, nowMs),
    metrics: selectForDeletion(sortedMetrics, (m) => m.ts, config, nowMs),
    distributions: selectForDeletion(
      sortedDistributions,
      (d) => d.ts,
      config,
      nowMs,
    ),
  };
}
