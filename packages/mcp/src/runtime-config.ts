import type {
  ConfiguredConnector,
  Dashboard,
  DashboardConfig,
} from '@rawdash/core';

export class McpRuntime {
  private connectors: ConfiguredConnector[];
  private readonly dashboards: Record<string, Dashboard>;

  constructor(config: DashboardConfig) {
    this.connectors = [...config.connectors];
    this.dashboards = config.dashboards;
  }

  getConnectors(): ConfiguredConnector[] {
    return [...this.connectors];
  }

  getDashboards(): Record<string, Dashboard> {
    return this.dashboards;
  }

  addConnector(entry: ConfiguredConnector): void {
    if (this.connectors.some((e) => e.connector.id === entry.connector.id)) {
      throw new Error(`Connector "${entry.connector.id}" already exists`);
    }
    this.connectors = [...this.connectors, entry];
  }

  removeConnector(connectorId: string): boolean {
    const before = this.connectors.length;
    this.connectors = this.connectors.filter(
      (e) => e.connector.id !== connectorId,
    );
    return this.connectors.length < before;
  }
}
