import type { DashboardConfig } from '@rawdash/core';

import type { RawdashIntegration } from './integration';
import { HealthIntegration } from './integrations/health';
import { SyncIntegration } from './integrations/sync';
import { WidgetsIntegration } from './integrations/widgets';
import { InMemoryStorage } from './storage';

export function createEngineIntegrations(
  config: DashboardConfig,
): RawdashIntegration[] {
  const storage = new InMemoryStorage();
  return [
    new WidgetsIntegration(config, storage),
    new SyncIntegration(config, storage),
    new HealthIntegration(storage),
  ];
}
