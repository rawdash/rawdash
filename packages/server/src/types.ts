import type { ServerStorage } from '@rawdash/core';

export type {
  ConfiguredConnector,
  DashboardConfig,
  ServerStorage,
} from '@rawdash/core';

export interface ServeOptions {
  port?: number;
  storage?: ServerStorage;
}
