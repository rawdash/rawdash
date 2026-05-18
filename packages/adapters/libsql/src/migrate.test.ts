import { type Client, createClient } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyMigrations, migrateIfNeeded } from './migrate';
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

  it('survives concurrent runners racing on the same fresh db', async () => {
    await Promise.all([
      applyMigrations(client),
      applyMigrations(client),
      applyMigrations(client),
    ]);

    const applied = await client.execute(
      'SELECT tag, COUNT(*) AS n FROM schema_migrations GROUP BY tag',
    );
    expect(applied.rows).toHaveLength(MIGRATIONS.length);
    for (const row of applied.rows) {
      expect(Number(row['n'])).toBe(1);
    }
  });

  it('migrateIfNeeded bootstraps a fresh db', async () => {
    await migrateIfNeeded(client);

    const applied = await client.execute('SELECT tag FROM schema_migrations');
    const tags = applied.rows.map((r) => String(r['tag']));
    expect(tags.sort()).toEqual(MIGRATIONS.map((m) => m.tag).sort());
  });

  it('migrateIfNeeded is a no-op when schema is current', async () => {
    await applyMigrations(client);

    let executes = 0;
    let batches = 0;
    const originalExecute = client.execute.bind(client);
    const originalBatch = client.batch.bind(client);
    client.execute = ((...args: Parameters<typeof originalExecute>) => {
      executes += 1;
      return originalExecute(...args);
    }) as typeof client.execute;
    client.batch = ((...args: Parameters<typeof originalBatch>) => {
      batches += 1;
      return originalBatch(...args);
    }) as typeof client.batch;

    await migrateIfNeeded(client);

    expect(executes).toBe(1);
    expect(batches).toBe(0);
  });

  it('migrateIfNeeded applies missing migrations when schema is stale', async () => {
    await client.execute(
      `CREATE TABLE schema_migrations (tag TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`,
    );
    await client.execute({
      sql: `INSERT INTO schema_migrations (tag, applied_at) VALUES (?, ?)`,
      args: [MIGRATIONS[0]!.tag, Date.now()],
    });

    await migrateIfNeeded(client);

    const applied = await client.execute('SELECT tag FROM schema_migrations');
    const tags = applied.rows.map((r) => String(r['tag']));
    expect(tags.sort()).toEqual(MIGRATIONS.map((m) => m.tag).sort());
  });

  it('runs migrations against a db with only a stray events table when not opted in', async () => {
    await client.execute(
      'CREATE TABLE events (id INTEGER PRIMARY KEY, name TEXT NOT NULL)',
    );

    await expect(applyMigrations(client)).rejects.toThrow();
  });

  it('does not re-run migrations when schema_migrations is fully populated even with a legacy events table', async () => {
    await client.execute(
      'CREATE TABLE events (id INTEGER PRIMARY KEY, name TEXT NOT NULL)',
    );
    await client.execute(
      `CREATE TABLE schema_migrations (tag TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`,
    );
    const now = Date.now();
    for (const migration of MIGRATIONS) {
      await client.execute({
        sql: `INSERT INTO schema_migrations (tag, applied_at) VALUES (?, ?)`,
        args: [migration.tag, now],
      });
    }

    await applyMigrations(client);

    const applied = await client.execute('SELECT tag FROM schema_migrations');
    const tags = applied.rows.map((r) => String(r['tag']));
    expect(tags.sort()).toEqual(MIGRATIONS.map((m) => m.tag).sort());

    const cols = await client.execute('PRAGMA table_info(events)');
    expect(cols.rows.map((r) => String(r['name']))).toEqual(['id', 'name']);
  });

  it('baselines pre-existing legacy schemas without re-running migrations when opted in', async () => {
    await client.execute(
      'CREATE TABLE events (id INTEGER PRIMARY KEY, name TEXT NOT NULL)',
    );

    await applyMigrations(client, { assumeLegacyBaselineIfEventsExists: true });

    const applied = await client.execute('SELECT tag FROM schema_migrations');
    const tags = applied.rows.map((r) => String(r['tag']));
    expect(tags.sort()).toEqual(MIGRATIONS.map((m) => m.tag).sort());

    const cols = await client.execute('PRAGMA table_info(events)');
    expect(cols.rows.map((r) => String(r['name']))).toEqual(['id', 'name']);
  });
});
