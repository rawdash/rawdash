import { type Client, createClient } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyMigrations } from './migrate';
import { MIGRATIONS } from './migrations-bundle';

describe('applyMigrations', () => {
  let client: Client;

  beforeEach(() => {
    client = createClient({ url: ':memory:' });
  });

  afterEach(() => {
    client.close();
  });

  it('creates schema_migrations and applies all bundled migrations on a fresh db', async () => {
    await applyMigrations(client);

    const applied = await client.execute('SELECT tag FROM schema_migrations');
    const tags = applied.rows.map((r) => String(r['tag']));
    expect(tags.sort()).toEqual(MIGRATIONS.map((m) => m.tag).sort());

    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    const tableNames = tables.rows.map((r) => String(r['name']));
    expect(tableNames).toContain('events');
    expect(tableNames).toContain('entities');
    expect(tableNames).toContain('metrics');
    expect(tableNames).toContain('edges');
    expect(tableNames).toContain('distributions');
    expect(tableNames).toContain('sync_state');
  });

  it('is idempotent across repeated calls', async () => {
    await applyMigrations(client);
    await applyMigrations(client);
    const applied = await client.execute(
      'SELECT COUNT(*) AS n FROM schema_migrations',
    );
    expect(Number(applied.rows[0]!['n'])).toBe(MIGRATIONS.length);
  });

  it('baselines pre-existing legacy schemas without re-running migrations', async () => {
    await client.execute(
      'CREATE TABLE events (id INTEGER PRIMARY KEY, name TEXT NOT NULL)',
    );

    await applyMigrations(client);

    const applied = await client.execute('SELECT tag FROM schema_migrations');
    const tags = applied.rows.map((r) => String(r['tag']));
    expect(tags.sort()).toEqual(MIGRATIONS.map((m) => m.tag).sort());

    const cols = await client.execute('PRAGMA table_info(events)');
    expect(cols.rows.map((r) => String(r['name']))).toEqual(['id', 'name']);
  });
});
