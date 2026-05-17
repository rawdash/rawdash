import type {
  ConfiguredConnector,
  DashboardConfig,
  ServerStorage,
} from '@rawdash/core';
import type { ZodObject, ZodRawShape } from 'zod';

export interface McpErrorPayload {
  error: { code: string; message: string };
}

export interface ConnectorFactory {
  id: string;
  configFields: ZodObject<ZodRawShape>;
  create(settings: unknown): ConfiguredConnector;
}

export interface McpServerOptions {
  name?: string;
  version?: string;
  config: DashboardConfig;
  storage: ServerStorage;
  connectorFactories?: ConnectorFactory[];
  onAddConnector?: (entry: ConfiguredConnector) => void | Promise<void>;
  onRemoveConnector?: (connectorId: string) => void | Promise<void>;
  onSetSecret?: (name: string, value: string) => void | Promise<void>;
  listSecrets?: () => string[] | Promise<string[]>;
}
