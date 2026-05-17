import type { ColumnType, Generated } from 'kysely';

type JsonText = ColumnType<string, string, string>;

export interface EventsTable {
  id: Generated<number>;
  connector_id: string;
  name: string;
  start_ts: number;
  end_ts: number | null;
  attributes: JsonText;
}

export interface EntitiesTable {
  connector_id: string;
  type: string;
  id: string;
  attributes: JsonText;
  updated_at: number;
}

export interface MetricsTable {
  id: Generated<number>;
  connector_id: string;
  name: string;
  ts: number;
  value: number;
  attributes: JsonText;
}

export interface EdgesTable {
  connector_id: string;
  from_type: string;
  from_id: string;
  kind: string;
  to_type: string;
  to_id: string;
  attributes: JsonText;
  updated_at: number;
}

export interface DistributionsTable {
  id: Generated<number>;
  connector_id: string;
  name: string;
  ts: number;
  kind: string;
  data: JsonText;
  attributes: JsonText;
}

export interface SyncStateTable {
  id: number;
  status: string;
  last_sync_at: string | null;
  last_error: string | null;
}

export interface SchemaMigrationsTable {
  version: number;
  tag: string;
  applied_at: number;
}

export interface Database {
  events: EventsTable;
  entities: EntitiesTable;
  metrics: MetricsTable;
  edges: EdgesTable;
  distributions: DistributionsTable;
  sync_state: SyncStateTable;
  schema_migrations: SchemaMigrationsTable;
}
