import type { DashboardConfig, ServerStorage } from '@rawdash/core';

export const FULL_SYNC_TIMEOUT_MS = 300_000;
/**
 * After a connector times out and the abort signal fires, how long to
 * wait for the connector's promise to actually settle before we move on
 * to mark sync state. Bounded so a connector that ignores `AbortSignal`
 * entirely can't hang the whole sync, but long enough that a cooperative
 * connector has time to release its in-flight storage writes before the
 * next sync starts. Connectors should honor `signal` to make this
 * effective — see `docs/authoring-a-connector.md`.
 */
export const ABORT_GRACE_MS = 10_000;

/**
 * Run a full sync across all connectors in the config in parallel via
 * `Promise.allSettled`, so one failure doesn't abort the others. Each
 * connector run is wrapped in a hard timeout (`FULL_SYNC_TIMEOUT_MS`)
 * raced against the connector's own `Promise`, so a connector that
 * ignores `AbortSignal` (or a storage call that hangs) can still not
 * pin sync state in `running` indefinitely.
 *
 * When a connector times out, we also wait up to `ABORT_GRACE_MS` for
 * the aborted promise to actually settle before proceeding to mark sync
 * state. This bounds the window in which a connector that ignores
 * `AbortSignal` could overlap its tail writes with the next sync.
 * Cooperative connectors that honor `signal.aborted` will settle well
 * within this window.
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
      let syncPromise: Promise<{ done: boolean }> | undefined;
      try {
        syncPromise = connector.sync(
          { mode: 'full' },
          handle,
          controller.signal,
        );
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
        const result = await Promise.race([syncPromise, timeoutPromise]);
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
          // Promise.race only stops waiting — it doesn't cancel the
          // losing promise. Wait up to ABORT_GRACE_MS for the aborted
          // connector to actually settle, so its tail writes don't
          // overlap with the next sync. If the connector ignores the
          // abort signal, we move on after the grace period rather than
          // hang forever.
          if (syncPromise !== undefined) {
            await Promise.race([
              syncPromise.catch(() => undefined),
              new Promise<void>((resolve) =>
                setTimeout(resolve, ABORT_GRACE_MS),
              ),
            ]);
          }
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
