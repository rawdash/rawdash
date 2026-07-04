import { describe, expect, it } from 'vitest';

import { InMemoryStorage } from './in-memory-storage';

describe('InMemoryStorage — entities', () => {
  it('filters entities by type', async () => {
    const h = new InMemoryStorage().getStorageHandle('c');
    await h.entities([
      { type: 'pr', id: '1', attributes: {}, updated_at: 1000 },
      { type: 'user', id: 'alice', attributes: {}, updated_at: 2000 },
    ]);
    const prs = await h.queryEntities({ type: 'pr' });
    expect(prs).toHaveLength(1);
    expect(prs[0]!.id).toBe('1');
  });

  it('returns all entities across types when type is omitted', async () => {
    const h = new InMemoryStorage().getStorageHandle('c');
    await h.entities([
      { type: 'pr', id: '1', attributes: {}, updated_at: 1000 },
      { type: 'user', id: 'alice', attributes: {}, updated_at: 2000 },
      { type: 'user', id: 'bob', attributes: {}, updated_at: 3000 },
    ]);
    const all = await h.queryEntities({});
    expect(all).toHaveLength(3);
    expect(new Set(all.map((e) => e.type))).toEqual(new Set(['pr', 'user']));
  });

  it('returns an empty array when there are no entities', async () => {
    const h = new InMemoryStorage().getStorageHandle('c');
    expect(await h.queryEntities({})).toEqual([]);
  });
});
