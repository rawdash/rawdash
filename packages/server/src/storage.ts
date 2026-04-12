import type { StorageHandle } from '@rawdash/core';

import type { SyncState, WidgetEntry } from './types';

export class InMemoryStorage {
  private widgets = new Map<string, Map<string, WidgetEntry>>();
  private syncState: SyncState = {
    status: 'idle',
    lastSyncAt: null,
    lastError: null,
  };

  getStorageHandle(
    connectorId: string,
  ): StorageHandle<Record<string, unknown>> {
    return {
      setWidget: async (widgetId, data) => {
        const widgetIdStr = String(widgetId);
        if (!this.widgets.has(connectorId)) {
          this.widgets.set(connectorId, new Map());
        }
        this.widgets.get(connectorId)!.set(widgetIdStr, {
          id: `${connectorId}:${widgetIdStr}`,
          connectorId,
          widgetId: widgetIdStr,
          data,
          cachedAt: new Date().toISOString(),
        });
      },
    };
  }

  getAllWidgets(): WidgetEntry[] {
    return [...this.widgets.values()].flatMap((m) => [...m.values()]);
  }

  getWidget(connectorId: string, widgetId: string): WidgetEntry | undefined {
    return this.widgets.get(connectorId)?.get(widgetId);
  }

  getSyncState(): SyncState {
    return { ...this.syncState };
  }

  setSyncing(): void {
    this.syncState = { ...this.syncState, status: 'syncing' };
  }

  setSyncSuccess(): void {
    this.syncState = {
      status: 'idle',
      lastSyncAt: new Date().toISOString(),
      lastError: null,
    };
  }

  setSyncError(error: string): void {
    this.syncState = {
      status: 'error',
      lastSyncAt: this.syncState.lastSyncAt,
      lastError: error,
    };
  }
}
