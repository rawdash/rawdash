import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    connector_id: text('connector_id').notNull(),
    name: text('name').notNull(),
    start_ts: integer('start_ts').notNull(),
    end_ts: integer('end_ts'),
    attributes: text('attributes', { mode: 'json' })
      .notNull()
      .default(sql`'{}'`),
  },
  (t) => [
    index('events_conn_name_start').on(t.connector_id, t.name, t.start_ts),
  ],
);

export const entities = sqliteTable(
  'entities',
  {
    connector_id: text('connector_id').notNull(),
    type: text('type').notNull(),
    id: text('id').notNull(),
    attributes: text('attributes', { mode: 'json' })
      .notNull()
      .default(sql`'{}'`),
    updated_at: integer('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.connector_id, t.type, t.id] }),
    index('entities_conn_type').on(t.connector_id, t.type),
  ],
);

export const metrics = sqliteTable(
  'metrics',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    connector_id: text('connector_id').notNull(),
    name: text('name').notNull(),
    ts: integer('ts').notNull(),
    value: real('value').notNull(),
    attributes: text('attributes', { mode: 'json' })
      .notNull()
      .default(sql`'{}'`),
  },
  (t) => [index('metrics_conn_name_ts').on(t.connector_id, t.name, t.ts)],
);

export const edges = sqliteTable(
  'edges',
  {
    connector_id: text('connector_id').notNull(),
    from_type: text('from_type').notNull(),
    from_id: text('from_id').notNull(),
    kind: text('kind').notNull(),
    to_type: text('to_type').notNull(),
    to_id: text('to_id').notNull(),
    attributes: text('attributes', { mode: 'json' })
      .notNull()
      .default(sql`'{}'`),
    updated_at: integer('updated_at').notNull(),
  },
  (t) => [
    primaryKey({
      columns: [
        t.connector_id,
        t.from_type,
        t.from_id,
        t.kind,
        t.to_type,
        t.to_id,
      ],
    }),
    index('edges_conn_kind').on(t.connector_id, t.kind),
    index('edges_conn_from').on(t.connector_id, t.from_type, t.from_id),
  ],
);

export const distributions = sqliteTable(
  'distributions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    connector_id: text('connector_id').notNull(),
    name: text('name').notNull(),
    ts: integer('ts').notNull(),
    kind: text('kind').notNull(),
    data: text('data', { mode: 'json' }).notNull(),
    attributes: text('attributes', { mode: 'json' })
      .notNull()
      .default(sql`'{}'`),
  },
  (t) => [index('distributions_conn_name_ts').on(t.connector_id, t.name, t.ts)],
);

export const DDL = [
  `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connector_id TEXT NOT NULL,
    name TEXT NOT NULL,
    start_ts INTEGER NOT NULL,
    end_ts INTEGER,
    attributes TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE INDEX IF NOT EXISTS events_conn_name_start ON events (connector_id, name, start_ts)`,
  `CREATE TABLE IF NOT EXISTS entities (
    connector_id TEXT NOT NULL,
    type TEXT NOT NULL,
    id TEXT NOT NULL,
    attributes TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (connector_id, type, id)
  )`,
  `CREATE INDEX IF NOT EXISTS entities_conn_type ON entities (connector_id, type)`,
  `CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connector_id TEXT NOT NULL,
    name TEXT NOT NULL,
    ts INTEGER NOT NULL,
    value REAL NOT NULL,
    attributes TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE INDEX IF NOT EXISTS metrics_conn_name_ts ON metrics (connector_id, name, ts)`,
  `CREATE TABLE IF NOT EXISTS edges (
    connector_id TEXT NOT NULL,
    from_type TEXT NOT NULL,
    from_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    to_type TEXT NOT NULL,
    to_id TEXT NOT NULL,
    attributes TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (connector_id, from_type, from_id, kind, to_type, to_id)
  )`,
  `CREATE INDEX IF NOT EXISTS edges_conn_kind ON edges (connector_id, kind)`,
  `CREATE INDEX IF NOT EXISTS edges_conn_from ON edges (connector_id, from_type, from_id)`,
  `CREATE TABLE IF NOT EXISTS distributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connector_id TEXT NOT NULL,
    name TEXT NOT NULL,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    data TEXT NOT NULL,
    attributes TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE INDEX IF NOT EXISTS distributions_conn_name_ts ON distributions (connector_id, name, ts)`,
];
