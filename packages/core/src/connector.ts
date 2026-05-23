import {
  type HttpRequest,
  type HttpResponse,
  type RequestObserver,
  request as sharedRequest,
} from '@rawdash/connector-shared';

import {
  EnvSecretsResolver,
  type Secret,
  type SecretsResolver,
  resolveSecrets,
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

export interface MetricSample {
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
  metric(m: MetricSample): Promise<void>;
  edge(e: Edge): Promise<void>;
  distribution(d: Distribution): Promise<void>;

  events(es: Event[], scope?: { names?: string[] }): Promise<void>;
  entities(es: Entity[], scope?: { types?: string[] }): Promise<void>;
  metrics(ms: MetricSample[], scope?: { names?: string[] }): Promise<void>;
  edges(es: Edge[], scope?: { kinds?: string[] }): Promise<void>;
  distributions(
    ds: Distribution[],
    scope?: { names?: string[] },
  ): Promise<void>;

  queryEvents(q: EventQuery): Promise<Event[]>;
  getEntity(type: string, id: string): Promise<Entity | null>;
  queryEntities(q: EntityQuery): Promise<Entity[]>;
  queryMetrics(q: MetricQuery): Promise<MetricSample[]>;
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

  getHealth?(): Promise<ConnectorHealth | null>;
}

export interface ConnectorHealth {
  status: 'idle' | 'syncing' | 'error' | 'auth_failed' | 'paused';
  lastSyncAt: string | null;
  lastError: string | null;
  syncIntervalSeconds: number;
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export interface CredentialField {
  description: string;
  auth?: 'none' | 'optional' | 'required';
}

export type CredentialsSchema = Record<string, CredentialField>;

export type InferCredentials<TCreds extends CredentialsSchema> = {
  [K in keyof TCreds]: TCreds[K] extends { auth: 'required' }
    ? string
    : string | undefined;
};

export type InferCredentialInput<TCreds extends CredentialsSchema> = {
  [K in keyof TCreds]: TCreds[K] extends { auth: 'required' }
    ? string | Secret
    : string | Secret | undefined;
};

// ---------------------------------------------------------------------------
// Sync + Connector
// ---------------------------------------------------------------------------

export interface SyncOptions {
  mode: 'full' | 'latest';
  since?: string;
  cursor?: unknown;
}

export interface SyncResult {
  done: boolean;
  cursor?: unknown;
  transientError?: unknown;
}

export interface Connector {
  readonly id: string;
  readonly credentials?: CredentialsSchema;
  serializeConfig(): Record<string, unknown>;
  sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult>;
}

export interface ConnectorContext {
  observer?: RequestObserver;
  secretsResolver?: SecretsResolver;
}

export interface ConnectorRequestOptions {
  resource: string;
  requestId?: string;
}

export interface RetryPolicy {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
}

export abstract class BaseConnector<
  TSettings = unknown,
  TCreds extends CredentialsSchema = CredentialsSchema,
> implements Connector {
  abstract readonly id: string;
  readonly credentials?: TCreds;

  protected settings: TSettings;
  protected creds: InferCredentials<TCreds>;
  private rawCredInput: InferCredentialInput<TCreds> | undefined;
  private ctx: ConnectorContext;

  constructor(
    settings: TSettings,
    creds?: InferCredentialInput<TCreds>,
    ctx?: ConnectorContext,
  ) {
    this.settings = settings;
    this.rawCredInput = creds;
    this.ctx = ctx ?? {};
    this.creds = creds
      ? (resolveSecrets(
          creds,
          this.ctx.secretsResolver ?? new EnvSecretsResolver(),
        ) as InferCredentials<TCreds>)
      : ({} as InferCredentials<TCreds>);
  }

  protected request<T = unknown>(
    req: HttpRequest,
    opts: ConnectorRequestOptions,
  ): Promise<HttpResponse<T>> {
    return sharedRequest<T>(req, {
      resource: opts.resource,
      requestId: opts.requestId,
      observer: this.ctx.observer,
    });
  }

  protected get<T = unknown>(
    url: string,
    opts: ConnectorRequestOptions & {
      headers?: Record<string, string>;
      signal?: AbortSignal;
      rateLimit?: HttpRequest['rateLimit'];
    },
  ): Promise<HttpResponse<T>> {
    return this.request<T>(
      {
        url,
        method: 'GET',
        headers: opts.headers,
        signal: opts.signal,
        rateLimit: opts.rateLimit,
      },
      { resource: opts.resource, requestId: opts.requestId },
    );
  }

  protected post<T = unknown>(
    url: string,
    opts: ConnectorRequestOptions & {
      body?: HttpRequest['body'];
      headers?: Record<string, string>;
      signal?: AbortSignal;
      rateLimit?: HttpRequest['rateLimit'];
    },
  ): Promise<HttpResponse<T>> {
    return this.request<T>(
      {
        url,
        method: 'POST',
        headers: opts.headers,
        body: opts.body,
        signal: opts.signal,
        rateLimit: opts.rateLimit,
      },
      { resource: opts.resource, requestId: opts.requestId },
    );
  }

  protected isResourceEnabled<R extends string>(resource: R): boolean {
    const enabled = (this.settings as { resources?: readonly R[] } | null)
      ?.resources;
    if (!enabled || enabled.length === 0) {
      return true;
    }
    return enabled.includes(resource);
  }

  serializeConfig(): Record<string, unknown> {
    const config: Record<string, unknown> = {
      ...(this.settings as Record<string, unknown>),
    };
    if (this.rawCredInput) {
      for (const [key, value] of Object.entries(
        this.rawCredInput as Record<string, unknown>,
      )) {
        if (value !== undefined) {
          config[key] = value;
        }
      }
    }
    return config;
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
    options?: RetryPolicy,
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
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult>;
}

export function defineConnector<TSettings>() {
  return function <
    TCreds extends CredentialsSchema = Record<string, never>,
  >(def: {
    id: string;
    credentials?: TCreds;
    sync: (
      this: { settings: TSettings; creds: InferCredentials<TCreds> },
      options: SyncOptions,
      storage: StorageHandle,
      signal?: AbortSignal,
    ) => Promise<SyncResult>;
  }): {
    new (
      settings: TSettings,
      creds?: InferCredentialInput<TCreds>,
      ctx?: ConnectorContext,
    ): Connector;
    readonly id: string;
    readonly credentials: TCreds | undefined;
  } {
    class DynamicConnector extends BaseConnector<TSettings, TCreds> {
      static readonly id = def.id;
      static readonly credentials = def.credentials;

      readonly id = def.id;
      override readonly credentials = def.credentials;

      async sync(
        options: SyncOptions,
        storage: StorageHandle,
        signal?: AbortSignal,
      ): Promise<SyncResult> {
        return def.sync.call(
          { settings: this.settings, creds: this.creds },
          options,
          storage,
          signal,
        );
      }
    }

    return DynamicConnector as unknown as {
      new (
        settings: TSettings,
        creds?: InferCredentialInput<TCreds>,
        ctx?: ConnectorContext,
      ): Connector;
      readonly id: string;
      readonly credentials: TCreds | undefined;
    };
  };
}
