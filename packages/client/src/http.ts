import type {
  CachedWidgetData,
  DataSource,
  HealthStatus,
  SyncResult,
} from './types';

export interface HttpOptions {
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export function http(opts: HttpOptions): DataSource {
  const {
    baseUrl,
    apiKey,
    fetch: fetchFn = globalThis.fetch,
    timeoutMs = 5000,
  } = opts;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `http: timeoutMs must be a finite positive number (received ${timeoutMs})`,
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

  return {
    async getWidgets(dashboardId) {
      const { widgets } = await get<{ widgets: CachedWidgetData[] }>(
        `/dashboards/${encodeURIComponent(dashboardId)}/widgets`,
      );
      return widgets;
    },

    getWidget(dashboardId, widgetId) {
      return get<CachedWidgetData>(
        `/dashboards/${encodeURIComponent(dashboardId)}/widgets/${encodeURIComponent(widgetId)}`,
      );
    },

    getHealth() {
      return get<HealthStatus>('/health', { cache: 'no-store' });
    },

    async triggerSync() {
      const res = await fetchWithTimeout(`${baseUrl}/sync`, { method: 'POST' });
      if (!res.ok) {
        throw new Error(`Rawdash sync error ${res.status}: ${res.statusText}`);
      }
      return res.json() as Promise<SyncResult>;
    },

    async ensureFresh(maxAgeMs = 5 * 60 * 1000) {
      const health = await get<HealthStatus>('/health', {
        cache: 'no-store',
      });

      if (health.status === 'syncing') {
        return false;
      }

      const lastSyncMs = health.lastSyncAt
        ? new Date(health.lastSyncAt).getTime()
        : null;
      const isFresh = lastSyncMs !== null && Date.now() - lastSyncMs < maxAgeMs;

      if (isFresh) {
        return false;
      }

      const res = await fetchWithTimeout(`${baseUrl}/sync`, { method: 'POST' });
      if (!res.ok) {
        throw new Error(`Rawdash sync error ${res.status}: ${res.statusText}`);
      }

      const maxAttempts = 60;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const h = await get<HealthStatus>('/health', { cache: 'no-store' });
        if (h.status === 'error') {
          throw new Error(
            `Rawdash sync failed: ${h.lastError ?? 'unknown error'}`,
          );
        }
        if (h.status === 'idle') {
          return true;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
      }
      throw new Error(
        `Rawdash sync did not complete within ${maxAttempts * 500}ms`,
      );
    },
  };
}
