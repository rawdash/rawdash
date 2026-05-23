import type { Widget } from './config';

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) =>
      JSON.stringify(k) +
      ':' +
      stableStringify((value as Record<string, unknown>)[k]),
  );
  return '{' + parts.join(',') + '}';
}

/**
 * Stable 32-bit hex hash of a widget's declarative config. Used as the
 * config-dependent component of the widget ETag so that a config edit
 * invalidates the cached ETag even when `lastSyncAt` is unchanged.
 *
 * Not cryptographic — collision-resistant enough for cache busting.
 */
export function hashWidgetConfig(widget: Widget): string {
  const s = stableStringify(widget);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Build the per-widget ETag value (unquoted). Combines the widget's
 * `lastSyncAt` (the connector's last successful sync timestamp, which is
 * what `CachedWidget.cachedAt` reflects) and a hash of the widget config.
 */
export function computeWidgetEtag(
  lastSyncAt: string | null,
  widget: Widget,
): string {
  return `"${lastSyncAt ?? 'null'}-${hashWidgetConfig(widget)}"`;
}
