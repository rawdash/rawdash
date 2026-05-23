import type {
  ConnectorRegistry,
  DashboardConfig,
  SecretsResolver,
  ServerStorage,
} from '@rawdash/core';
import { computeConnectorBackfill, instantiateConnector } from '@rawdash/core';

export const FULL_SYNC_TIMEOUT_MS = 300_000;
export const FULL_SYNC_MAX_CHUNKS = 1_000;
export const BACKFILL_BUFFER_MS = 86_400_000;

export interface RunSyncOptions {
  connectorRegistry: ConnectorRegistry;
  secretsResolver?: SecretsResolver;
}

/**
 * Run a full sync across all connectors in the config in parallel via
 * `Promise.allSettled`, so one failure doesn't abort the others. Each
 * connector run is wrapped in a hard timeout (`FULL_SYNC_TIMEOUT_MS`)
 * raced against the connector's own `Promise`, so a connector that
 * ignores `AbortSignal` (or a storage call that hangs) can still not
 * pin sync state in `running` indefinitely.
 *
 * Connectors that return `{ done: false, cursor }` are looped in-process,
 * threading the cursor back into the next `sync` call until `done: true`
 * or the shared timeout / `FULL_SYNC_MAX_CHUNKS` cap fires. Cloud
 * deployments layer cross-restart cursor persistence on top of the same
 * contract; the OSS runner is the trivial in-process case.
 *
 * The per-run storage handle is bound to the same `AbortController`, so
 * once the timeout fires every subsequent write call on that handle
 * becomes a no-op. That makes tail writes from a timed-out connector
 * invisible to the next sync even if the connector itself keeps running
 * — see `withAbortSignal` in `@rawdash/core` and the safety-net note in
 * `docs/authoring-a-connector.md`.
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
  options: RunSyncOptions,
): Promise<void> {
  await storage.markSyncQueued();
  if (typeof storage.markSyncRunning === 'function') {
    const acquired = await storage.markSyncRunning();
    if (!acquired) {
      return;
    }
  }
  const errors: string[] = [];
  const backfill = computeConnectorBackfill(config);
  const now = Date.now();
  await Promise.allSettled(
    config.connectors.map(async (entry) => {
      if (entry.enabled === false) {
        return;
      }
      const scope = backfill.get(entry.name);
      if (!scope) {
        return;
      }
      const since =
        scope.requiredWindowMs !== undefined
          ? new Date(
              now - scope.requiredWindowMs - BACKFILL_BUFFER_MS,
            ).toISOString()
          : undefined;
      const controller = new AbortController();
      const handle = storage.getStorageHandle(entry.name, {
        signal: controller.signal,
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const connector = instantiateConnector(
          entry,
          options.connectorRegistry,
          options.secretsResolver,
        );
        const timeoutPromise = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            const err = new Error(
              `${entry.name} timed out after ${FULL_SYNC_TIMEOUT_MS}ms`,
            );
            err.name = 'AbortError';
            reject(err);
          }, FULL_SYNC_TIMEOUT_MS);
        });
        let cursor: unknown = undefined;
        let chunks = 0;
        while (true) {
          chunks += 1;
          if (chunks > FULL_SYNC_MAX_CHUNKS) {
            controller.abort();
            throw new Error(
              `${entry.name} exceeded ${FULL_SYNC_MAX_CHUNKS} sync chunks without completing`,
            );
          }
          const syncPromise = connector.sync(
            { mode: 'full', since, cursor },
            handle,
            controller.signal,
          );
          const result = await Promise.race([syncPromise, timeoutPromise]);
          if (result.done) {
            break;
          }
          cursor = result.cursor;
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          errors.push(
            `${entry.name} timed out after ${FULL_SYNC_TIMEOUT_MS}ms`,
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
