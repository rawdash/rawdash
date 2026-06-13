---
'@rawdash/core': minor
'@rawdash/server': patch
'@rawdash/connector-google-ads': patch
'@rawdash/connector-meta-ads': patch
---

Add widget `format` field for display formatting; currency format derives scale from field's declared unit

Widgets (stat, timeseries, distribution) now accept an optional `format` field:

```ts
format?: {
  kind: 'currency' | 'number' | 'percent' | 'duration' | 'bytes';
  currency?: string;  // e.g. 'USD'
  decimals?: number;
  compact?: boolean;  // render as 1.2M
}
```

For `kind: 'currency'`, the scale divisor is derived automatically from the metric field's declared `unit` — a field declared `unit: 'cents'` produces `scale: 100` in the API response, so the frontend divides raw cents by 100 to display dollars. No magic numbers needed in widget config.

The widgets API (`CachedWidget`) now carries a `format` field (type `ResolvedWidgetFormat`) alongside `data`, including the derived `scale` for currency widgets when connector resource definitions are available.

**Validation updates (RAW-522 follow-up):**

- The existing cents-without-conversion warning now points to `format: { kind: 'currency' }` as the fix.
- The warning is suppressed when the widget already sets `format: { kind: 'currency' }`.
- A new warning fires when `format: { kind: 'currency' }` is set on a field with no declared currency unit.

**Connector audit:**

- `@rawdash/connector-google-ads`: resource `unit` updated from `'cost'` to `'USD'` (values were already stored in full currency units after micros conversion).
- `@rawdash/connector-meta-ads`: resource `unit` updated from `'spend'` to `'USD'`.

**New exports from `@rawdash/core`:** `WidgetFormat`, `ResolvedWidgetFormat`, `widgetFormatSchema`, `currencyScaleFromUnit`.
