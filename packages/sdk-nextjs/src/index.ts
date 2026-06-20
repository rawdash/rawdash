import type { DataSource } from '@rawdash/core';
import { isSyncActive } from '@rawdash/core';
import { http as clientHttp } from '@rawdash/sdk-client';
import type { HttpOptions } from '@rawdash/sdk-client';
import { revalidateTag } from 'next/cache';

export type { HttpOptions } from '@rawdash/sdk-client';

export type {
  CachedWidget,
  DataSource,
  HealthResponse,
  MergedPoint,
  MergeSeriesOptions,
  SyncState,
  SyncStatus,
  TriggerSyncResponse,
  WidgetSeries,
  WidgetSyncState,
  WidgetsListResponse,
} from '@rawdash/core';

export {
  ACTIVE_SYNC_STATUSES,
  isSyncActive,
  mergeSeries,
  mergeSeriesScalar,
} from '@rawdash/core';

const RAWDASH_CACHE_TAG = 'rawdash';

type NextFetchInit = RequestInit & {
  next?: {
    revalidate?: number | false;
    tags?: string[];
  };
};

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

const DEFAULT_SYNC_TIMEOUT_MS = 30_000;
const DEFAULT_SYNC_POLL_INTERVAL_MS = 500;

export function createRawdashClient(dataSource: DataSource): DataSource {
  return {
    getWidget: (dashboardId, widgetId) =>
      dataSource.getWidget(dashboardId, widgetId),

    getWidgets: (dashboardId) => dataSource.getWidgets(dashboardId),

    getHealth: () => dataSource.getHealth(),

    getSyncState: () => dataSource.getSyncState(),

    async ensureFresh(maxAgeMs) {
      const synced = await dataSource.ensureFresh(maxAgeMs);
      if (synced) {
        revalidateTag(RAWDASH_CACHE_TAG);
      }
      return synced;
    },

    async triggerSync() {
      const result = await dataSource.triggerSync();

      const deadline = Date.now() + DEFAULT_SYNC_TIMEOUT_MS;
      for (;;) {
        const state = await dataSource.getSyncState();
        if (!isSyncActive(state.status)) {
          if (state.status === 'failed') {
            throw new Error(
              `Rawdash sync failed: ${state.lastError ?? 'unknown error'}`,
            );
          }
          revalidateTag(RAWDASH_CACHE_TAG);
          return result;
        }
        if (Date.now() >= deadline) {
          throw new Error(
            `Rawdash sync did not settle within ${DEFAULT_SYNC_TIMEOUT_MS}ms (last status: ${state.status})`,
          );
        }
        await new Promise<void>((resolve) =>
          setTimeout(resolve, DEFAULT_SYNC_POLL_INTERVAL_MS),
        );
      }
    },
  };
}
