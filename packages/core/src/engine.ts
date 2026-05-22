export type SyncStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed';

export interface SyncState {
  status: SyncStatus;
  queuedAt: string | null;
  startedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

export const ACTIVE_SYNC_STATUSES: ReadonlySet<SyncStatus> = new Set([
  'queued',
  'running',
]);

export function isSyncActive(status: SyncStatus): boolean {
  return ACTIVE_SYNC_STATUSES.has(status);
}
