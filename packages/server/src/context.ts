import type { DashboardConfig, ServerStorage } from '@rawdash/core';

export interface EngineContext {
  getConfig: () => DashboardConfig | Promise<DashboardConfig>;
  getStorage: () => ServerStorage | Promise<ServerStorage>;
}
