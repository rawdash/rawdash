import type { ConnectorRegistry, Rawdash } from '@rawdash/core';
import { revalidateTag } from 'next/cache';
import type { NextRequest, NextResponse } from 'next/server';

const RAWDASH_CACHE_TAG = 'rawdash';

type NextFetchInit = RequestInit & {
  next?: {
    revalidate?: number | false;
    tags?: string[];
  };
};

/**
 * Shape of a successful widget-data response.
 *
 * Route: `GET /api/rawdash/[connector]/[widget]`
 *
 * @typeParam TData - The widget's data payload type, inferred from the
 *   `TRegistry` on the `Rawdash` instance.
 */
export interface CachedWidgetResponse<TData = unknown> {
  /** Connector that owns this widget. */
  connectorId: string;
  /** Widget identifier within the connector. */
  widgetId: string;
  /** The cached data payload. */
  data: TData;
  /** ISO 8601 timestamp of when the data was last cached. */
  cachedAt: string;
}

/**
 * Shape of the health/sync-status response.
 *
 * Route: `GET /api/rawdash/health`
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
 * Route: `POST /api/rawdash/sync`
 */
export interface SyncTriggerResponse {
  /** `true` when a sync was enqueued; `false` if one was already in progress. */
  triggered: boolean;
}

/**
 * A Next.js App Router route handler function.
 *
 * Compatible with the catch-all route signature expected by Next.js ≥ 14:
 * `app/api/rawdash/[...path]/route.ts`
 *
 * `params` is a `Promise` in Next.js 15+ and a plain object in Next.js 14.
 * The union covers both shapes so `@rawdash/nextjs` works with either version.
 */
export type RouteHandler = (
  request: NextRequest,
  context: {
    params:
      | Promise<Record<string, string | string[]>>
      | Record<string, string | string[]>;
  },
) => Promise<NextResponse>;

/**
 * The object returned by `createNextHandler`.  Spread it directly into your
 * catch-all route file:
 *
 * ```ts
 * // app/api/rawdash/[...path]/route.ts
 * import { createNextHandler } from '@rawdash/nextjs';
 * import { rawdash } from '@/lib/rawdash';
 *
 * export const { GET, POST } = createNextHandler(rawdash);
 * ```
 *
 * The single catch-all route handles all three Rawdash endpoints:
 * - `GET  /api/rawdash/[connector]/[widget]` — return cached widget data
 * - `POST /api/rawdash/sync`                 — trigger an immediate sync
 * - `GET  /api/rawdash/health`               — return current sync status
 */
export interface NextHandlers {
  GET: RouteHandler;
  POST: RouteHandler;
}

/**
 * Options accepted by `createNextHandler`.
 */
export interface CreateNextHandlerOptions {
  /**
   * URL prefix under which Rawdash routes are mounted.
   *
   * @default '/api/rawdash'
   */
  basePath?: string;

  /**
   * When `true`, starts the background sync scheduler as a side effect of
   * creating the handlers.  Defaults to `false` — callers are responsible for
   * starting the scheduler explicitly (e.g. in `instrumentation.ts`).
   *
   * @default false
   */
  startScheduler?: boolean;
}

/**
 * Creates Next.js App Router route handlers that expose the Rawdash HTTP API.
 *
 * **This is a stub.**  The function signature and associated types
 * (`CreateNextHandlerOptions`, `NextHandlers`) are stable, but the runtime
 * implementation does not exist yet and will always throw.  Do not call this
 * in production.
 *
 * @param rawdash - A configured Rawdash instance carrying the connector
 *   registry.  The registry's type flows into widget-data responses so callers
 *   receive typed payloads.
 * @param options - Handler configuration.
 * @returns An object with `GET` and `POST` handlers (`NextHandlers`) for
 *   export from a Next.js catch-all route file.
 * @throws {Error} Always — runtime implementation is not yet available.
 *
 * @example
 * ```ts
 * // app/api/rawdash/[...path]/route.ts
 * import { createNextHandler } from '@rawdash/nextjs';
 * import { rawdash } from '@/lib/rawdash';
 *
 * export const { GET, POST } = createNextHandler(rawdash);
 * ```
 */
export function createNextHandler<TRegistry extends ConnectorRegistry>(
  _rawdash: Rawdash<TRegistry>,
  _options?: CreateNextHandlerOptions,
): NextHandlers {
  throw new Error('Not implemented');
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
   * Fetch all cached widgets from the Rawdash API.
   *
   * The response is tagged with `'rawdash'` so that `triggerSync` can
   * invalidate it via `revalidateTag`.
   */
  getWidgets(): Promise<CachedWidgetResponse[]>;

  /**
   * Fetch a single cached widget by its composite ID (`connectorId:widgetId`).
   *
   * The response is tagged with `'rawdash'` so that `triggerSync` can
   * invalidate it via `revalidateTag`.
   *
   * @param id - Composite widget identifier, e.g. `'github:pull_requests'`.
   */
  getWidget(id: string): Promise<CachedWidgetResponse>;

  /**
   * Fetch the current sync health status from the Rawdash API.
   */
  getHealth(): Promise<HealthResponse>;

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
 * Creates a Rawdash client configured to talk to a specific Rawdash API
 * server or cloud endpoint.
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
    getWidgets() {
      return get<CachedWidgetResponse[]>('/widgets', {
        next: { tags: [RAWDASH_CACHE_TAG] },
      });
    },

    getWidget(id) {
      return get<CachedWidgetResponse>(`/widgets/${encodeURIComponent(id)}`, {
        next: { tags: [RAWDASH_CACHE_TAG] },
      });
    },

    getHealth() {
      return get<HealthResponse>('/health');
    },

    async triggerSync() {
      const res = await fetchWithTimeout(`${url}/sync`, { method: 'POST' });
      if (!res.ok) {
        throw new Error(`Rawdash sync error ${res.status}: ${res.statusText}`);
      }
      const result = (await res.json()) as SyncTriggerResponse;

      let health = await get<HealthResponse>('/health');
      while (health.status === 'syncing') {
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        health = await get<HealthResponse>('/health');
      }
      revalidateTag(RAWDASH_CACHE_TAG);
      return result;
    },
  };
}
