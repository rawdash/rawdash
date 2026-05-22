import type { DataSource, ServerDataSource, SyncState } from '@rawdash/core';
import { isSyncActive } from '@rawdash/core';

export interface InProcessOptions {
  /** Total time to wait for an in-flight sync to finish. Defaults to 30s. */
  syncTimeoutMs?: number;
  /** Delay between sync-state polls. Defaults to 500ms. */
  syncPollIntervalMs?: number;
}

const KNOWN_SYNC_STATUSES = new Set([
  'idle',
  'queued',
  'running',
  'succeeded',
  'failed',
]);

export function inProcess(
  engine: ServerDataSource,
  options: InProcessOptions = {},
): DataSource {
  const syncTimeoutMs = options.syncTimeoutMs ?? 30_000;
  const syncPollIntervalMs = options.syncPollIntervalMs ?? 500;

  async function getSyncStateGuarded(): Promise<SyncState> {
    const state = await engine.getSyncState();
    if (!KNOWN_SYNC_STATUSES.has(state.status)) {
      throw new Error(
        `Rawdash engine returned unrecognized sync status "${String(state.status)}"`,
      );
    }
    return state;
  }

  async function waitForSyncToSettle(): Promise<SyncState> {
    const deadline = Date.now() + syncTimeoutMs;
    for (;;) {
      const state = await getSyncStateGuarded();
      if (!isSyncActive(state.status)) {
        return state;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Rawdash sync did not settle within ${syncTimeoutMs}ms (last status: ${state.status})`,
        );
      }
      await new Promise<void>((resolve) =>
        setTimeout(resolve, syncPollIntervalMs),
      );
    }
  }

  return {
    getWidget: (dashboardId, widgetId) =>
      engine.getWidget(dashboardId, widgetId),

    getWidgets: (dashboardId) => engine.getWidgets(dashboardId),

    getHealth: () => engine.getHealth(),

    getSyncState: () => engine.getSyncState(),

    triggerSync: () => engine.triggerSync(),

    async ensureFresh(maxAgeMs = 5 * 60 * 1000) {
      const state = await getSyncStateGuarded();

      if (isSyncActive(state.status)) {
        const settled = await waitForSyncToSettle();
        if (settled.status === 'failed') {
          throw new Error(
            `Rawdash sync failed: ${settled.lastError ?? 'unknown error'}`,
          );
        }
        return true;
      }

      const lastSyncMs = state.lastSyncAt
        ? new Date(state.lastSyncAt).getTime()
        : null;
      const isFresh = lastSyncMs !== null && Date.now() - lastSyncMs < maxAgeMs;
      if (isFresh) {
        return false;
      }

      const trigger = await engine.triggerSync();
      if (!trigger.queued) {
        const settled = await waitForSyncToSettle();
        if (settled.status === 'failed') {
          throw new Error(
            `Rawdash sync failed: ${settled.lastError ?? 'unknown error'}`,
          );
        }
        return true;
      }

      const settled = await waitForSyncToSettle();
      if (settled.status === 'failed') {
        throw new Error(
          `Rawdash sync failed: ${settled.lastError ?? 'unknown error'}`,
        );
      }
      return true;
    },
  };
}
