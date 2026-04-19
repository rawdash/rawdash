import type { DashboardConfig } from '@rawdash/core';

import type { RawdashRouter } from './router';
import { HealthRouter } from './routers/health';
import { SyncRouter } from './routers/sync';
import { WidgetsRouter } from './routers/widgets';
import { InMemoryStorage } from './storage';

export function createEngineRouters(config: DashboardConfig): RawdashRouter[] {
  const storage = new InMemoryStorage();
  return [
    new WidgetsRouter(config, storage),
    new SyncRouter(config, storage),
    new HealthRouter(storage),
  ];
}
