'use client';

import type { CachedWidget, DataSource, WidgetSyncState } from '@rawdash/core';
import { subscribe } from '@rawdash/sdk-runtime';
import type { SubscribeOptions } from '@rawdash/sdk-runtime';
import { useEffect, useRef, useState } from 'react';

export type {
  SubscribeCallbacks,
  SubscribeOptions,
  Unsubscribe,
  VisibilitySource,
} from '@rawdash/sdk-runtime';

export type { CachedWidget, DataSource, WidgetSyncState } from '@rawdash/core';

export interface UseDashboardResult {
  widgets: Record<string, CachedWidget>;
  syncState: Record<string, WidgetSyncState | undefined>;
  error: unknown;
}

export interface UseDashboardOptions extends SubscribeOptions {
  initialWidgets?: CachedWidget[];
}

export function useDashboard(
  source: DataSource,
  dashboardId: string,
  options: UseDashboardOptions = {},
): UseDashboardResult {
  const { initialWidgets, ...subscribeOptions } = options;
  const [widgets, setWidgets] = useState<Record<string, CachedWidget>>(() =>
    indexWidgets(initialWidgets ?? []),
  );
  const [error, setError] = useState<unknown>(null);
  const optsRef = useRef(subscribeOptions);
  optsRef.current = subscribeOptions;

  useEffect(() => {
    const unsub = subscribe(
      source,
      dashboardId,
      {
        onWidgetUpdated: (w) => {
          setWidgets((prev) => ({ ...prev, [w.widgetId]: w }));
          setError(null);
        },
        onWidgetUnchanged: (w) => {
          setWidgets((prev) =>
            prev[w.widgetId] === w ? prev : { ...prev, [w.widgetId]: w },
          );
        },
        onWidgetFailing: (w) => {
          setWidgets((prev) => ({ ...prev, [w.widgetId]: w }));
        },
        onError: (e) => setError(e),
      },
      optsRef.current,
    );
    return unsub;
  }, [source, dashboardId]);

  const syncState: Record<string, WidgetSyncState | undefined> = {};
  for (const id of Object.keys(widgets)) {
    syncState[id] = widgets[id]?.syncState;
  }

  return { widgets, syncState, error };
}

export interface UseWidgetResult<TData = unknown> {
  widget: CachedWidget<TData> | null;
  syncState: WidgetSyncState | undefined;
  error: unknown;
}

export function useWidget<TData = unknown>(
  source: DataSource,
  dashboardId: string,
  widgetId: string,
  options: UseDashboardOptions = {},
): UseWidgetResult<TData> {
  const { widgets, error } = useDashboard(source, dashboardId, options);
  const widget = (widgets[widgetId] ?? null) as CachedWidget<TData> | null;
  return { widget, syncState: widget?.syncState, error };
}

function indexWidgets(list: CachedWidget[]): Record<string, CachedWidget> {
  const out: Record<string, CachedWidget> = {};
  for (const w of list) {
    out[w.widgetId] = w;
  }
  return out;
}
