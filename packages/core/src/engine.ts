export interface SyncState {
  status: 'idle' | 'syncing' | 'error';
  lastSyncAt: string | null;
  lastError: string | null;
}
