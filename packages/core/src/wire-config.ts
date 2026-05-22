import { z } from 'zod';

import type { DashboardConfig } from './config';

export const wireConnectorSchema = z.object({
  name: z.string(),
  connectorId: z.string(),
  displayName: z.string().optional(),
  config: z.record(z.string(), z.unknown()),
  syncIntervalSeconds: z.number().optional(),
  enabled: z.boolean().optional(),
});

export const wireDashboardSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  slug: z.string(),
  config: z.record(z.string(), z.unknown()),
});

export const wireConfigSchema = z.object({
  connectors: z.array(wireConnectorSchema).optional(),
  dashboards: z.array(wireDashboardSchema).optional(),
});

export type WireConnector = z.infer<typeof wireConnectorSchema>;
export type WireDashboard = z.infer<typeof wireDashboardSchema>;
export type WireConfig = z.infer<typeof wireConfigSchema>;

export function toWireConfig(config: DashboardConfig): WireConfig {
  return {
    connectors: config.connectors.map((entry) => ({
      name: entry.name,
      connectorId: entry.connectorId,
      displayName: entry.displayName ?? entry.name,
      config: entry.config,
      syncIntervalSeconds: entry.syncIntervalSeconds ?? 300,
      enabled: entry.enabled ?? true,
    })),
    dashboards: Object.entries(config.dashboards).map(([id, dash]) => ({
      id,
      name: id,
      slug: id,
      config: { widgets: dash.widgets },
    })),
  };
}
