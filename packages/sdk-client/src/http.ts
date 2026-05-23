import type {
  CachedWidget,
  DataSource,
  HealthResponse,
  SyncState,
  TriggerSyncResponse,
  WidgetsListResponse,
} from '@rawdash/core';
import { isSyncActive } from '@rawdash/core';

export interface HttpOptions {
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  /** Total time to wait for an in-flight sync to finish before throwing. Defaults to 30s. */
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

export function http(opts: HttpOptions): DataSource {
  const {
    baseUrl,
    apiKey,
    fetch: fetchFn = globalThis.fetch,
    timeoutMs = 5000,
    syncTimeoutMs = 30_000,
    syncPollIntervalMs = 500,
  } = opts;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `http: timeoutMs must be a finite positive number (received ${timeoutMs})`,
    );
  }
  if (!Number.isFinite(syncTimeoutMs) || syncTimeoutMs <= 0) {
    throw new Error(
      `http: syncTimeoutMs must be a finite positive number (received ${syncTimeoutMs})`,
    );
  }
  if (!Number.isFinite(syncPollIntervalMs) || syncPollIntervalMs <= 0) {
    throw new Error(
      `http: syncPollIntervalMs must be a finite positive number (received ${syncPollIntervalMs})`,
    );
  }

  const baseHeaders: Record<string, string> = apiKey
    ? { Authorization: `Bearer ${apiKey}` }
    : {};

  async function fetchWithTimeout(
    input: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchFn(input, {
        ...init,
        headers: { ...baseHeaders, ...(init.headers ?? {}) },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function get<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetchWithTimeout(`${baseUrl}${path}`, init);
    if (!res.ok) {
      throw new Error(`Rawdash API error ${res.status}: ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  async function getSyncState(): Promise<SyncState> {
    const state = await get<SyncState>('/sync/state', { cache: 'no-store' });
    if (!KNOWN_SYNC_STATUSES.has(state.status)) {
      throw new Error(
        `Rawdash returned unrecognized sync status "${String(state.status)}" — the server is likely speaking a different protocol version.`,
      );
    }
    return state;
  }

  async function waitForSyncToSettle(): Promise<SyncState> {
    const deadline = Date.now() + syncTimeoutMs;
    for (;;) {
      const state = await getSyncState();
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
    async getWidgets(dashboardId) {
      const { widgets } = await get<WidgetsListResponse>(
        `/dashboards/${encodeURIComponent(dashboardId)}/widgets`,
      );
      return widgets;
    },

    getWidget(dashboardId, widgetId) {
      return get<CachedWidget>(
        `/dashboards/${encodeURIComponent(dashboardId)}/widgets/${encodeURIComponent(widgetId)}`,
      );
    },

    getHealth() {
      return get<HealthResponse>('/health', { cache: 'no-store' });
    },

    getSyncState,

    async triggerSync() {
      const res = await fetchWithTimeout(`${baseUrl}/sync`, { method: 'POST' });
      if (!res.ok) {
        throw new Error(`Rawdash sync error ${res.status}: ${res.statusText}`);
      }
      return res.json() as Promise<TriggerSyncResponse>;
    },

    async ensureFresh(maxAgeMs = 5 * 60 * 1000) {
      const state = await getSyncState();

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

      const trigger = await this.triggerSync();
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
