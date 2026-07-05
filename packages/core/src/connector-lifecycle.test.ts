import { describe, expect, it } from 'vitest';

import {
  type ConnectorLifecycleState,
  type ConnectorLifecycleStatus,
  DEFAULT_CONNECTOR_LIFECYCLE_POLICY,
  DEFAULT_CONNECTOR_LIFECYCLE_STATE,
  advanceConnectorLifecycle,
  advanceConnectorLifecycleWithTransition,
  connectorHealthFromLifecycle,
  deriveConnectorLifecycleTransition,
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
      consecutiveInfraFailures: 0,
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
      consecutiveInfraFailures: 0,
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

  function infraFail(
    from: ConnectorLifecycleState = DEFAULT_CONNECTOR_LIFECYCLE_STATE,
  ): ConnectorLifecycleState {
    return advanceConnectorLifecycle(from, {
      type: 'sync-failed',
      at: AT,
      error: 'turso unreachable',
      kind: 'retryable-infra',
    });
  }

  it('enters a retryable error on a retryable-infra failure with base backoff', () => {
    const state = infraFail();
    expect(state.status).toBe('error');
    expect(state.consecutiveInfraFailures).toBe(1);
    expect(state.lastError).toBe('turso unreachable');
    expect(state.nextRetryAt).toBe(
      new Date(
        new Date(AT).getTime() +
          DEFAULT_CONNECTOR_LIFECYCLE_POLICY.errorBackoff.baseMs,
      ).toISOString(),
    );
  });

  it('backs off exponentially on repeated retryable-infra failures without pausing', () => {
    let state = DEFAULT_CONNECTOR_LIFECYCLE_STATE;
    for (
      let i = 0;
      i < DEFAULT_CONNECTOR_LIFECYCLE_POLICY.pauseAfterFailures * 2;
      i++
    ) {
      state = infraFail(state);
      expect(state.status).toBe('error');
      expect(state.consecutiveFailures).toBe(0);
    }
    expect(state.consecutiveInfraFailures).toBe(
      DEFAULT_CONNECTOR_LIFECYCLE_POLICY.pauseAfterFailures * 2,
    );

    const first = infraFail();
    const second = infraFail(first);
    const firstDelay =
      new Date(first.nextRetryAt!).getTime() - new Date(AT).getTime();
    const secondDelay =
      new Date(second.nextRetryAt!).getTime() - new Date(AT).getTime();
    expect(secondDelay).toBe(firstDelay * 2);
  });

  it('does not let a retryable-infra failure raise an existing pause counter', () => {
    const faulted = failN(3);
    const infra = infraFail(faulted);
    expect(infra.status).toBe('error');
    expect(infra.consecutiveFailures).toBe(3);
    expect(infra.consecutiveInfraFailures).toBe(1);
  });

  it('resets the infra backoff once a real connector fault takes over', () => {
    const infra = infraFail(infraFail());
    expect(infra.consecutiveInfraFailures).toBe(2);
    const faulted = advanceConnectorLifecycle(infra, {
      type: 'sync-failed',
      at: AT,
      error: 'bad payload',
    });
    expect(faulted.consecutiveFailures).toBe(1);
    expect(faulted.consecutiveInfraFailures).toBe(0);
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

describe('deriveConnectorLifecycleTransition', () => {
  const threshold = DEFAULT_CONNECTOR_LIFECYCLE_POLICY.pauseAfterFailures;

  it('emits nothing for routine progress', () => {
    const syncing = advanceConnectorLifecycle(
      DEFAULT_CONNECTOR_LIFECYCLE_STATE,
      {
        type: 'sync-started',
      },
    );
    expect(
      deriveConnectorLifecycleTransition(
        DEFAULT_CONNECTOR_LIFECYCLE_STATE,
        syncing,
      ),
    ).toBeNull();

    const idle = advanceConnectorLifecycle(syncing, {
      type: 'sync-succeeded',
      at: AT,
    });
    expect(deriveConnectorLifecycleTransition(syncing, idle)).toBeNull();
  });

  it('emits nothing for a transient error below the pause threshold', () => {
    const prev = DEFAULT_CONNECTOR_LIFECYCLE_STATE;
    const next = advanceConnectorLifecycle(prev, {
      type: 'sync-failed',
      at: AT,
      error: 'timeout',
    });
    expect(next.status).toBe('error');
    expect(deriveConnectorLifecycleTransition(prev, next)).toBeNull();
  });

  it('emits paused when the connector first crosses the threshold', () => {
    const prev = failN(threshold - 1);
    const next = advanceConnectorLifecycle(prev, {
      type: 'sync-failed',
      at: AT,
      error: 'still down',
    });
    expect(next.status).toBe('paused');
    expect(deriveConnectorLifecycleTransition(prev, next)).toEqual({
      type: 'paused',
      status: 'paused',
      consecutiveFailures: threshold,
      lastError: 'still down',
      lastSyncAt: null,
      nextRetryAt: next.nextRetryAt,
    });
  });

  it('emits still-failing when a paused connector keeps failing', () => {
    const paused = failN(threshold);
    const next = advanceConnectorLifecycle(paused, {
      type: 'sync-failed',
      at: AT,
      error: 'again',
    });
    expect(next.status).toBe('paused');
    expect(deriveConnectorLifecycleTransition(paused, next)?.type).toBe(
      'still-failing',
    );
  });

  it('treats a re-pause after an interposed sync attempt as still-failing', () => {
    const paused = failN(threshold);
    const retrying = advanceConnectorLifecycle(paused, {
      type: 'sync-started',
    });
    const next = advanceConnectorLifecycle(retrying, {
      type: 'sync-failed',
      at: AT,
      error: 'again',
    });
    expect(next.status).toBe('paused');
    expect(deriveConnectorLifecycleTransition(retrying, next)?.type).toBe(
      'still-failing',
    );
  });

  it('emits auth-failed on entry into auth_failed', () => {
    const prev = DEFAULT_CONNECTOR_LIFECYCLE_STATE;
    const next = advanceConnectorLifecycle(prev, {
      type: 'sync-failed',
      at: AT,
      error: 'revoked',
      kind: 'auth',
    });
    expect(deriveConnectorLifecycleTransition(prev, next)).toEqual({
      type: 'auth-failed',
      status: 'auth_failed',
      consecutiveFailures: 1,
      lastError: 'revoked',
      lastSyncAt: null,
      nextRetryAt: null,
    });
  });

  it('does not re-emit auth-failed while already auth_failed', () => {
    const authFailed = advanceConnectorLifecycle(
      DEFAULT_CONNECTOR_LIFECYCLE_STATE,
      { type: 'sync-failed', at: AT, error: 'revoked', kind: 'auth' },
    );
    const next = advanceConnectorLifecycle(authFailed, {
      type: 'sync-failed',
      at: AT,
      error: 'revoked again',
      kind: 'auth',
    });
    expect(deriveConnectorLifecycleTransition(authFailed, next)).toBeNull();
  });

  it('emits recovered when a failing connector returns to idle', () => {
    const paused = failN(threshold);
    const retrying = advanceConnectorLifecycle(paused, {
      type: 'sync-started',
    });
    const next = advanceConnectorLifecycle(retrying, {
      type: 'sync-succeeded',
      at: AT,
    });
    expect(deriveConnectorLifecycleTransition(retrying, next)).toEqual({
      type: 'recovered',
      status: 'idle',
      consecutiveFailures: 0,
      lastError: null,
      lastSyncAt: AT,
      nextRetryAt: null,
    });
  });

  it('emits recovered directly out of auth_failed', () => {
    const authFailed = advanceConnectorLifecycle(
      DEFAULT_CONNECTOR_LIFECYCLE_STATE,
      { type: 'sync-failed', at: AT, error: 'revoked', kind: 'auth' },
    );
    const next = advanceConnectorLifecycle(authFailed, {
      type: 'sync-succeeded',
      at: AT,
    });
    expect(deriveConnectorLifecycleTransition(authFailed, next)?.type).toBe(
      'recovered',
    );
  });

  it('honors a custom pause threshold', () => {
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
    const twice = advanceConnectorLifecycle(
      once,
      { type: 'sync-failed', at: AT, error: 'x' },
      policy,
    );
    expect(deriveConnectorLifecycleTransition(once, twice, policy)?.type).toBe(
      'paused',
    );
  });
});

describe('advanceConnectorLifecycleWithTransition', () => {
  it('returns the advanced state alongside the derived transition', () => {
    const prev = failN(
      DEFAULT_CONNECTOR_LIFECYCLE_POLICY.pauseAfterFailures - 1,
    );
    const { state, transition } = advanceConnectorLifecycleWithTransition(
      prev,
      {
        type: 'sync-failed',
        at: AT,
        error: 'down',
      },
    );
    expect(state.status).toBe('paused');
    expect(transition).toEqual({
      type: 'paused',
      status: 'paused',
      consecutiveFailures:
        DEFAULT_CONNECTOR_LIFECYCLE_POLICY.pauseAfterFailures,
      lastError: 'down',
      lastSyncAt: null,
      nextRetryAt: state.nextRetryAt,
    });
  });

  it('returns a null transition when nothing noteworthy changes', () => {
    const { transition } = advanceConnectorLifecycleWithTransition(
      DEFAULT_CONNECTOR_LIFECYCLE_STATE,
      { type: 'sync-started' },
    );
    expect(transition).toBeNull();
  });
});
