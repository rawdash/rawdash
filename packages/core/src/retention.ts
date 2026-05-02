import type { Distribution, Event, Metric, StorageHandle } from './connector';

// ---------------------------------------------------------------------------
// RetentionConfig
// ---------------------------------------------------------------------------

export interface RetentionConfig {
  maxAge?: number;
  maxSize?: number;
  floor?: number;
  intervalMs?: number;
}

// ---------------------------------------------------------------------------
// RetentionCandidates — rows eligible for deletion across time-series shapes
// ---------------------------------------------------------------------------

export interface RetentionCandidates {
  events: Event[];
  metrics: Metric[];
  distributions: Distribution[];
}

// ---------------------------------------------------------------------------
// selectForDeletion — pure computation
//
// Receives rows pre-sorted newest-first (descending by timestamp).
// Returns the subset that should be deleted given the policy.
//
// Rules applied in order:
//   1. Rows beyond maxSize are candidates.
//   2. Rows older than maxAge milliseconds are candidates.
//   3. Rows within the newest `floor` positions are always kept (overrides 1 & 2).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// computeRetention — async, queries the handle and returns deletion candidates
//
// Only covers time-series shapes (events, metrics, distributions) since those
// grow unboundedly via append. Entities and edges are upsert-keyed and do not
// accumulate the same way.
// ---------------------------------------------------------------------------

export async function computeRetention(
  handle: StorageHandle,
  config: RetentionConfig,
  nowMs: number = Date.now(),
): Promise<RetentionCandidates> {
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
