export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };

// ---------------------------------------------------------------------------
// Five storage shapes
// ---------------------------------------------------------------------------

export interface Event {
  name: string;
  start_ts: number;
  end_ts: number | null;
  attributes: Record<string, JSONValue>;
}

export interface Entity {
  type: string;
  id: string;
  attributes: Record<string, JSONValue>;
  updated_at: number;
}

export interface Metric {
  name: string;
  ts: number;
  value: number;
  attributes: Record<string, JSONValue>;
}

export interface Edge {
  from_type: string;
  from_id: string;
  kind: string;
  to_type: string;
  to_id: string;
  attributes: Record<string, JSONValue>;
  updated_at: number;
}

export interface Distribution {
  name: string;
  ts: number;
  kind: 'histogram' | 'summary';
  data:
    | {
        buckets: Array<{ le: number; count: number }>;
        count: number;
        sum: number;
      }
    | {
        quantiles: Array<{ q: number; value: number }>;
        count: number;
        sum: number;
      };
  attributes: Record<string, JSONValue>;
}

// ---------------------------------------------------------------------------
// Storage query types
// ---------------------------------------------------------------------------

export interface EventQuery {
  name?: string;
  start?: number;
  end?: number;
}

export interface EntityQuery {
  type: string;
}

export interface MetricQuery {
  name?: string;
  start?: number;
  end?: number;
}

export interface EdgeQuery {
  fromType?: string;
  fromId?: string;
  kind?: string;
  toType?: string;
  toId?: string;
}

export interface DistributionQuery {
  name?: string;
  start?: number;
  end?: number;
}

// ---------------------------------------------------------------------------
// StorageHandle — write and read surface
// ---------------------------------------------------------------------------

export interface StorageHandle {
  event(e: Event): Promise<void>;
  entity(e: Entity): Promise<void>;
  metric(m: Metric): Promise<void>;
  edge(e: Edge): Promise<void>;
  distribution(d: Distribution): Promise<void>;

  events(es: Event[]): Promise<void>;
  entities(es: Entity[]): Promise<void>;
  metrics(ms: Metric[]): Promise<void>;
  edges(es: Edge[]): Promise<void>;
  distributions(ds: Distribution[]): Promise<void>;

  queryEvents(q: EventQuery): Promise<Event[]>;
  getEntity(type: string, id: string): Promise<Entity | null>;
  queryEntities(q: EntityQuery): Promise<Entity[]>;
  queryMetrics(q: MetricQuery): Promise<Metric[]>;
  traverse(q: EdgeQuery): Promise<Edge[]>;
  queryDistributions(q: DistributionQuery): Promise<Distribution[]>;
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export interface CredentialEntry {
  description: string;
  auth?: 'none' | 'optional' | 'required';
}

export type CredentialSchema = Record<string, CredentialEntry>;

export type InferCredentials<TCreds extends CredentialSchema> = {
  [K in keyof TCreds]: TCreds[K] extends { auth: 'required' }
    ? string
    : string | undefined;
};

// ---------------------------------------------------------------------------
// Sync + Connector
// ---------------------------------------------------------------------------

export interface SyncRequest {
  mode: 'full' | 'latest';
  since?: string;
}

export interface Connector {
  readonly id: string;
  readonly credentials?: CredentialSchema;
  sync(request: SyncRequest, storage: StorageHandle): Promise<void>;
}

export abstract class BaseConnector<
  TSettings = unknown,
  TCreds extends CredentialSchema = CredentialSchema,
> implements Connector {
  abstract readonly id: string;
  readonly credentials?: TCreds;

  protected settings: TSettings;
  protected creds: InferCredentials<TCreds>;

  constructor(settings: TSettings, creds?: InferCredentials<TCreds>) {
    this.settings = settings;
    this.creds = creds ?? ({} as InferCredentials<TCreds>);
  }

  abstract sync(request: SyncRequest, storage: StorageHandle): Promise<void>;
}

export function defineConnector<TSettings>() {
  return function <
    TCreds extends CredentialSchema = Record<string, never>,
  >(def: {
    id: string;
    credentials?: TCreds;
    sync: (
      this: { settings: TSettings; creds: InferCredentials<TCreds> },
      request: SyncRequest,
      storage: StorageHandle,
    ) => Promise<void>;
  }): {
    new (settings: TSettings, creds?: InferCredentials<TCreds>): Connector;
    readonly id: string;
    readonly credentials: TCreds | undefined;
  } {
    class DynamicConnector extends BaseConnector<TSettings, TCreds> {
      static readonly id = def.id;
      static readonly credentials = def.credentials;

      readonly id = def.id;
      override readonly credentials = def.credentials;

      async sync(request: SyncRequest, storage: StorageHandle): Promise<void> {
        return def.sync.call(
          { settings: this.settings, creds: this.creds },
          request,
          storage,
        );
      }
    }

    return DynamicConnector as unknown as {
      new (settings: TSettings, creds?: InferCredentials<TCreds>): Connector;
      readonly id: string;
      readonly credentials: TCreds | undefined;
    };
  };
}
