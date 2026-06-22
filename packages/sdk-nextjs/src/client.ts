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
  loading: boolean;
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
  const [loading, setLoading] = useState(
    () => (initialWidgets?.length ?? 0) === 0,
  );
  const optsRef = useRef(subscribeOptions);
  optsRef.current = subscribeOptions;

  const initialWidgetsRef = useRef(initialWidgets);
  initialWidgetsRef.current = initialWidgets;

  useEffect(() => {
    setWidgets(indexWidgets(initialWidgetsRef.current ?? []));
    setError(null);
    setLoading((initialWidgetsRef.current?.length ?? 0) === 0);
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
          setError(null);
        },
        onWidgetFailing: (w) => {
          setWidgets((prev) => ({ ...prev, [w.widgetId]: w }));
          setError(null);
        },
        onError: (e) => setError(e),
        onBootstrapped: () => setLoading(false),
      },
      optsRef.current,
    );
    return unsub;
  }, [source, dashboardId]);

  const syncState: Record<string, WidgetSyncState | undefined> = {};
  for (const id of Object.keys(widgets)) {
    syncState[id] = widgets[id]?.syncState;
  }

  return { widgets, syncState, error, loading };
}

export interface UseWidgetResult<TData = unknown> {
  widget: CachedWidget<TData> | null;
  syncState: WidgetSyncState | undefined;
  error: unknown;
  loading: boolean;
}

export function useWidget<TData = unknown>(
  source: DataSource,
  dashboardId: string,
  widgetId: string,
  options: UseDashboardOptions = {},
): UseWidgetResult<TData> {
  const { widgets, error, loading } = useDashboard(
    source,
    dashboardId,
    options,
  );
  const widget = (widgets[widgetId] ?? null) as CachedWidget<TData> | null;
  return { widget, syncState: widget?.syncState, error, loading };
}

function indexWidgets(list: CachedWidget[]): Record<string, CachedWidget> {
  const out: Record<string, CachedWidget> = {};
  for (const w of list) {
    out[w.widgetId] = w;
  }
  return out;
}
