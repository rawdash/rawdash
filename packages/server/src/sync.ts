import type { DashboardConfig, ServerStorage } from '@rawdash/core';

export const FULL_SYNC_TIMEOUT_MS = 300_000;

/**
 * Run a full sync across all connectors in the config, sequentially per
 * connector with `Promise.allSettled` so one failure doesn't abort the
 * others. Transitions `storage` through `running` → `succeeded`/`failed`.
 *
 * Returns silently if the storage already reports `running` (another sync
 * acquired the lock first).
 */
export async function runSync(
  config: DashboardConfig,
  storage: ServerStorage,
): Promise<void> {
  const acquired = await storage.markSyncRunning();
  if (!acquired) {
    return;
  }
  const errors: string[] = [];
  await Promise.allSettled(
    config.connectors.map(async ({ connector }) => {
      const handle = storage.getStorageHandle(connector.id);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FULL_SYNC_TIMEOUT_MS);
      try {
        const result = await connector.sync(
          { mode: 'full' },
          handle,
          controller.signal,
        );
        if (!result.done) {
          errors.push(
            `${connector.id} did not complete in one chunk (chunked syncs are only supported in cloud)`,
          );
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          errors.push(
            `${connector.id} timed out after ${FULL_SYNC_TIMEOUT_MS}ms`,
          );
        } else {
          errors.push(err instanceof Error ? err.message : String(err));
        }
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  if (errors.length > 0) {
    await storage.markSyncFailed(errors.join('; '));
  } else {
    await storage.markSyncSucceeded();
  }
}
