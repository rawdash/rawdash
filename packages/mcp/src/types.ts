import type { ConnectorEntry, DashboardConfig } from '@rawdash/core';
import type { ServerStorage } from '@rawdash/server';
import type { ZodObject, ZodRawShape } from 'zod';

export interface McpError {
  error: { code: string; message: string };
}

export interface ConnectorFactory {
  id: string;
  configFields: ZodObject<ZodRawShape>;
  create(settings: unknown): ConnectorEntry;
}

export interface McpServerOptions {
  name?: string;
  version?: string;
  config: DashboardConfig;
  storage: ServerStorage;
  connectorFactories?: ConnectorFactory[];
  onAddConnector?: (entry: ConnectorEntry) => void | Promise<void>;
  onRemoveConnector?: (connectorId: string) => void | Promise<void>;
  onSetSecret?: (name: string, value: string) => void | Promise<void>;
  listSecrets?: () => string[] | Promise<string[]>;
}
