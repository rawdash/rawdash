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
    if (this.connectors.some((e) => e.name === entry.name)) {
      throw new Error(`Connector "${entry.name}" already exists`);
    }
    this.connectors = [...this.connectors, entry];
  }

  removeConnector(name: string): boolean {
    const before = this.connectors.length;
    this.connectors = this.connectors.filter((e) => e.name !== name);
    return this.connectors.length < before;
  }
}
