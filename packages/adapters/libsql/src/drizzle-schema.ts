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

export const syncState = sqliteTable('sync_state', {
  id: integer('id').primaryKey(),
  status: text('status').notNull(),
  last_sync_at: text('last_sync_at'),
  last_error: text('last_error'),
});

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
