import {
  EnvSecretsResolver,
  type SecretRef,
  resolveSecretRefs,
} from './secrets';

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

export type Distribution =
  | {
      name: string;
      ts: number;
      kind: 'histogram';
      data: {
        buckets: Array<{ le: number; count: number }>;
        count: number;
        sum: number;
      };
      attributes: Record<string, JSONValue>;
    }
  | {
      name: string;
      ts: number;
      kind: 'summary';
      data: {
        quantiles: Array<{ q: number; value: number }>;
        count: number;
        sum: number;
      };
      attributes: Record<string, JSONValue>;
    };

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

  events(es: Event[], scope?: { names?: string[] }): Promise<void>;
  entities(es: Entity[], scope?: { types?: string[] }): Promise<void>;
  metrics(ms: Metric[], scope?: { names?: string[] }): Promise<void>;
  edges(es: Edge[], scope?: { kinds?: string[] }): Promise<void>;
  distributions(
    ds: Distribution[],
    scope?: { names?: string[] },
  ): Promise<void>;

  queryEvents(q: EventQuery): Promise<Event[]>;
  getEntity(type: string, id: string): Promise<Entity | null>;
  queryEntities(q: EntityQuery): Promise<Entity[]>;
  queryMetrics(q: MetricQuery): Promise<Metric[]>;
  traverse(q: EdgeQuery): Promise<Edge[]>;
  queryDistributions(q: DistributionQuery): Promise<Distribution[]>;

  // Deletes all rows in the given time-series shape whose timestamp column is
  // strictly less than `tsUnixMs`. Only covers append-only shapes (events,
  // metrics, distributions). Entities and edges are excluded because they hold
  // the latest known state per primary key — deleting by age would lose live
  // data. The right model for those shapes is "expire when source disappears."
  deleteOlderThan(
    shape: 'events' | 'metrics' | 'distributions',
    tsUnixMs: number,
  ): Promise<{ rowsDeleted: number }>;
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

export type InferCredentialInput<TCreds extends CredentialSchema> = {
  [K in keyof TCreds]: TCreds[K] extends { auth: 'required' }
    ? string | SecretRef
    : string | SecretRef | undefined;
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
  sync(
    request: SyncRequest,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<void>;
}

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
}

export abstract class BaseConnector<
  TSettings = unknown,
  TCreds extends CredentialSchema = CredentialSchema,
> implements Connector {
  abstract readonly id: string;
  readonly credentials?: TCreds;

  protected settings: TSettings;
  protected creds: InferCredentials<TCreds>;

  constructor(settings: TSettings, creds?: InferCredentialInput<TCreds>) {
    this.settings = settings;
    this.creds = creds
      ? (resolveSecretRefs(
          creds,
          new EnvSecretsResolver(),
        ) as InferCredentials<TCreds>)
      : ({} as InferCredentials<TCreds>);
  }

  protected sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(signal.reason ?? new Error('Aborted'));
    }
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal!.reason ?? new Error('Aborted'));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  protected async withRetry<T>(
    fn: (
      signal?: AbortSignal,
    ) => Promise<{ status: 'done'; value: T } | { status: 'retry' }>,
    options?: RetryOptions,
  ): Promise<T | null> {
    const {
      maxAttempts = 10,
      initialDelayMs = 1000,
      maxDelayMs = 10000,
      signal,
    } = options ?? {};

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      signal?.throwIfAborted();
      const result = await fn(signal);
      if (result.status === 'done') {
        return result.value;
      }
      if (attempt < maxAttempts - 1) {
        const delay = Math.min(initialDelayMs * 2 ** attempt, maxDelayMs);
        await this.sleep(delay, signal);
      }
    }

    return null;
  }

  abstract sync(
    request: SyncRequest,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<void>;
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
      signal?: AbortSignal,
    ) => Promise<void>;
  }): {
    new (settings: TSettings, creds?: InferCredentialInput<TCreds>): Connector;
    readonly id: string;
    readonly credentials: TCreds | undefined;
  } {
    class DynamicConnector extends BaseConnector<TSettings, TCreds> {
      static readonly id = def.id;
      static readonly credentials = def.credentials;

      readonly id = def.id;
      override readonly credentials = def.credentials;

      async sync(
        request: SyncRequest,
        storage: StorageHandle,
        signal?: AbortSignal,
      ): Promise<void> {
        return def.sync.call(
          { settings: this.settings, creds: this.creds },
          request,
          storage,
          signal,
        );
      }
    }

    return DynamicConnector as unknown as {
      new (
        settings: TSettings,
        creds?: InferCredentialInput<TCreds>,
      ): Connector;
      readonly id: string;
      readonly credentials: TCreds | undefined;
    };
  };
}
