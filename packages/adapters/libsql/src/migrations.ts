import type { Client, InValue } from '@libsql/client/web';

export interface Migration {
  version: number;
  tag: string;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    version: 0,
    tag: '0000_nosy_wendell_vaughn',
    statements: [
      `CREATE TABLE \`distributions\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`connector_id\` text NOT NULL,
	\`name\` text NOT NULL,
	\`ts\` integer NOT NULL,
	\`kind\` text NOT NULL,
	\`data\` text NOT NULL,
	\`attributes\` text DEFAULT '{}' NOT NULL
)`,
      `CREATE INDEX \`distributions_conn_name_ts\` ON \`distributions\` (\`connector_id\`,\`name\`,\`ts\`)`,
      `CREATE TABLE \`edges\` (
	\`connector_id\` text NOT NULL,
	\`from_type\` text NOT NULL,
	\`from_id\` text NOT NULL,
	\`kind\` text NOT NULL,
	\`to_type\` text NOT NULL,
	\`to_id\` text NOT NULL,
	\`attributes\` text DEFAULT '{}' NOT NULL,
	\`updated_at\` integer NOT NULL,
	PRIMARY KEY(\`connector_id\`, \`from_type\`, \`from_id\`, \`kind\`, \`to_type\`, \`to_id\`)
)`,
      `CREATE INDEX \`edges_conn_kind\` ON \`edges\` (\`connector_id\`,\`kind\`)`,
      `CREATE INDEX \`edges_conn_from\` ON \`edges\` (\`connector_id\`,\`from_type\`,\`from_id\`)`,
      `CREATE TABLE \`entities\` (
	\`connector_id\` text NOT NULL,
	\`type\` text NOT NULL,
	\`id\` text NOT NULL,
	\`attributes\` text DEFAULT '{}' NOT NULL,
	\`updated_at\` integer NOT NULL,
	PRIMARY KEY(\`connector_id\`, \`type\`, \`id\`)
)`,
      `CREATE INDEX \`entities_conn_type\` ON \`entities\` (\`connector_id\`,\`type\`)`,
      `CREATE TABLE \`events\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`connector_id\` text NOT NULL,
	\`name\` text NOT NULL,
	\`start_ts\` integer NOT NULL,
	\`end_ts\` integer,
	\`attributes\` text DEFAULT '{}' NOT NULL
)`,
      `CREATE INDEX \`events_conn_name_start\` ON \`events\` (\`connector_id\`,\`name\`,\`start_ts\`)`,
      `CREATE TABLE \`metrics\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`connector_id\` text NOT NULL,
	\`name\` text NOT NULL,
	\`ts\` integer NOT NULL,
	\`value\` real NOT NULL,
	\`attributes\` text DEFAULT '{}' NOT NULL
)`,
      `CREATE INDEX \`metrics_conn_name_ts\` ON \`metrics\` (\`connector_id\`,\`name\`,\`ts\`)`,
    ],
  },
  {
    version: 1,
    tag: '0001_clumsy_siren',
    statements: [
      `CREATE TABLE \`sync_state\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`status\` text NOT NULL,
	\`last_sync_at\` text,
	\`last_error\` text
)`,
    ],
  },
];

const SCHEMA_MIGRATIONS_DDL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  tag TEXT NOT NULL,
  applied_at INTEGER NOT NULL
)`;

export async function applyMigrations(client: Client): Promise<void> {
  await client.execute(SCHEMA_MIGRATIONS_DDL);
  const applied = await client.execute('SELECT version FROM schema_migrations');
  const appliedVersions = new Set<number>(
    applied.rows.map((r) => Number(r['version'])),
  );

  for (const m of MIGRATIONS) {
    if (appliedVersions.has(m.version)) {
      continue;
    }
    const batch: { sql: string; args: InValue[] }[] = m.statements.map(
      (sql) => ({ sql, args: [] }),
    );
    batch.push({
      sql: 'INSERT INTO schema_migrations (version, tag, applied_at) VALUES (?, ?, ?)',
      args: [m.version, m.tag, Date.now()],
    });
    await client.batch(batch, 'write');
  }
}
