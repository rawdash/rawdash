import type { CachedWidget, Widget } from '@rawdash/core';

export interface WidgetCacheKey {
  dashboardId: string;
  widgetId: string;
  widget: Widget;
}

export interface WidgetCache {
  get(key: WidgetCacheKey): Promise<CachedWidget | undefined>;
  set(key: WidgetCacheKey, value: CachedWidget): Promise<void>;
}
