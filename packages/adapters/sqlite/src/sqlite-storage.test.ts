import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SqliteStorage } from './sqlite-storage';

describe('SqliteStorage', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rawdash-sqlite-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the parent directory and persists across instances', async () => {
    const file = join(dir, 'nested', 'storage.sqlite');

    const a = new SqliteStorage(file);
    const handleA = a.getStorageHandle('c1');
    await handleA.entity({
      type: 'thing',
      id: 'x',
      attributes: { hello: 'world' },
      updated_at: 1,
    });
    await a.close();

    expect(existsSync(file)).toBe(true);

    const b = new SqliteStorage(file);
    const handleB = b.getStorageHandle('c1');
    const got = await handleB.getEntity('thing', 'x');
    expect(got?.attributes['hello']).toBe('world');
    await b.close();
  });

  it('metrics replaceWindow refreshes only the in-window rows', async () => {
    const s = new SqliteStorage(join(dir, 'storage.sqlite'));
    const h = s.getStorageHandle('c1');
    await h.metrics([
      { name: 'installs', ts: 1000, value: 1, attributes: {} },
      { name: 'installs', ts: 2000, value: 2, attributes: {} },
      { name: 'installs', ts: 3000, value: 3, attributes: {} },
    ]);
    await h.metrics([], {
      names: ['installs'],
      replaceWindow: { start: 2000, end: 3000 },
    });
    const rows = await h.queryMetrics({ name: 'installs' });
    expect(rows.map((r) => r.ts)).toEqual([1000]);
    await s.close();
  });

  it('exposes sync state advisory locks', async () => {
    const s = new SqliteStorage(join(dir, 'storage.sqlite'));
    expect((await s.getSyncState()).status).toBe('idle');
    expect(await s.markSyncQueued()).toBe(true);
    expect(await s.markSyncRunning()).toBe(true);
    expect(await s.markSyncRunning()).toBe(false);
    await s.markSyncSucceeded();
    expect((await s.getSyncState()).status).toBe('succeeded');
    await s.close();
  });
});
