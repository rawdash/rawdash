import { describe, expect, it } from 'vitest';

import {
  type ConnectorLifecycleState,
  type ConnectorLifecycleStatus,
  DEFAULT_CONNECTOR_LIFECYCLE_POLICY,
  DEFAULT_CONNECTOR_LIFECYCLE_STATE,
  advanceConnectorLifecycle,
  connectorHealthFromLifecycle,
  isRecoverable,
  isSchedulable,
} from './connector-lifecycle';

const AT = '2026-07-05T00:00:00.000Z';

function failN(
  n: number,
  from: ConnectorLifecycleState = DEFAULT_CONNECTOR_LIFECYCLE_STATE,
): ConnectorLifecycleState {
  let state = from;
  for (let i = 0; i < n; i++) {
    state = advanceConnectorLifecycle(state, {
      type: 'sync-failed',
      at: AT,
      error: `boom ${i}`,
    });
  }
  return state;
}

describe('DEFAULT_CONNECTOR_LIFECYCLE_STATE', () => {
  it('is an idle state with no failures', () => {
    expect(DEFAULT_CONNECTOR_LIFECYCLE_STATE).toEqual({
      status: 'idle',
      consecutiveFailures: 0,
      lastSyncAt: null,
      lastError: null,
      nextRetryAt: null,
    });
  });
});

describe('advanceConnectorLifecycle', () => {
  it('marks the connector syncing when a sync starts', () => {
    const state = advanceConnectorLifecycle(DEFAULT_CONNECTOR_LIFECYCLE_STATE, {
      type: 'sync-started',
    });
    expect(state.status).toBe('syncing');
  });

  it('preserves prior failure context while syncing', () => {
    const failed = failN(2);
    const syncing = advanceConnectorLifecycle(failed, { type: 'sync-started' });
    expect(syncing.status).toBe('syncing');
    expect(syncing.consecutiveFailures).toBe(2);
    expect(syncing.lastError).toBe('boom 1');
    expect(syncing.nextRetryAt).toBe(failed.nextRetryAt);
  });

  it('resets to idle at normal cadence on success', () => {
    const succeeded = advanceConnectorLifecycle(failN(3), {
      type: 'sync-succeeded',
      at: AT,
    });
    expect(succeeded).toEqual({
      status: 'idle',
      consecutiveFailures: 0,
      lastSyncAt: AT,
      lastError: null,
      nextRetryAt: null,
    });
  });

  it('enters error with exponential backoff on a transient failure', () => {
    const state = advanceConnectorLifecycle(DEFAULT_CONNECTOR_LIFECYCLE_STATE, {
      type: 'sync-failed',
      at: AT,
      error: 'timeout',
    });
    expect(state.status).toBe('error');
    expect(state.consecutiveFailures).toBe(1);
    expect(state.lastError).toBe('timeout');
    expect(state.nextRetryAt).toBe(
      new Date(
        new Date(AT).getTime() +
          DEFAULT_CONNECTOR_LIFECYCLE_POLICY.errorBackoff.baseMs,
      ).toISOString(),
    );
  });

  it('grows the backoff with each consecutive transient failure', () => {
    const first = failN(1);
    const second = advanceConnectorLifecycle(first, {
      type: 'sync-failed',
      at: AT,
      error: 'again',
    });
    const firstDelay =
      new Date(first.nextRetryAt!).getTime() - new Date(AT).getTime();
    const secondDelay =
      new Date(second.nextRetryAt!).getTime() - new Date(AT).getTime();
    expect(secondDelay).toBe(firstDelay * 2);
  });

  it('flips to paused with the long retry once the threshold is reached', () => {
    const state = failN(DEFAULT_CONNECTOR_LIFECYCLE_POLICY.pauseAfterFailures);
    expect(state.status).toBe('paused');
    expect(state.nextRetryAt).toBe(
      new Date(
        new Date(AT).getTime() +
          DEFAULT_CONNECTOR_LIFECYCLE_POLICY.pausedRetryMs,
      ).toISOString(),
    );
  });

  it('keeps paused recoverable: a later success returns to idle', () => {
    const paused = failN(DEFAULT_CONNECTOR_LIFECYCLE_POLICY.pauseAfterFailures);
    expect(paused.status).toBe('paused');
    const recovered = advanceConnectorLifecycle(paused, {
      type: 'sync-succeeded',
      at: AT,
    });
    expect(recovered.status).toBe('idle');
    expect(recovered.consecutiveFailures).toBe(0);
    expect(recovered.nextRetryAt).toBeNull();
  });

  it('stops and awaits reauth on a terminal failure without scheduling a retry', () => {
    const state = advanceConnectorLifecycle(DEFAULT_CONNECTOR_LIFECYCLE_STATE, {
      type: 'sync-failed',
      at: AT,
      error: 'revoked',
      kind: 'terminal',
    });
    expect(state.status).toBe('auth_failed');
    expect(state.nextRetryAt).toBeNull();
    expect(state.consecutiveFailures).toBe(1);
  });

  it('recovers from auth_failed on success', () => {
    const authFailed = advanceConnectorLifecycle(
      DEFAULT_CONNECTOR_LIFECYCLE_STATE,
      { type: 'sync-failed', at: AT, error: 'revoked', kind: 'terminal' },
    );
    const recovered = advanceConnectorLifecycle(authFailed, {
      type: 'sync-succeeded',
      at: AT,
    });
    expect(recovered.status).toBe('idle');
  });

  it('treats an omitted kind as a connector fault on the pause path', () => {
    const state = failN(DEFAULT_CONNECTOR_LIFECYCLE_POLICY.pauseAfterFailures);
    expect(state.status).toBe('paused');
  });

  it('retries a retryable-infra failure without advancing toward pause', () => {
    let state = DEFAULT_CONNECTOR_LIFECYCLE_STATE;
    for (
      let i = 0;
      i < DEFAULT_CONNECTOR_LIFECYCLE_POLICY.pauseAfterFailures * 2;
      i++
    ) {
      state = advanceConnectorLifecycle(state, {
        type: 'sync-failed',
        at: AT,
        error: 'turso unreachable',
        kind: 'retryable-infra',
      });
    }
    expect(state.status).toBe('error');
    expect(state.consecutiveFailures).toBe(0);
    expect(state.lastError).toBe('turso unreachable');
    expect(state.nextRetryAt).toBe(
      new Date(
        new Date(AT).getTime() +
          DEFAULT_CONNECTOR_LIFECYCLE_POLICY.errorBackoff.baseMs,
      ).toISOString(),
    );
  });

  it('does not let a retryable-infra failure raise an existing pause counter', () => {
    const faulted = failN(3);
    const infra = advanceConnectorLifecycle(faulted, {
      type: 'sync-failed',
      at: AT,
      error: 'turso unreachable',
      kind: 'retryable-infra',
    });
    expect(infra.status).toBe('error');
    expect(infra.consecutiveFailures).toBe(3);
  });

  it('recovers to idle once a retryable-infra outage clears', () => {
    const infra = advanceConnectorLifecycle(DEFAULT_CONNECTOR_LIFECYCLE_STATE, {
      type: 'sync-failed',
      at: AT,
      error: 'turso unreachable',
      kind: 'retryable-infra',
    });
    const recovered = advanceConnectorLifecycle(infra, {
      type: 'sync-succeeded',
      at: AT,
    });
    expect(recovered.status).toBe('idle');
    expect(recovered.consecutiveFailures).toBe(0);
  });

  it('honors a custom policy', () => {
    const policy = {
      errorBackoff: { baseMs: 1_000, ceilingMs: 10_000 },
      pauseAfterFailures: 2,
      pausedRetryMs: 100_000,
    };
    const once = advanceConnectorLifecycle(
      DEFAULT_CONNECTOR_LIFECYCLE_STATE,
      { type: 'sync-failed', at: AT, error: 'x' },
      policy,
    );
    expect(once.status).toBe('error');
    const twice = advanceConnectorLifecycle(
      once,
      { type: 'sync-failed', at: AT, error: 'x' },
      policy,
    );
    expect(twice.status).toBe('paused');
  });
});

describe('isRecoverable', () => {
  it('treats auth_failed as needing intervention', () => {
    expect(isRecoverable('auth_failed')).toBe(false);
  });

  it('treats every other status as self-recoverable', () => {
    const recoverable: ConnectorLifecycleStatus[] = [
      'idle',
      'syncing',
      'error',
      'paused',
    ];
    for (const status of recoverable) {
      expect(isRecoverable(status)).toBe(true);
    }
  });
});

describe('isSchedulable', () => {
  const now = new Date('2026-07-05T12:00:00.000Z');

  it('schedules a fresh idle connector', () => {
    expect(isSchedulable(DEFAULT_CONNECTOR_LIFECYCLE_STATE, now)).toBe(true);
  });

  it('never schedules a connector while it is syncing', () => {
    const state = advanceConnectorLifecycle(DEFAULT_CONNECTOR_LIFECYCLE_STATE, {
      type: 'sync-started',
    });
    expect(isSchedulable(state, now)).toBe(false);
  });

  it('never schedules an auth_failed connector even past its window', () => {
    const state = advanceConnectorLifecycle(DEFAULT_CONNECTOR_LIFECYCLE_STATE, {
      type: 'sync-failed',
      at: AT,
      error: 'revoked',
      kind: 'terminal',
    });
    expect(isSchedulable(state, now)).toBe(false);
  });

  it('holds off within the retry window and schedules once it elapses', () => {
    const state = advanceConnectorLifecycle(DEFAULT_CONNECTOR_LIFECYCLE_STATE, {
      type: 'sync-failed',
      at: AT,
      error: 'timeout',
    });
    const retryAt = new Date(state.nextRetryAt!);
    expect(isSchedulable(state, new Date(retryAt.getTime() - 1))).toBe(false);
    expect(isSchedulable(state, retryAt)).toBe(true);
  });

  it('re-schedules a paused connector once its long retry window elapses', () => {
    const paused = failN(DEFAULT_CONNECTOR_LIFECYCLE_POLICY.pauseAfterFailures);
    const retryAt = new Date(paused.nextRetryAt!);
    expect(isSchedulable(paused, new Date(retryAt.getTime() - 1))).toBe(false);
    expect(isSchedulable(paused, retryAt)).toBe(true);
  });
});

describe('connectorHealthFromLifecycle', () => {
  it('projects lifecycle state onto the connector health contract', () => {
    const state = failN(1);
    expect(connectorHealthFromLifecycle(state, 300)).toEqual({
      status: 'error',
      lastSyncAt: null,
      lastError: 'boom 0',
      syncIntervalSeconds: 300,
    });
  });
});
