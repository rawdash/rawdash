import type { DataSource, ServerDataSource } from '@rawdash/core';

export function inProcess(engine: ServerDataSource): DataSource {
  return {
    getWidget: (dashboardId, widgetId) =>
      engine.getWidget(dashboardId, widgetId),

    getWidgets: (dashboardId) => engine.getWidgets(dashboardId),

    getHealth: () => engine.getHealth(),

    triggerSync: () => engine.triggerSync(),

    async ensureFresh(maxAgeMs = 5 * 60 * 1000) {
      const health = await engine.getHealth();

      if (health.status === 'syncing') {
        return false;
      }

      const lastSyncMs = health.lastSyncAt
        ? new Date(health.lastSyncAt).getTime()
        : null;
      const isFresh = lastSyncMs !== null && Date.now() - lastSyncMs < maxAgeMs;

      if (isFresh) {
        return false;
      }

      const { triggered } = await engine.triggerSync();
      if (!triggered) {
        return false;
      }

      const maxAttempts = 60;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const h = await engine.getHealth();
        if (h.status === 'error') {
          throw new Error(
            `Rawdash sync failed: ${h.lastError ?? 'unknown error'}`,
          );
        }
        if (h.status === 'idle') {
          return true;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
      }
      throw new Error(
        `Rawdash sync did not complete within ${maxAttempts * 500}ms`,
      );
    },
  };
}
