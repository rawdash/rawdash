import type { DashboardConfig } from '@rawdash/core';

import type { RouterMount } from './router';
import { HealthRouter } from './routers/health';
import { RetentionRouter } from './routers/retention';
import { SyncRouter } from './routers/sync';
import { WidgetsRouter } from './routers/widgets';
import { InMemoryStorage } from './storage';
import type { ServerStorage } from './types';

export function createEngineRouters(
  config: DashboardConfig,
  storage: ServerStorage = new InMemoryStorage(),
): RouterMount[] {
  const widgetRouters = Object.entries(config.dashboards).map(
    ([dashboardId, dashboard]) =>
      new WidgetsRouter(dashboardId, dashboard, config.connectors, storage),
  );

  return [
    ...widgetRouters,
    new SyncRouter(config, storage),
    new RetentionRouter(config, storage),
    new HealthRouter(storage),
  ];
}
