import { http as clientHttp } from '@rawdash/client';
import type { DataSource, HttpOptions } from '@rawdash/client';
import { revalidateTag } from 'next/cache';

export type {
  CachedWidgetData,
  DataSource,
  HealthStatus,
  HttpOptions,
  ServerDataSource,
  SyncResult,
  WidgetSyncState,
} from '@rawdash/client';

const RAWDASH_CACHE_TAG = 'rawdash';

type NextFetchInit = RequestInit & {
  next?: {
    revalidate?: number | false;
    tags?: string[];
  };
};

/**
 * Next.js-aware variant of `http` from `@rawdash/client`.
 *
 * Identical to `http` but wraps the underlying fetch so that widget requests
 * are tagged with the `'rawdash'` cache tag, enabling `revalidateTag`-based
 * invalidation from Server Actions.
 */
export function http(opts: HttpOptions): DataSource {
  const taggedFetch: typeof globalThis.fetch = (input, init) => {
    return globalThis.fetch(
      input as RequestInfo,
      {
        ...(init as NextFetchInit),
        next: {
          ...(init as NextFetchInit | undefined)?.next,
          tags: [
            ...((init as NextFetchInit | undefined)?.next?.tags ?? []),
            RAWDASH_CACHE_TAG,
          ],
        },
      } as RequestInit,
    );
  };
  return clientHttp({ ...opts, fetch: taggedFetch });
}

/**
 * A configured Rawdash client for use in Next.js Server Components and Server
 * Actions.
 *
 * Wrap a `DataSource` (from `@rawdash/client`) with Next.js-specific
 * behaviour: `triggerSync` waits for the sync to complete, then calls
 * `revalidateTag` so Server Components re-fetch widget data.
 *
 * ```ts
 * // lib/rawdash.ts
 * import { createRawdashClient, http } from '@rawdash/nextjs';
 *
 * export const rawdash = createRawdashClient(
 *   http({ baseUrl: process.env.RAWDASH_URL! }),
 * );
 * ```
 */
export function createRawdashClient(dataSource: DataSource): DataSource {
  return {
    getWidget: (dashboardId, widgetId) =>
      dataSource.getWidget(dashboardId, widgetId),

    getWidgets: (dashboardId) => dataSource.getWidgets(dashboardId),

    getHealth: () => dataSource.getHealth(),

    async ensureFresh(maxAgeMs) {
      const synced = await dataSource.ensureFresh(maxAgeMs);
      if (synced) {
        revalidateTag(RAWDASH_CACHE_TAG);
      }
      return synced;
    },

    async triggerSync() {
      const result = await dataSource.triggerSync();

      const maxAttempts = 60;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const health = await dataSource.getHealth();
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
