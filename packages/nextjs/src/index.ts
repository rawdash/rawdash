import { revalidateTag } from 'next/cache';

const RAWDASH_CACHE_TAG = 'rawdash';

type NextFetchInit = RequestInit & {
  cache?:
    | 'default'
    | 'force-cache'
    | 'no-cache'
    | 'no-store'
    | 'only-if-cached'
    | 'reload';
  next?: {
    revalidate?: number | false;
    tags?: string[];
  };
};

/**
 * Shape of a successful widget-data response.
 *
 * Route: `GET /widgets/:id`
 *
 * @typeParam TData - The widget's data payload type.
 */
export interface CachedWidgetResponse<TData = unknown> {
  /** Connector that owns this widget. */
  connectorId: string;
  /** Widget identifier within the connector. */
  widgetId: string;
  /** The cached data payload. */
  data: TData;
  /** ISO 8601 timestamp of when the data was last cached, or `null` if never synced. */
  cachedAt: string | null;
}

/**
 * Shape of the health/sync-status response.
 *
 * Route: `GET /health`
 */
export interface HealthResponse {
  /** Current sync state of the background scheduler. */
  status: 'idle' | 'syncing' | 'error';
  /** ISO 8601 timestamp of the last completed sync, or `null` if never synced. */
  lastSyncAt: string | null;
  /** Human-readable error message from the last failed sync, or `null`. */
  lastError: string | null;
}

/**
 * Shape of the sync-trigger response.
 *
 * Route: `POST /sync`
 */
export interface SyncTriggerResponse {
  /** `true` when a sync was enqueued; `false` if one was already in progress. */
  triggered: boolean;
}

/**
 * Configuration for `createRawdashClient`.
 */
export interface RawdashClientOptions {
  /** Base URL of the Rawdash API server (e.g. `https://api.example.com`). */
  url: string;
  /** Optional API key sent as a `Bearer` token in the `Authorization` header. */
  apiKey?: string;
  /**
   * Timeout in milliseconds for each individual HTTP request.
   *
   * @default 5000
   */
  timeoutMs?: number;
}

/**
 * A configured Rawdash client for use in Next.js Server Components and Server
 * Actions.
 *
 * Create one instance (e.g. in `lib/rawdash.ts`) and import it wherever
 * widget data is needed:
 *
 * ```ts
 * // lib/rawdash.ts
 * import { createRawdashClient } from '@rawdash/nextjs';
 *
 * export const rawdash = createRawdashClient({
 *   url: process.env.RAWDASH_URL!,
 *   apiKey: process.env.RAWDASH_API_KEY,
 * });
 * ```
 */
export interface RawdashClient {
  /**
   * Fetch all cached widgets for a dashboard from the Rawdash API.
   *
   * The response is tagged with `'rawdash'` so that `triggerSync` can
   * invalidate it via `revalidateTag`.
   *
   * @param dashboardId - The dashboard key to fetch widgets for.
   */
  getWidgets(dashboardId: string): Promise<CachedWidgetResponse[]>;

  /**
   * Fetch a single cached widget by its ID within a dashboard.
   *
   * The response is tagged with `'rawdash'` so that `triggerSync` can
   * invalidate it via `revalidateTag`.
   *
   * @param dashboardId - The dashboard key the widget belongs to.
   * @param widgetId - The widget identifier within the dashboard.
   */
  getWidget(
    dashboardId: string,
    widgetId: string,
  ): Promise<CachedWidgetResponse>;

  /**
   * Fetch the current sync health status from the Rawdash API.
   */
  getHealth(): Promise<HealthResponse>;

  /**
   * Ensure the Rawdash API has fresh data.  Checks health and, if the last
   * sync is older than `maxAgeMs` (or has never run), triggers a sync and
   * waits for it to complete.  Does NOT call `revalidateTag`, so it is safe
   * to call from Server Components during render.
   *
   * @param maxAgeMs - Maximum age of the last sync in milliseconds before
   *   a new sync is triggered.  Defaults to 5 minutes.
   * @returns `true` if a sync was triggered, `false` if data was already fresh.
   */
  ensureFresh(maxAgeMs?: number): Promise<boolean>;

  /**
   * Trigger an immediate sync on the Rawdash API and invalidate the
   * `'rawdash'` Next.js cache tag so Server Components re-fetch widget data.
   *
   * This must be called from a Server Action or Route Handler — contexts where
   * `revalidateTag` is allowed by Next.js.
   */
  triggerSync(): Promise<SyncTriggerResponse>;
}

/**
 * Creates a Rawdash client configured to talk to a Rawdash API server
 * (self-hosted `@rawdash/server` or Rawdash Cloud).
 *
 * `@rawdash/nextjs` is a client-only package: it does not embed the Rawdash
 * engine inside the Next.js app.  Run `@rawdash/server` as a separate process
 * (or point `url` at Rawdash Cloud) and use this client to read widgets and
 * trigger syncs from Server Components and Server Actions.
 *
 * The client is intentionally server-only: it uses `next/cache` for tag-based
 * revalidation and relies on Next.js's extended `fetch` for cache tagging.
 *
 * @param options - Connection options (URL and optional API key).
 * @returns A `RawdashClient` instance with server component helpers and a
 *   sync trigger.
 *
 * @example
 * ```ts
 * import { createRawdashClient } from '@rawdash/nextjs';
 *
 * const client = createRawdashClient({
 *   url: process.env.RAWDASH_URL!,
 *   apiKey: process.env.RAWDASH_API_KEY,
 * });
 *
 * // In a Server Component:
 * const widgets = await client.getWidgets();
 *
 * // In a Server Action:
 * 'use server';
 * await client.triggerSync();
 * ```
 */
export function createRawdashClient(
  options: RawdashClientOptions,
): RawdashClient {
  const { url, apiKey, timeoutMs = 5000 } = options;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `createRawdashClient: timeoutMs must be a finite positive number (received ${timeoutMs})`,
    );
  }

  const baseHeaders: Record<string, string> = apiKey
    ? { Authorization: `Bearer ${apiKey}` }
    : {};

  async function fetchWithTimeout(
    input: string,
    init: NextFetchInit = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, {
        ...init,
        headers: { ...baseHeaders, ...(init.headers ?? {}) },
        signal: controller.signal,
      } as RequestInit);
    } finally {
      clearTimeout(timer);
    }
  }

  async function get<T>(path: string, init: NextFetchInit = {}): Promise<T> {
    const res = await fetchWithTimeout(`${url}${path}`, init);
    if (!res.ok) {
      throw new Error(`Rawdash API error ${res.status}: ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  return {
    getWidgets(dashboardId) {
      return get<CachedWidgetResponse[]>(
        `/dashboards/${encodeURIComponent(dashboardId)}/widgets`,
        { next: { tags: [RAWDASH_CACHE_TAG] } },
      );
    },

    getWidget(dashboardId, widgetId) {
      return get<CachedWidgetResponse>(
        `/dashboards/${encodeURIComponent(dashboardId)}/widgets/${encodeURIComponent(widgetId)}`,
        { next: { tags: [RAWDASH_CACHE_TAG] } },
      );
    },

    getHealth() {
      return get<HealthResponse>('/health', { cache: 'no-store' });
    },

    async ensureFresh(maxAgeMs = 5 * 60 * 1000) {
      const health = await get<HealthResponse>('/health', {
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

      const res = await fetchWithTimeout(`${url}/sync`, { method: 'POST' });
      if (!res.ok) {
        throw new Error(`Rawdash sync error ${res.status}: ${res.statusText}`);
      }

      const maxAttempts = 60;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const h = await get<HealthResponse>('/health', {
          cache: 'no-store',
        });
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

    async triggerSync() {
      const res = await fetchWithTimeout(`${url}/sync`, { method: 'POST' });
      if (!res.ok) {
        throw new Error(`Rawdash sync error ${res.status}: ${res.statusText}`);
      }
      const result = (await res.json()) as SyncTriggerResponse;

      const maxAttempts = 60;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const health = await get<HealthResponse>('/health', {
          cache: 'no-store',
        });
        if (health.status === 'error') {
          throw new Error(
            `Rawdash sync failed: ${health.lastError ?? 'unknown error'}`,
          );
        }
        if (health.status === 'idle') {
          revalidateTag(RAWDASH_CACHE_TAG);
          return result;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
      }
      throw new Error(
        `Rawdash sync did not complete within ${maxAttempts * 500}ms`,
      );
    },
  };
}
