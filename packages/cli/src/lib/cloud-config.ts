import type { DashboardConfig } from '@rawdash/core';

export interface CloudConnector {
  name: string;
  connectorId: string;
  displayName?: string;
  config: Record<string, unknown>;
  syncIntervalSeconds?: number;
  enabled?: boolean;
}

export interface CloudDashboard {
  id?: string;
  name: string;
  slug: string;
  config: Record<string, unknown>;
}

export interface CloudConfigBody {
  connectors?: CloudConnector[];
  dashboards?: CloudDashboard[];
}

export function toCloudConfig(ossConfig: DashboardConfig): CloudConfigBody {
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
