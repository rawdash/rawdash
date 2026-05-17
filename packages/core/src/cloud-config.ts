import { z } from 'zod';

import type { DashboardConfig } from './config';

export const cloudConnectorSchema = z.object({
  name: z.string(),
  connectorId: z.string(),
  displayName: z.string().optional(),
  config: z.record(z.string(), z.unknown()),
  syncIntervalSeconds: z.number().optional(),
  enabled: z.boolean().optional(),
});

export const cloudDashboardSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  slug: z.string(),
  config: z.record(z.string(), z.unknown()),
});

export const cloudConfigSchema = z.object({
  connectors: z.array(cloudConnectorSchema).optional(),
  dashboards: z.array(cloudDashboardSchema).optional(),
});

export type CloudConnector = z.infer<typeof cloudConnectorSchema>;
export type CloudDashboard = z.infer<typeof cloudDashboardSchema>;
export type CloudConfig = z.infer<typeof cloudConfigSchema>;

export function toCloudConfig(ossConfig: DashboardConfig): CloudConfig {
  return {
    connectors: ossConfig.connectors.map(({ connector }) => ({
      name: connector.id,
      connectorId: connector.id,
      displayName: connector.id,
      config: connector.serializeConfig(),
      syncIntervalSeconds: 300,
      enabled: true,
    })),
    dashboards: Object.entries(ossConfig.dashboards).map(([id, dash]) => ({
      id,
      name: id,
      slug: id,
      config: { widgets: dash.widgets },
    })),
  };
}
