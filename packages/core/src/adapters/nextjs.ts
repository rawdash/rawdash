import type { NextRequest, NextResponse } from 'next/server';

/**
 * A registry mapping connector IDs to their widget data shapes.
 *
 * Callers declare their registry when constructing a `Rawdash` instance so
 * that widget data is typed end-to-end:
 *
 * ```ts
 * type MyRegistry = {
 *   github: { pull_requests: PullRequestData; issues: IssueData };
 *   stripe: { mrr: MrrData };
 * };
 * const rawdash = createRawdash<MyRegistry>({ ... });
 * ```
 */
export type ConnectorRegistry = Record<string, Record<string, unknown>>;

/**
 * Phantom-typed Rawdash instance.  The generic `TRegistry` flows into handler
 * return types so callers get typed widget data without extra casts.
 *
 * Constructed via `createRawdash` (defined in a future ticket).
 */
export interface Rawdash<
  TRegistry extends ConnectorRegistry = ConnectorRegistry,
> {
  /** @internal — phantom field; never present at runtime */
  readonly _registry: TRegistry;
}

/**
 * Shape of a successful widget-data response.
 *
 * Route: `GET /api/rawdash/[connector]/[widget]`
 *
 * @typeParam TData - The widget's data payload type, inferred from `TRegistry`.
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
 */
export type RouteHandler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[]>> },
) => Promise<NextResponse>;

/**
 * The object returned by `createNextHandler`.  Spread it directly into your
 * catch-all route file:
 *
 * ```ts
 * // app/api/rawdash/[...path]/route.ts
 * import { createNextHandler } from '@rawdash/core/adapters/nextjs';
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
 * @param rawdash - A configured Rawdash instance carrying the connector
 *   registry.  The registry's type flows into widget-data responses so callers
 *   receive typed payloads.
 * @param options - Handler configuration.
 * @returns An object with `GET` and `POST` handlers ready for export from a
 *   Next.js catch-all route file.
 *
 * @example
 * ```ts
 * // app/api/rawdash/[...path]/route.ts
 * import { createNextHandler } from '@rawdash/core/adapters/nextjs';
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
