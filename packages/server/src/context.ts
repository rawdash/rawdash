import type { DashboardConfig, ServerStorage } from '@rawdash/core';

/**
 * Per-request lookup functions an HTTP adapter passes to engine handlers.
 *
 * Adapters can close over per-request data (e.g. an id extracted from a
 * path parameter or auth header) when constructing `getConfig` /
 * `getStorage`. The handlers themselves only know how to operate on a
 * given `DashboardConfig` and `ServerStorage` — they don't know or care
 * how those are obtained.
 */
export interface EngineContext {
  getConfig: () => DashboardConfig | Promise<DashboardConfig>;
  getStorage: () => ServerStorage | Promise<ServerStorage>;
}
