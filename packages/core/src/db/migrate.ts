import type { Client, InStatement } from '@libsql/client/web';

import { MIGRATIONS } from './migrations-bundle';

const SCHEMA_MIGRATIONS_TABLE = 'schema_migrations';

const LEGACY_BASELINE_TABLE = 'events';

async function tableExists(client: Client, name: string): Promise<boolean> {
  const result = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    args: [name],
  });
  return result.rows.length > 0;
}

async function readAppliedTags(client: Client): Promise<Set<string>> {
  const result = await client.execute(
    `SELECT tag FROM ${SCHEMA_MIGRATIONS_TABLE}`,
  );
  return new Set(result.rows.map((r) => String(r['tag'])));
}

export async function applyMigrations(client: Client): Promise<void> {
  const hadSchemaTable = await tableExists(client, SCHEMA_MIGRATIONS_TABLE);

  await client.execute(
    `CREATE TABLE IF NOT EXISTS ${SCHEMA_MIGRATIONS_TABLE} (
      tag TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )`,
  );

  if (!hadSchemaTable) {
    const hasLegacySchema = await tableExists(client, LEGACY_BASELINE_TABLE);
    if (hasLegacySchema) {
      const now = Date.now();
      for (const migration of MIGRATIONS) {
        await client.execute({
          sql: `INSERT OR IGNORE INTO ${SCHEMA_MIGRATIONS_TABLE} (tag, applied_at) VALUES (?, ?)`,
          args: [migration.tag, now],
        });
      }
      return;
    }
  }

  let applied = await readAppliedTags(client);

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.tag)) {
      continue;
    }
    const batch: InStatement[] = [
      {
        sql: `INSERT INTO ${SCHEMA_MIGRATIONS_TABLE} (tag, applied_at) VALUES (?, ?)`,
        args: [migration.tag, Date.now()],
      },
      ...migration.statements,
    ];
    try {
      await client.batch(batch, 'write');
    } catch (err) {
      applied = await readAppliedTags(client);
      if (!applied.has(migration.tag)) {
        throw err;
      }
    }
  }
}
