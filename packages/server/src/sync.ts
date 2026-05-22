import type { DashboardConfig, ServerStorage } from '@rawdash/core';

export const FULL_SYNC_TIMEOUT_MS = 300_000;

/**
 * Run a full sync across all connectors in the config in parallel via
 * `Promise.allSettled`, so one failure doesn't abort the others. Each
 * connector run is wrapped in a hard timeout (`FULL_SYNC_TIMEOUT_MS`)
 * raced against the connector's own `Promise`, so a connector that
 * ignores `AbortSignal` (or a storage call that hangs) can still not
 * pin sync state in `running` indefinitely.
 *
 * Transitions storage through `queued` → `running` → `succeeded`/`failed`.
 * The `queued` step is a no-op if the caller (typically `triggerSync`)
 * already marked the run as queued.
 *
 * Returns silently if another sync acquired the `running` lock first.
 */
export async function runSync(
  config: DashboardConfig,
  storage: ServerStorage,
): Promise<void> {
  // Idempotent: if the caller already queued, this returns false and we
  // proceed to markSyncRunning anyway. If nothing queued us, we queue
  // ourselves now so the state machine still goes through `queued`.
  await storage.markSyncQueued();
  const acquired = await storage.markSyncRunning();
  if (!acquired) {
    return;
  }
  const errors: string[] = [];
  await Promise.allSettled(
    config.connectors.map(async ({ connector }) => {
      const handle = storage.getStorageHandle(connector.id);
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeoutPromise = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            const err = new Error(
              `${connector.id} timed out after ${FULL_SYNC_TIMEOUT_MS}ms`,
            );
            err.name = 'AbortError';
            reject(err);
          }, FULL_SYNC_TIMEOUT_MS);
        });
        const result = await Promise.race([
          connector.sync({ mode: 'full' }, handle, controller.signal),
          timeoutPromise,
        ]);
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
        if (timer !== undefined) {
          clearTimeout(timer);
        }
      }
    }),
  );
  if (errors.length > 0) {
    await storage.markSyncFailed(errors.join('; '));
  } else {
    await storage.markSyncSucceeded();
  }
}
