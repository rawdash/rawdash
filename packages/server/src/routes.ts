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
