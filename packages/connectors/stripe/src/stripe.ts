import {
  type HttpResponse,
  connectorUserAgent,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
  type FetchSpec,
  type FilterClause,
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
      label: 'API Key',
      description:
        'Stripe Restricted API key with read-only access. Create one at Dashboard → Developers → API keys.',
      placeholder: 'rk_live_...',
      secret: true,
    }),
    accountId: z.string().optional().meta({
      label: 'Account ID (optional)',
      description:
        'Stripe Connect account ID. Only needed if you are a platform accessing a connected account.',
      placeholder: 'acct_...',
    }),
    resources: z
      .array(
        z.enum([
          'customers',
          'products',
          'prices',
          'subscriptions',
          'invoices',
          'charges',
          'payment_intents',
          'disputes',
          'refunds',
        ]),
      )
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Stripe resources to sync. Omit to sync all resources. The API key only needs Read scope for the resources listed here.',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Stripe',
  category: 'finance',
  brandColor: '#635BFF',
  tagline:
    'Sync customers, products, prices, subscriptions, and invoices alongside charge, payment, dispute, and refund events from your Stripe account.',
  vendor: {
    name: 'Stripe',
    domain: 'stripe.com',
    apiDocs: 'https://stripe.com/docs/api',
    website: 'https://stripe.com',
  },
  auth: {
    summary:
      'Authenticates with a Stripe restricted API key that has read-only access to the resources you want to sync.',
    setup: [
      'Open the Stripe Dashboard → Developers → API keys.',
      'Create a restricted key with Read access for the resources you plan to sync (customers, products, prices, subscriptions, invoices, charges, payment intents, disputes, refunds).',
      'Store the key as a secret and reference it from the connector config as `apiKey: secret("STRIPE_API_KEY")`.',
    ],
  },
  rateLimit:
    'Stripe 429 responses carry a Retry-After header; requests are retried with exponential backoff. List pagination uses the starting_after cursor (limit 100).',
  limitations: [
    'Monetary amounts are stored in the smallest currency unit (e.g. cents), matching the Stripe API.',
    'The set of synced resources is controlled by the `resources` config field; omit it to sync all of them.',
    'Incremental syncs use a 7-day lookback for entities and created[gt] for events.',
  ],
});

export interface StripeSettings {
  accountId?: string;
  resources?: readonly StripeResource[];
}

interface StripeListResponse<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
  url: string;
}

interface StripeCustomer {
  id: string;
  email: string | null;
  name: string | null;
  created: number;
  currency: string | null;
  delinquent: boolean | null;
  livemode: boolean;
}

interface StripePriceRecurring {
  interval: 'day' | 'week' | 'month' | 'year';
  interval_count: number;
}

interface StripePrice {
  id: string;
  product: string;
  unit_amount: number | null;
  currency: string;
  recurring: StripePriceRecurring | null;
  active: boolean;
  created: number;
}

interface StripeSubscriptionItem {
  price: StripePrice;
  quantity: number | null;
}

interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  items: { data: StripeSubscriptionItem[] };
  current_period_start: number;
  current_period_end: number;
  cancel_at_period_end: boolean;
  canceled_at: number | null;
  trial_end: number | null;
  currency: string;
  created: number;
}

interface StripeInvoice {
  id: string;
  customer: string | null;
  subscription: string | null;
  status: string | null;
  amount_due: number;
  amount_paid: number;
  currency: string;
  created: number;
  due_date: number | null;
  hosted_invoice_url: string | null;
}

interface StripeCharge {
  id: string;
  customer: string | null;
  amount: number;
  currency: string;
  status: string;
  failure_code: string | null;
  created: number;
  payment_intent: string | null;
}

interface StripePaymentIntent {
  id: string;
  customer: string | null;
  amount: number;
  currency: string;
  status: string;
  created: number;
}

interface StripeProduct {
  id: string;
  name: string;
  active: boolean;
  created: number;
}

interface StripeDispute {
  id: string;
  charge: string;
  amount: number;
  currency: string;
  reason: string;
  status: string;
  created: number;
}

interface StripeRefund {
  id: string;
  charge: string | null;
  amount: number;
  currency: string;
  reason: string | null;
  status: string | null;
  created: number;
}

const stripeCredentials = {
  apiKey: {
    description: 'Stripe API key',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type StripeCredentials = typeof stripeCredentials;

const PHASE_ORDER = [
  'customers',
  'products',
  'prices',
  'subscriptions',
  'invoices',
  'charges',
  'payment_intents',
  'disputes',
  'refunds',
] as const;

type StripePhase = (typeof PHASE_ORDER)[number];

export type StripeResource = StripePhase;

const isStripeSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const ENTITY_TYPE_BY_PHASE: Partial<Record<StripePhase, string>> = {
  customers: 'stripe_customer',
  products: 'stripe_product',
  prices: 'stripe_price',
  subscriptions: 'stripe_subscription',
  invoices: 'stripe_invoice',
};

const EVENT_NAME_BY_PHASE: Partial<Record<StripePhase, string>> = {
  charges: 'stripe_charge',
  payment_intents: 'stripe_payment_intent',
  disputes: 'stripe_dispute',
  refunds: 'stripe_refund',
};

function pushableEq(
  filter: FilterClause[] | undefined,
  field: string,
): string | null {
  if (!filter) {
    return null;
  }
  for (const clause of filter) {
    if (
      'field' in clause &&
      clause.field === field &&
      clause.op === 'eq' &&
      typeof clause.value === 'string'
    ) {
      return clause.value;
    }
  }
  return null;
}

export function computeMrrAmountCents(
  subscription: StripeSubscription,
): number | null {
  let sum = 0;
  let counted = 0;
  for (const item of subscription.items.data) {
    const { unit_amount, recurring } = item.price;
    if (unit_amount === null || unit_amount === undefined || !recurring) {
      continue;
    }
    const quantity = item.quantity ?? 1;
    const total = unit_amount * quantity;
    const intervalCount = recurring.interval_count || 1;
    let monthly: number | null;
    switch (recurring.interval) {
      case 'month':
        monthly = total / intervalCount;
        break;
      case 'year':
        monthly = total / (12 * intervalCount);
        break;
      case 'week':
        monthly = (total * 52) / (12 * intervalCount);
        break;
      case 'day':
        monthly = (total * 365) / (12 * intervalCount);
        break;
      default:
        monthly = null;
    }
    if (monthly === null) {
      continue;
    }
    sum += monthly;
    counted++;
  }
  if (counted === 0) {
    return null;
  }
  return Math.round(sum);
}

const idString = z.string().min(1);

const customerSchema = z.object({
  id: idString,
  email: z.string().nullable(),
  name: z.string().nullable(),
  created: z.number().int().nonnegative(),
  currency: z.string().nullable(),
  delinquent: z.boolean().nullable(),
  livemode: z.boolean(),
});

const productSchema = z.object({
  id: idString,
  name: z.string(),
  active: z.boolean(),
  created: z.number().int().nonnegative(),
});

const priceSchema = z.object({
  id: idString,
  product: idString,
  unit_amount: z.number().int().nullable(),
  currency: z.string(),
  recurring: z
    .object({
      interval: z.enum(['day', 'week', 'month', 'year']),
      interval_count: z.number().int().positive(),
    })
    .nullable(),
  active: z.boolean(),
  created: z.number().int().nonnegative(),
});

const subscriptionSchema = z.object({
  id: idString,
  customer: idString,
  status: z.string(),
  items: z.object({
    data: z.array(
      z.object({
        price: priceSchema,
        quantity: z.number().int().nullable(),
      }),
    ),
  }),
  current_period_start: z.number().int().nonnegative(),
  current_period_end: z.number().int().nonnegative(),
  cancel_at_period_end: z.boolean(),
  canceled_at: z.number().int().nullable(),
  trial_end: z.number().int().nullable(),
  currency: z.string(),
  created: z.number().int().nonnegative(),
});

const invoiceSchema = z.object({
  id: idString,
  customer: idString.nullable(),
  subscription: idString.nullable(),
  status: z.string().nullable(),
  amount_due: z.number().int(),
  amount_paid: z.number().int(),
  currency: z.string(),
  created: z.number().int().nonnegative(),
  due_date: z.number().int().nullable(),
  hosted_invoice_url: z.string().nullable(),
});

const chargeSchema = z.object({
  id: idString,
  customer: idString.nullable(),
  amount: z.number().int(),
  currency: z.string(),
  status: z.string(),
  failure_code: z.string().nullable(),
  created: z.number().int().nonnegative(),
  payment_intent: idString.nullable(),
});

const paymentIntentSchema = z.object({
  id: idString,
  customer: idString.nullable(),
  amount: z.number().int(),
  currency: z.string(),
  status: z.string(),
  created: z.number().int().nonnegative(),
});

const disputeSchema = z.object({
  id: idString,
  charge: idString,
  amount: z.number().int(),
  currency: z.string(),
  reason: z.string(),
  status: z.string(),
  created: z.number().int().nonnegative(),
});

const refundSchema = z.object({
  id: idString,
  charge: idString.nullable(),
  amount: z.number().int(),
  currency: z.string(),
  reason: z.string().nullable(),
  status: z.string().nullable(),
  created: z.number().int().nonnegative(),
});

export const stripeResources = defineResources({
  stripe_customer: {
    shape: 'entity',
    filterable: [],
    description:
      'Customers with email, name, default currency, and delinquency state.',
    endpoint: 'GET /v1/customers',
    responses: { customers: z.array(customerSchema) },
  },
  stripe_product: {
    shape: 'entity',
    filterable: [{ field: 'active', ops: ['eq'], values: ['true', 'false'] }],
    description: 'Products in your catalog, including active state.',
    endpoint: 'GET /v1/products',
    responses: { products: z.array(productSchema) },
  },
  stripe_price: {
    shape: 'entity',
    filterable: [{ field: 'active', ops: ['eq'], values: ['true', 'false'] }],
    description:
      'Prices with unit amount, currency, and recurring interval, linked to their product.',
    endpoint: 'GET /v1/prices',
    responses: { prices: z.array(priceSchema) },
  },
  stripe_subscription: {
    shape: 'entity',
    filterable: [
      {
        field: 'status',
        ops: ['eq'],
        values: [
          'active',
          'past_due',
          'unpaid',
          'canceled',
          'incomplete',
          'incomplete_expired',
          'trialing',
          'paused',
        ],
      },
    ],
    description:
      'Subscriptions with status, current period, cancellation state, and computed monthly recurring revenue (mrrAmount, in the smallest currency unit).',
    endpoint: 'GET /v1/subscriptions',
    notes:
      'mrrAmount is computed as unit_amount x quantity, normalized to a monthly cadence (yearly / 12, weekly x 52 / 12, etc.).',
    responses: { subscriptions: z.array(subscriptionSchema) },
  },
  stripe_invoice: {
    shape: 'entity',
    filterable: [
      {
        field: 'status',
        ops: ['eq'],
        values: ['draft', 'open', 'paid', 'uncollectible', 'void'],
      },
    ],
    description:
      'Invoices with amount due, amount paid, status, and due date, linked to their customer and subscription.',
    endpoint: 'GET /v1/invoices',
    responses: { invoices: z.array(invoiceSchema) },
  },
  stripe_charge: {
    shape: 'event',
    filterable: [],
    description:
      'Charge attempts with amount, currency, status, and failure code, timestamped at creation.',
    endpoint: 'GET /v1/charges',
    responses: { charges: z.array(chargeSchema) },
  },
  stripe_payment_intent: {
    shape: 'event',
    filterable: [],
    description:
      'Payment intents with amount, currency, and status, timestamped at creation.',
    endpoint: 'GET /v1/payment_intents',
    responses: { payment_intents: z.array(paymentIntentSchema) },
  },
  stripe_dispute: {
    shape: 'event',
    filterable: [],
    description:
      'Disputes with amount, currency, reason, and status, linked to the disputed charge.',
    endpoint: 'GET /v1/disputes',
    responses: { disputes: z.array(disputeSchema) },
  },
  stripe_refund: {
    shape: 'event',
    filterable: [],
    description:
      'Refunds with amount, currency, reason, and status, linked to the refunded charge.',
    endpoint: 'GET /v1/refunds',
    responses: { refunds: z.array(refundSchema) },
  },
});

export const id = 'stripe';

export class StripeConnector extends BaseConnector<
  StripeSettings,
  StripeCredentials
> {
  static readonly id = id;

  static readonly resources = stripeResources;

  static readonly schemas = schemasFromResources(stripeResources);

  static create(input: unknown, ctx?: ConnectorContext): StripeConnector {
    const parsed = configFields.parse(input);
    return new StripeConnector(
      { accountId: parsed.accountId, resources: parsed.resources },
      { apiKey: parsed.apiKey },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = stripeCredentials;

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.creds.apiKey}`,
      'Stripe-Version': '2024-06-20',
      'User-Agent': connectorUserAgent('stripe'),
    };
    if (this.settings.accountId) {
      headers['Stripe-Account'] = this.settings.accountId;
    }
    return headers;
  }

  private fetch<T>(
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
    params: Record<string, string | undefined>,
  ): string {
    const url = new URL(`https://api.stripe.com/v1/${path}`);
    url.searchParams.set('limit', '100');
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  private entityCreatedGte(
    phase: StripePhase,
    options: SyncOptions,
  ): string | undefined {
    if (!options.since) {
      return undefined;
    }
    const sinceMs = new Date(options.since).getTime();
    if (options.mode === 'latest') {
      return String(Math.floor((sinceMs - 7 * 24 * 60 * 60 * 1000) / 1000));
    }
    if (phase === 'subscriptions') {
      return undefined;
    }
    return String(Math.floor(sinceMs / 1000));
  }

  private eventCreatedGt(options: SyncOptions): string | undefined {
    if (!options.since) {
      return undefined;
    }
    return String(Math.floor(new Date(options.since).getTime() / 1000));
  }

  private singleSpec(
    options: SyncOptions,
    resource: string,
  ): FetchSpec | undefined {
    const specs = options.fetchSpecs?.[resource];
    return specs && specs.length === 1 ? specs[0] : undefined;
  }

  private buildPhaseUrl(
    phase: StripePhase,
    page: string | null,
    options: SyncOptions,
  ): string {
    const startingAfter = page ?? undefined;
    if (phase in ENTITY_TYPE_BY_PHASE) {
      const extra: Record<string, string | undefined> = {};
      const filter = this.singleSpec(
        options,
        ENTITY_TYPE_BY_PHASE[phase]!,
      )?.filter;
      if (phase === 'subscriptions' || phase === 'invoices') {
        const status = pushableEq(filter, 'status');
        if (phase === 'subscriptions') {
          extra.status = status ?? 'all';
        } else if (status !== null) {
          extra.status = status;
        }
      } else if (phase === 'products' || phase === 'prices') {
        const active = pushableEq(filter, 'active');
        if (active !== null) {
          extra.active = active;
        }
      }
      return this.buildListUrl(phase, {
        ...extra,
        starting_after: startingAfter,
        'created[gte]': this.entityCreatedGte(phase, options),
      });
    }
    return this.buildListUrl(phase, {
      starting_after: startingAfter,
      'created[gt]': this.eventCreatedGt(options),
    });
  }

  private async clearScopeOnFirstPage(
    storage: StorageHandle,
    phase: StripePhase,
  ): Promise<void> {
    const entityType = ENTITY_TYPE_BY_PHASE[phase];
    if (entityType) {
      await storage.entities([], { types: [entityType] });
      return;
    }
    const eventName = EVENT_NAME_BY_PHASE[phase];
    if (eventName) {
      await storage.events([], { names: [eventName] });
    }
  }

  private async writePhase(
    storage: StorageHandle,
    phase: StripePhase,
    items: unknown[],
  ): Promise<void> {
    switch (phase) {
      case 'customers':
        for (const c of items as StripeCustomer[]) {
          await storage.entity({
            type: 'stripe_customer',
            id: c.id,
            attributes: {
              email: c.email ?? null,
              name: c.name ?? null,
              created: c.created,
              currency: c.currency ?? null,
              delinquent: c.delinquent ?? false,
              livemode: c.livemode,
            },
            updated_at: c.created * 1000,
          });
        }
        return;
      case 'products':
        for (const p of items as StripeProduct[]) {
          await storage.entity({
            type: 'stripe_product',
            id: p.id,
            attributes: { name: p.name, active: p.active, created: p.created },
            updated_at: p.created * 1000,
          });
        }
        return;
      case 'prices':
        for (const p of items as StripePrice[]) {
          await storage.entity({
            type: 'stripe_price',
            id: p.id,
            attributes: {
              productId: p.product,
              unitAmount: p.unit_amount ?? null,
              currency: p.currency,
              interval: p.recurring?.interval ?? null,
              intervalCount: p.recurring?.interval_count ?? null,
              active: p.active,
              created: p.created,
            },
            updated_at: p.created * 1000,
          });
        }
        return;
      case 'subscriptions':
        for (const s of items as StripeSubscription[]) {
          await storage.entity({
            type: 'stripe_subscription',
            id: s.id,
            attributes: {
              customerId: s.customer,
              status: s.status,
              planId: s.items.data[0]?.price.id ?? null,
              currentPeriodStart: s.current_period_start,
              currentPeriodEnd: s.current_period_end,
              cancelAtPeriodEnd: s.cancel_at_period_end,
              canceledAt: s.canceled_at ?? null,
              trialEnd: s.trial_end ?? null,
              mrrAmount: computeMrrAmountCents(s),
              currency: s.currency,
              created: s.created,
            },
            updated_at: s.current_period_end * 1000,
          });
        }
        return;
      case 'invoices':
        for (const inv of items as StripeInvoice[]) {
          await storage.entity({
            type: 'stripe_invoice',
            id: inv.id,
            attributes: {
              customerId: inv.customer ?? null,
              subscriptionId: inv.subscription ?? null,
              status: inv.status ?? null,
              amountDue: inv.amount_due,
              amountPaid: inv.amount_paid,
              currency: inv.currency,
              created: inv.created,
              dueDate: inv.due_date ?? null,
              hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
            },
            updated_at: inv.created * 1000,
          });
        }
        return;
      case 'charges':
        for (const c of items as StripeCharge[]) {
          await storage.event({
            name: 'stripe_charge',
            start_ts: c.created * 1000,
            end_ts: null,
            attributes: {
              id: c.id,
              customerId: c.customer ?? null,
              amount: c.amount,
              currency: c.currency,
              status: c.status,
              failureCode: c.failure_code ?? null,
              paymentIntentId: c.payment_intent ?? null,
            },
          });
        }
        return;
      case 'payment_intents':
        for (const pi of items as StripePaymentIntent[]) {
          await storage.event({
            name: 'stripe_payment_intent',
            start_ts: pi.created * 1000,
            end_ts: null,
            attributes: {
              id: pi.id,
              customerId: pi.customer ?? null,
              amount: pi.amount,
              currency: pi.currency,
              status: pi.status,
            },
          });
        }
        return;
      case 'disputes':
        for (const d of items as StripeDispute[]) {
          await storage.event({
            name: 'stripe_dispute',
            start_ts: d.created * 1000,
            end_ts: null,
            attributes: {
              id: d.id,
              chargeId: d.charge,
              amount: d.amount,
              currency: d.currency,
              reason: d.reason,
              status: d.status,
            },
          });
        }
        return;
      case 'refunds':
        for (const r of items as StripeRefund[]) {
          await storage.event({
            name: 'stripe_refund',
            start_ts: r.created * 1000,
            end_ts: null,
            attributes: {
              id: r.id,
              chargeId: r.charge ?? null,
              amount: r.amount,
              currency: r.currency,
              reason: r.reason ?? null,
              status: r.status ?? null,
            },
          });
        }
        return;
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = isStripeSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';

    const phases = selectActivePhases<StripeResource, StripePhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<StripePhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        const url = this.buildPhaseUrl(phase, page, options);
        const res = await this.fetch<StripeListResponse<{ id: string }>>(
          url,
          phase,
          sig,
        );
        const { data, has_more } = res.body;
        const next = has_more && data.length > 0 ? data.at(-1)!.id : null;
        return { items: data, next };
      },
      writeBatch: async (phase, items, page) => {
        if (isFull && page === null) {
          await this.clearScopeOnFirstPage(storage, phase);
        }
        await this.writePhase(storage, phase, items);
      },
    });
  }
}
