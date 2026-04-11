import type { ConnectorDef } from '@rawdash/core';

export type ConnectorEntry<
  TConfig = unknown,
  TWidgets extends Record<string, unknown> = Record<string, unknown>,
> = {
  connector: ConnectorDef<TConfig, TWidgets>;
  config: TConfig;
};

export interface RawdashServerConfig<
  TEntry extends ConnectorEntry<any, any> = ConnectorEntry<any, any>,
> {
  connectors: TEntry[];
}

export interface WidgetEntry {
  id: string;
  connectorId: string;
  widgetId: string;
  data: unknown;
  cachedAt: string;
}

export interface SyncState {
  status: 'idle' | 'syncing' | 'error';
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface ServeOptions {
  port?: number;
}
