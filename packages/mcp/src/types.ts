import type {
  ConfiguredConnector,
  Connector,
  ConnectorRegistry,
  DashboardConfig,
  SecretsResolver,
  ServerStorage,
} from '@rawdash/core';
import type { ZodObject, ZodRawShape } from 'zod';

export interface McpErrorPayload {
  error: { code: string; message: string };
}

export interface ConnectorFactory {
  id: string;
  configFields: ZodObject<ZodRawShape>;
  create(settings: unknown): Connector;
}

export interface McpServerOptions {
  name?: string;
  version?: string;
  config: DashboardConfig;
  storage: ServerStorage;
  connectorRegistry?: ConnectorRegistry;
  secretsResolver?: SecretsResolver;
  connectorFactories?: ConnectorFactory[];
  onAddConnector?: (entry: ConfiguredConnector) => void | Promise<void>;
  onRemoveConnector?: (name: string) => void | Promise<void>;
  onSetSecret?: (name: string, value: string) => void | Promise<void>;
  listSecrets?: () => string[] | Promise<string[]>;
}
