import type { DashboardConfig } from '@rawdash/core';

import type { RawdashPlugin } from './plugin';
import { HealthPlugin } from './plugins/health';
import { SyncPlugin } from './plugins/sync';
import { WidgetsPlugin } from './plugins/widgets';
import { InMemoryStorage } from './storage';

export function createEnginePlugins(config: DashboardConfig): RawdashPlugin[] {
  const storage = new InMemoryStorage();
  return [
    new WidgetsPlugin(config, storage),
    new SyncPlugin(config, storage),
    new HealthPlugin(storage),
  ];
}
