import type { StorageHandle } from '@rawdash/core';

import type { SyncState, WidgetEntry } from './types';

export class InMemoryStorage {
  private widgets = new Map<string, WidgetEntry>();
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
        const id = `${connectorId}.${String(widgetId)}`;
        this.widgets.set(id, {
          id,
          connectorId,
          widgetId: String(widgetId),
          data,
          cachedAt: new Date().toISOString(),
        });
      },
    };
  }

  getAllWidgets(): WidgetEntry[] {
    return [...this.widgets.values()];
  }

  getWidget(id: string): WidgetEntry | undefined {
    return this.widgets.get(id);
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
