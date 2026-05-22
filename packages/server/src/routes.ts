/**
 * Canonical URL path conventions for the rawdash HTTP wire contract.
 *
 * Framework adapters (`@rawdash/hono`, etc.) and clients
 * (`@rawdash/client`) should use these constants instead of hard-coding
 * paths, so the contract stays in one place.
 */
export const ROUTES = {
  health: '/health',
  syncState: '/sync/state',
  sync: '/sync',
  retention: '/retention/retain',
  widgets: {
    list: (dashboardId: string): string =>
      `/dashboards/${encodeURIComponent(dashboardId)}/widgets`,
    single: (dashboardId: string, widgetId: string): string =>
      `/dashboards/${encodeURIComponent(dashboardId)}/widgets/${encodeURIComponent(widgetId)}`,
  },
} as const;
