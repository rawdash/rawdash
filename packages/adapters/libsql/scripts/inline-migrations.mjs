#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const drizzleDir = join(root, 'drizzle');
const outFile = join(root, 'src', 'migrations.ts');

const files = readdirSync(drizzleDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const migrations = files.map((file) => {
  const m = /^(\d+)_(.+)\.sql$/.exec(file);
  if (!m) {
    throw new Error(`Unexpected migration filename: ${file}`);
  }
  const version = Number.parseInt(m[1], 10);
  const tag = `${m[1]}_${m[2]}`;
  const raw = readFileSync(join(drizzleDir, file), 'utf8');
  const statements = raw
    .split('--> statement-breakpoint')
    .map((s) =>
      s
        .trim()
        .replace(/;+\s*$/, '')
        .trim(),
    )
    .filter((s) => s.length > 0);
  return { version, tag, statements };
});

const tsLiteral = (s) =>
  '`' + s.replaceAll('\\', '\\\\').replaceAll('`', '\\`') + '`';

const body = migrations
  .map(
    (m) => `  {
    version: ${m.version},
    tag: ${JSON.stringify(m.tag)},
    statements: [
${m.statements.map((s) => `      ${tsLiteral(s)},`).join('\n')}
    ],
  },`,
  )
  .join('\n');

const header = `import type { Client, InValue } from '@libsql/client/web';

export interface Migration {
  version: number;
  tag: string;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
${body}
];

const SCHEMA_MIGRATIONS_DDL = \`CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  tag TEXT NOT NULL,
  applied_at INTEGER NOT NULL
)\`;

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
`;

writeFileSync(outFile, header);
console.log(`Inlined ${migrations.length} migration(s) into ${outFile}`);
