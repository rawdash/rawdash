import type {
  DashboardConfig,
  RetentionConfig,
  ServerStorage,
} from '@rawdash/core';
import { selectForDeletion } from '@rawdash/core';

export const DEFAULT_RETENTION_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function hasPruningPolicy(config: RetentionConfig): boolean {
  return config.maxAge !== undefined || config.maxSize !== undefined;
}

/**
 * Apply the retention policy in `config` to every connector's stored data.
 * No-op if the config has no pruning policy. Throws an aggregated error if
 * any connector fails.
 */
export async function runRetention(
  config: DashboardConfig,
  storage: ServerStorage,
): Promise<void> {
  const retentionConfig = config.retention;
  if (!retentionConfig || !hasPruningPolicy(retentionConfig)) {
    return;
  }

  const nowMs = Date.now();

  const results = await Promise.allSettled(
    config.connectors.map(async (entry) => {
      const handle = storage.getStorageHandle(entry.name);

      const [events, metrics, distributions] = await Promise.all([
        handle.queryEvents({}),
        handle.queryMetrics({}),
        handle.queryDistributions({}),
      ]);

      await applyRetentionToShape(
        events,
        (e) => e.start_ts,
        retentionConfig,
        nowMs,
        (survivors, names) => handle.events(survivors, { names }),
      );

      await applyRetentionToShape(
        metrics,
        (m) => m.ts,
        retentionConfig,
        nowMs,
        (survivors, names) => handle.metrics(survivors, { names }),
      );

      await applyRetentionToShape(
        distributions,
        (d) => d.ts,
        retentionConfig,
        nowMs,
        (survivors, names) => handle.distributions(survivors, { names }),
      );
    }),
  );

  const failures = results.filter(
    (r): r is PromiseRejectedResult => r.status === 'rejected',
  );
  if (failures.length > 0) {
    throw new Error(
      `Retention failed for ${failures.length} connector(s): ${failures.map((f) => String(f.reason)).join('; ')}`,
    );
  }
}

async function applyRetentionToShape<T extends { name: string }>(
  rows: T[],
  getTs: (row: T) => number,
  config: RetentionConfig,
  nowMs: number,
  writeSurvivors: (survivors: T[], names: string[]) => Promise<void>,
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const sorted = [...rows].sort((a, b) => getTs(b) - getTs(a));
  const toDeleteSet = new Set(selectForDeletion(sorted, getTs, config, nowMs));

  if (toDeleteSet.size === 0) {
    return;
  }

  const survivors = sorted.filter((r) => !toDeleteSet.has(r));
  const allNames = [...new Set(rows.map((r) => r.name))];

  await writeSurvivors(survivors, allNames);
}
