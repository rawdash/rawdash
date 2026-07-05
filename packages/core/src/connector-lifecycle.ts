import type { ConnectorHealth } from './connector';
import type { RetryBackoffOptions } from './retry-backoff';
import { computeRetryBackoffMs } from './retry-backoff';

export type ConnectorLifecycleStatus =
  | 'idle'
  | 'syncing'
  | 'error'
  | 'paused'
  | 'auth_failed';

export type SyncFailureKind = 'transient' | 'auth';

export interface ConnectorLifecycleState {
  status: ConnectorLifecycleStatus;
  consecutiveFailures: number;
  lastSyncAt: string | null;
  lastError: string | null;
  nextRetryAt: string | null;
}

export const DEFAULT_CONNECTOR_LIFECYCLE_STATE: ConnectorLifecycleState =
  Object.freeze({
    status: 'idle',
    consecutiveFailures: 0,
    lastSyncAt: null,
    lastError: null,
    nextRetryAt: null,
  });

export interface ConnectorLifecyclePolicy {
  errorBackoff: RetryBackoffOptions;
  pauseAfterFailures: number;
  pausedRetryMs: number;
}

export const DEFAULT_CONNECTOR_LIFECYCLE_POLICY: ConnectorLifecyclePolicy =
  Object.freeze({
    errorBackoff: { baseMs: 60_000, ceilingMs: 30 * 60_000 },
    pauseAfterFailures: 5,
    pausedRetryMs: 6 * 60 * 60 * 1000,
  });

export type ConnectorLifecycleEvent =
  | { type: 'sync-started' }
  | { type: 'sync-succeeded'; at: string }
  | { type: 'sync-failed'; at: string; error: string; kind?: SyncFailureKind };

const RECOVERABLE_LIFECYCLE_STATUSES: ReadonlySet<ConnectorLifecycleStatus> =
  new Set(['idle', 'syncing', 'error', 'paused']);

export function isRecoverable(status: ConnectorLifecycleStatus): boolean {
  return RECOVERABLE_LIFECYCLE_STATUSES.has(status);
}

export function isSchedulable(
  state: ConnectorLifecycleState,
  now: Date,
): boolean {
  if (state.status === 'syncing') {
    return false;
  }
  if (!isRecoverable(state.status)) {
    return false;
  }
  if (state.nextRetryAt === null) {
    return true;
  }
  return now.getTime() >= new Date(state.nextRetryAt).getTime();
}

export function advanceConnectorLifecycle(
  state: ConnectorLifecycleState,
  event: ConnectorLifecycleEvent,
  policy: ConnectorLifecyclePolicy = DEFAULT_CONNECTOR_LIFECYCLE_POLICY,
): ConnectorLifecycleState {
  switch (event.type) {
    case 'sync-started':
      return { ...state, status: 'syncing' };

    case 'sync-succeeded':
      return {
        status: 'idle',
        consecutiveFailures: 0,
        lastSyncAt: event.at,
        lastError: null,
        nextRetryAt: null,
      };

    case 'sync-failed': {
      const consecutiveFailures = state.consecutiveFailures + 1;

      if (event.kind === 'auth') {
        return {
          status: 'auth_failed',
          consecutiveFailures,
          lastSyncAt: state.lastSyncAt,
          lastError: event.error,
          nextRetryAt: null,
        };
      }

      const paused = consecutiveFailures >= policy.pauseAfterFailures;
      const delayMs = paused
        ? policy.pausedRetryMs
        : computeRetryBackoffMs(consecutiveFailures, policy.errorBackoff);
      const nextRetryAt = new Date(
        new Date(event.at).getTime() + delayMs,
      ).toISOString();

      return {
        status: paused ? 'paused' : 'error',
        consecutiveFailures,
        lastSyncAt: state.lastSyncAt,
        lastError: event.error,
        nextRetryAt,
      };
    }
  }
}

export function connectorHealthFromLifecycle(
  state: ConnectorLifecycleState,
  syncIntervalSeconds: number,
): ConnectorHealth {
  return {
    status: state.status,
    lastSyncAt: state.lastSyncAt,
    lastError: state.lastError,
    syncIntervalSeconds,
  };
}
