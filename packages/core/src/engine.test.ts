import { describe, expect, it } from 'vitest';

import {
  ACTIVE_SYNC_STATUSES,
  DEFAULT_SYNC_STATE,
  isSyncActive,
} from './engine';

describe('DEFAULT_SYNC_STATE', () => {
  it('represents an idle state with no runs recorded', () => {
    expect(DEFAULT_SYNC_STATE).toEqual({
      status: 'idle',
      queuedAt: null,
      startedAt: null,
      lastSyncAt: null,
      lastError: null,
    });
  });

  it('is not an active sync status', () => {
    expect(isSyncActive(DEFAULT_SYNC_STATE.status)).toBe(false);
    expect(ACTIVE_SYNC_STATUSES.has(DEFAULT_SYNC_STATE.status)).toBe(false);
  });
});
