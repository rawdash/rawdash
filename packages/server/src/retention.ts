import type {
  DashboardConfig,
  RetentionConfig,
  RetentionDeletionPlan,
  ServerStorage,
} from '@rawdash/core';
import { selectForDeletion } from '@rawdash/core';

export const DEFAULT_RETENTION_INTERVAL_MS = 60 * 60 * 1000;

export function hasPruningPolicy(config: RetentionConfig): boolean {
  return config.maxAge !== undefined || config.maxSize !== undefined;
}

/**
 * Applies a `RetentionDeletionPlan` via targeted, identity-keyed deletes and
 * returns the number of rows actually deleted.
 *
 * Rows are matched by identity tuple, and `attributes` is compared by its exact
 * serialization (`JSON.stringify`) as written by the storage adapter — not by
 * deep equality. Pass the plan produced by `computeRetention` (whose rows are
 * read straight from storage) so the serialization byte-matches; a hand-built
 * plan whose `attributes` keys are in a different order will not match and those
 * rows will survive.
 */
export async function applyRetention(
  storage: ServerStorage,
  connectorId: string,
  plan: RetentionDeletionPlan,
): Promise<{ rowsDeleted: number }> {
  const total =
    plan.events.length +
    plan.metrics.length +
    plan.distributions.length +
    plan.entities.length;
  if (total === 0) {
    return { rowsDeleted: 0 };
  }

  const handle = storage.getStorageHandle(connectorId);
  if (!handle.deleteByIdentity) {
    throw new Error(
      'applyRetention requires a storage adapter that implements deleteByIdentity',
    );
  }

  return handle.deleteByIdentity(plan);
}

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
