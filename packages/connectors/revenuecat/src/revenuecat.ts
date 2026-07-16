import {
  type HttpResponse,
  connectorUserAgent,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
  type MetricSample,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
  defineConnectorDoc,
  defineResources,
  makeChunkedCursorGuard,
  paginateChunked,
  schemasFromResources,
  selectActivePhases,
} from '@rawdash/core';
import { z } from 'zod';

export const configFields = defineConfigFields(
  z.object({
    apiKey: z.object({ $secret: z.string() }).meta({
      label: 'Project API Key',
      description:
        'RevenueCat v2 REST API key (read-only). Create one in the RevenueCat dashboard under Project Settings -> API Keys -> Public app-specific or Secret API Key (V2).',
      placeholder: 'sk_...',
      secret: true,
    }),
    projectId: z.string().min(1).meta({
      label: 'Project ID',
      description:
        'RevenueCat project identifier. Find it in Project Settings -> General.',
      placeholder: 'proj1ab2cd3',
    }),
    resources: z
      .array(z.enum(['products', 'entitlements', 'customers', 'metrics']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which RevenueCat resources to sync. Omit to sync all. Customer syncs also emit each customer’s subscription entities, fetched from the per-customer subscriptions endpoint.',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'RevenueCat',
  category: 'finance',
  brandColor: '#F2545B',
  tagline:
    'Sync products, entitlements, customers, and subscriptions from RevenueCat alongside overview metrics (MRR, active subscribers, trial conversion).',
  vendor: {
    name: 'RevenueCat',
    domain: 'revenuecat.com',
    apiDocs: 'https://www.revenuecat.com/docs/api-v2',
    website: 'https://www.revenuecat.com',
  },
  auth: {
    summary:
      'Authenticates with a RevenueCat v2 REST API key scoped to a single project. The key only needs read access to the resources being synced.',
    setup: [
      'Open the RevenueCat dashboard -> Project Settings -> API Keys.',
      'Create a v2 Secret API key with read access; copy the key value.',
      'Copy the Project ID from Project Settings -> General.',
      'Store the API key as a secret and reference it from the connector config as `apiKey: secret("REVENUECAT_API_KEY")`. Set `projectId` to the project identifier.',
    ],
  },
  rateLimit:
    'RevenueCat applies per-domain rate limits and returns 429 with a Retry-After header on overrun; requests are retried with exponential backoff. List endpoints page via the `starting_after` cursor and return up to 100 items per page. Each customer’s active entitlements and subscriptions are fetched with a separate request per customer.',
  limitations: [
    'Monetary amounts (e.g. MRR) are emitted in the smallest currency unit reported by the upstream API (typically cents).',
    'The overview metrics resource emits a point-in-time snapshot per sync rather than a backfilled timeseries; query timeseries widgets group these by `metric` and aggregate over time.',
    'Subscriptions and active entitlements are not returned by the customers list endpoint; they are fetched per customer, so customer syncs make additional requests proportional to the customer count.',
    'RevenueCat does not expose a REST endpoint for listing subscription lifecycle events; those are delivered only via webhooks and are therefore not synced.',
  ],
});

export interface RevenueCatSettings {
  projectId: string;
  resources?: readonly RevenueCatResource[];
}

type RevenueCatListResponse<T> = {
  object: 'list';
  items: T[];
  next_page: string | null;
  url?: string;
};

interface RevenueCatProduct {
  id: string;
  store_identifier: string | null;
  type: string | null;
  app_id: string | null;
  display_name: string | null;
  created_at: number;
}

interface RevenueCatEntitlement {
  id: string;
  lookup_key: string;
  display_name: string | null;
  created_at: number;
  project_id?: string;
}

interface RevenueCatSubscription {
  id: string;
  product_id: string | null;
  store: string | null;
  status: string;
  starts_at: number | null;
  current_period_ends_at: number | null;
  gives_access: boolean | null;
  auto_renewal_status: string | null;
}

interface RevenueCatActiveEntitlement {
  entitlement_id: string;
  expires_at?: number | null;
}

interface RevenueCatCustomer {
  id: string;
  first_seen_at: number | null;
  last_seen_at: number | null;
}

interface RevenueCatOverviewMetric {
  id: string;
  name?: string;
  value: number;
  unit?: string | null;
}

interface RevenueCatOverviewResponse {
  object?: 'list';
  metrics?: RevenueCatOverviewMetric[];
  items?: RevenueCatOverviewMetric[];
}

const revenuecatCredentials = {
  apiKey: {
    description: 'RevenueCat v2 REST API key',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type RevenueCatCredentials = typeof revenuecatCredentials;

const PHASE_ORDER = [
  'products',
  'entitlements',
  'customers',
  'metrics',
] as const;

type RevenueCatPhase = (typeof PHASE_ORDER)[number];

export type RevenueCatResource = RevenueCatPhase;

const isRevenueCatSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const idString = z.string().min(1);

const productSchema = z.object({
  id: idString,
  store_identifier: z.string().nullable(),
  type: z.string().nullable(),
  app_id: z.string().nullable(),
  display_name: z.string().nullable(),
  created_at: z.number().int().nonnegative(),
});

const entitlementSchema = z.object({
  id: idString,
  lookup_key: z.string(),
  display_name: z.string().nullable(),
  created_at: z.number().int().nonnegative(),
  project_id: z.string().optional(),
});

const subscriptionSchema = z.object({
  id: idString,
  product_id: z.string().nullable(),
  store: z.string().nullable(),
  status: z.string(),
  starts_at: z.number().int().nullable(),
  current_period_ends_at: z.number().int().nullable(),
  gives_access: z.boolean().nullable(),
  auto_renewal_status: z.string().nullable(),
});

const customerSchema = z.object({
  id: idString,
  first_seen_at: z.number().int().nullable(),
  last_seen_at: z.number().int().nullable(),
});

const overviewMetricSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  value: z.number(),
  unit: z.string().nullable().optional(),
});

const overviewResponseSchema = z.object({
  object: z.literal('list').optional(),
  metrics: z.array(overviewMetricSchema).optional(),
  items: z.array(overviewMetricSchema).optional(),
});

export const revenuecatResources = defineResources({
  revenuecat_product: {
    shape: 'entity',
    filterable: [],
    description:
      'Products configured in RevenueCat, including their store identifier (App Store / Play Store SKU), type, and display name.',
    endpoint: 'GET /v2/projects/{project_id}/products',
    fields: [
      { name: 'storeIdentifier', description: 'Store-specific product SKU.' },
      {
        name: 'type',
        description: 'Product type (subscription, non_consumable, ...).',
      },
      {
        name: 'appId',
        description: 'RevenueCat app id the product belongs to.',
      },
      { name: 'displayName', description: 'Human-readable product name.' },
      {
        name: 'createdAt',
        description: 'Unix seconds when the product was created.',
      },
    ],
    responses: { products: z.array(productSchema) },
  },
  revenuecat_entitlement: {
    shape: 'entity',
    filterable: [],
    description:
      'Entitlements (logical features) configured in the project, keyed by lookup_key.',
    endpoint: 'GET /v2/projects/{project_id}/entitlements',
    fields: [
      {
        name: 'lookupKey',
        description: 'Stable lookup key used by client SDKs.',
      },
      { name: 'displayName', description: 'Human-readable entitlement name.' },
      {
        name: 'createdAt',
        description: 'Unix seconds when the entitlement was created.',
      },
    ],
    responses: { entitlements: z.array(entitlementSchema) },
  },
  revenuecat_customer: {
    shape: 'entity',
    filterable: [],
    description:
      'RevenueCat customers (app users) with first-seen / last-seen timestamps and a list of currently active entitlement ids.',
    endpoint: 'GET /v2/projects/{project_id}/customers',
    notes:
      'The customers list returns only base fields; each customer’s active entitlements are fetched from GET /v2/projects/{project_id}/customers/{customer_id}/active_entitlements, and its subscriptions are written separately as `revenuecat_subscription` entities.',
    fields: [
      {
        name: 'firstSeenAt',
        description: 'Unix seconds the customer was first seen.',
      },
      {
        name: 'lastSeenAt',
        description: 'Unix seconds of the most recent activity.',
      },
      {
        name: 'activeEntitlements',
        description:
          'Array of entitlement_id strings currently granting access.',
      },
    ],
    responses: { customers: z.array(customerSchema) },
  },
  revenuecat_subscription: {
    shape: 'entity',
    filterable: [],
    description:
      'Subscriptions, one row per (customer, subscription). Fetched from each customer’s subscriptions collection.',
    endpoint:
      'GET /v2/projects/{project_id}/customers/{customer_id}/subscriptions',
    fields: [
      { name: 'customerId', description: 'RevenueCat customer (app user) id.' },
      { name: 'productId', description: 'Product the subscription is for.' },
      {
        name: 'store',
        description: 'Originating store (app_store, play_store, ...).',
      },
      {
        name: 'status',
        description: 'Subscription status (active, expired, refunded, ...).',
      },
      {
        name: 'startsAt',
        description: 'Unix seconds the subscription started.',
      },
      {
        name: 'currentPeriodEndsAt',
        description: 'Unix seconds the current paid period ends.',
      },
      {
        name: 'givesAccess',
        description: 'Whether the subscription currently grants access.',
      },
      {
        name: 'autoRenewalStatus',
        description:
          'Auto-renew status reported by the store (will_renew, will_not_renew, ...).',
      },
    ],
    responses: { subscriptions: z.array(subscriptionSchema) },
  },
  revenuecat_metric_snapshot: {
    shape: 'metric',
    description:
      'Point-in-time snapshot of RevenueCat overview metrics (MRR, active subscriptions, active trials, trial conversion rate, etc.). Each metric is emitted as one sample per sync, tagged with the metric id under the `metric` dimension.',
    endpoint: 'GET /v2/projects/{project_id}/metrics/overview',
    granularity: 'minute',
    notes:
      'The unit varies by metric id (currency minor units for revenue metrics, count for subscriber metrics, ratio for conversion metrics) and is recorded in the `unit` dimension.',
    dimensions: [
      {
        name: 'metric',
        description:
          'Overview metric identifier returned by RevenueCat (e.g. mrr, active_subscriptions, active_trials, trial_conversion_rate).',
      },
      {
        name: 'unit',
        description: 'Upstream-declared unit for the metric value, if present.',
      },
    ],
    responses: { metrics: overviewResponseSchema },
  },
});

export const id = 'revenuecat';

const BASE_URL = 'https://api.revenuecat.com';
const PAGE_LIMIT = 100;

function toMs(epochSecOrMs: number): number {
  return epochSecOrMs > 1_000_000_000_000 ? epochSecOrMs : epochSecOrMs * 1000;
}

function nullableSeconds(value: number | null): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return value;
}

function nextCursor(nextPage: string | null | undefined): string | null {
  if (!nextPage) {
    return null;
  }
  const qIndex = nextPage.indexOf('?');
  if (qIndex === -1) {
    return null;
  }
  return new URLSearchParams(nextPage.slice(qIndex + 1)).get('starting_after');
}

export class RevenueCatConnector extends BaseConnector<
  RevenueCatSettings,
  RevenueCatCredentials
> {
  static readonly id = id;

  static readonly resources = revenuecatResources;

  static readonly schemas = schemasFromResources(revenuecatResources);

  static create(input: unknown, ctx?: ConnectorContext): RevenueCatConnector {
    const parsed = configFields.parse(input);
    return new RevenueCatConnector(
      { projectId: parsed.projectId, resources: parsed.resources },
      { apiKey: parsed.apiKey },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = revenuecatCredentials;

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.creds.apiKey}`,
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('revenuecat'),
    };
  }

  private fetchUrl<T>(
    url: string,
    resource: string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.get<T>(url, {
      resource,
      headers: this.buildHeaders(),
      signal,
    });
  }

  private buildListUrl(
    path: string,
    page: string | null,
    extra: Record<string, string | undefined> = {},
  ): string {
    const url = new URL(`${BASE_URL}${path}`);
    url.searchParams.set('limit', String(PAGE_LIMIT));
    if (page) {
      url.searchParams.set('starting_after', page);
    }
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  private projectPath(): string {
    return `/v2/projects/${encodeURIComponent(this.settings.projectId)}`;
  }

  private buildPhaseUrl(phase: RevenueCatPhase, page: string | null): string {
    const projectPath = this.projectPath();
    switch (phase) {
      case 'products':
        return this.buildListUrl(`${projectPath}/products`, page);
      case 'entitlements':
        return this.buildListUrl(`${projectPath}/entitlements`, page);
      case 'customers':
        return this.buildListUrl(`${projectPath}/customers`, page);
      case 'metrics':
        return `${BASE_URL}${projectPath}/metrics/overview`;
    }
  }

  private async listAll<T>(
    path: string,
    resource: string,
    signal?: AbortSignal,
  ): Promise<T[]> {
    const collected: T[] = [];
    let page: string | null = null;
    while (true) {
      const url = this.buildListUrl(path, page);
      const res = await this.fetchUrl<RevenueCatListResponse<T>>(
        url,
        resource,
        signal,
      );
      const items = res.body.items ?? [];
      collected.push(...items);
      const next = items.length > 0 ? nextCursor(res.body.next_page) : null;
      if (next === null) {
        break;
      }
      page = next;
    }
    return collected;
  }

  private async clearScopeOnFirstPage(
    storage: StorageHandle,
    phase: RevenueCatPhase,
  ): Promise<void> {
    switch (phase) {
      case 'products':
        await storage.entities([], { types: ['revenuecat_product'] });
        return;
      case 'entitlements':
        await storage.entities([], { types: ['revenuecat_entitlement'] });
        return;
      case 'customers':
        await storage.entities([], {
          types: ['revenuecat_customer', 'revenuecat_subscription'],
        });
        return;
      case 'metrics':
        return;
    }
  }

  private async writeCustomers(
    storage: StorageHandle,
    customers: RevenueCatCustomer[],
    signal?: AbortSignal,
  ): Promise<void> {
    const projectPath = this.projectPath();
    for (const c of customers) {
      const customerPath = `${projectPath}/customers/${encodeURIComponent(c.id)}`;
      const activeEntitlements =
        await this.listAll<RevenueCatActiveEntitlement>(
          `${customerPath}/active_entitlements`,
          'customers',
          signal,
        );
      const lastSeen = c.last_seen_at ?? c.first_seen_at ?? 0;
      await storage.entity({
        type: 'revenuecat_customer',
        id: c.id,
        attributes: {
          firstSeenAt: nullableSeconds(c.first_seen_at),
          lastSeenAt: nullableSeconds(c.last_seen_at),
          activeEntitlements: activeEntitlements.map((e) => e.entitlement_id),
        },
        updated_at: toMs(lastSeen),
      });
      const subscriptions = await this.listAll<RevenueCatSubscription>(
        `${customerPath}/subscriptions`,
        'customers',
        signal,
      );
      for (const s of subscriptions) {
        const updatedAt = s.current_period_ends_at ?? s.starts_at ?? lastSeen;
        await storage.entity({
          type: 'revenuecat_subscription',
          id: s.id,
          attributes: {
            customerId: c.id,
            productId: s.product_id ?? null,
            store: s.store ?? null,
            status: s.status,
            startsAt: s.starts_at ?? null,
            currentPeriodEndsAt: s.current_period_ends_at ?? null,
            givesAccess: s.gives_access ?? null,
            autoRenewalStatus: s.auto_renewal_status ?? null,
          },
          updated_at: toMs(updatedAt),
        });
      }
    }
  }

  private async writePhase(
    storage: StorageHandle,
    phase: RevenueCatPhase,
    items: unknown[],
    signal?: AbortSignal,
  ): Promise<void> {
    switch (phase) {
      case 'products':
        for (const p of items as RevenueCatProduct[]) {
          await storage.entity({
            type: 'revenuecat_product',
            id: p.id,
            attributes: {
              storeIdentifier: p.store_identifier ?? null,
              type: p.type ?? null,
              appId: p.app_id ?? null,
              displayName: p.display_name ?? null,
              createdAt: nullableSeconds(p.created_at),
            },
            updated_at: toMs(p.created_at),
          });
        }
        return;
      case 'entitlements':
        for (const e of items as RevenueCatEntitlement[]) {
          await storage.entity({
            type: 'revenuecat_entitlement',
            id: e.id,
            attributes: {
              lookupKey: e.lookup_key,
              displayName: e.display_name ?? null,
              createdAt: nullableSeconds(e.created_at),
            },
            updated_at: toMs(e.created_at),
          });
        }
        return;
      case 'customers':
        await this.writeCustomers(
          storage,
          items as RevenueCatCustomer[],
          signal,
        );
        return;
      case 'metrics': {
        const samples: MetricSample[] = [];
        const ts = Date.now();
        for (const item of items as RevenueCatOverviewMetric[]) {
          samples.push({
            name: 'revenuecat_metric_snapshot',
            ts,
            value: item.value,
            attributes: {
              metric: item.id,
              unit: item.unit ?? null,
            },
          });
        }
        await storage.metrics(samples, {
          names: ['revenuecat_metric_snapshot'],
        });
        return;
      }
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = isRevenueCatSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';

    const phases = selectActivePhases<RevenueCatResource, RevenueCatPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<RevenueCatPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        const url = this.buildPhaseUrl(phase, page);
        if (phase === 'metrics') {
          const res = await this.fetchUrl<RevenueCatOverviewResponse>(
            url,
            phase,
            sig,
          );
          const items = res.body.metrics ?? res.body.items ?? [];
          return { items, next: null };
        }
        const res = await this.fetchUrl<RevenueCatListResponse<{ id: string }>>(
          url,
          phase,
          sig,
        );
        const items = res.body.items ?? [];
        const next = items.length > 0 ? nextCursor(res.body.next_page) : null;
        return { items, next };
      },
      writeBatch: async (phase, items, page) => {
        if (isFull && page === null) {
          await this.clearScopeOnFirstPage(storage, phase);
        }
        await this.writePhase(storage, phase, items, signal);
      },
    });
  }
}
