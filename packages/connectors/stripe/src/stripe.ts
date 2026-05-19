import {
  type HttpRequest,
  type HttpResponse,
  request,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ChunkedSyncCursor,
  type CredentialsSchema,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
  paginateChunked,
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
  }),
);

export interface StripeSettings {
  accountId?: string;
}

// ---------------------------------------------------------------------------
// Stripe API types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

const stripeCredentials = {
  apiKey: {
    description: 'Stripe API key',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type StripeCredentials = typeof stripeCredentials;

// ---------------------------------------------------------------------------
// Sync phases + cursor
// ---------------------------------------------------------------------------

type StripePhase =
  | 'customers'
  | 'products'
  | 'prices'
  | 'subscriptions'
  | 'invoices'
  | 'charges'
  | 'payment_intents'
  | 'disputes'
  | 'refunds';

const PHASE_ORDER: readonly StripePhase[] = [
  'customers',
  'products',
  'prices',
  'subscriptions',
  'invoices',
  'charges',
  'payment_intents',
  'disputes',
  'refunds',
];

type StripeSyncCursor = ChunkedSyncCursor<StripePhase, string>;

function isStripeSyncCursor(value: unknown): value is StripeSyncCursor {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as { phase?: unknown; page?: unknown };
  if (typeof v.phase !== 'string') {
    return false;
  }
  if (!(PHASE_ORDER as readonly string[]).includes(v.phase)) {
    return false;
  }
  if (v.page !== null && typeof v.page !== 'string') {
    return false;
  }
  return true;
}

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

// ---------------------------------------------------------------------------
// MRR helper
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// StripeConnector
// ---------------------------------------------------------------------------

export class StripeConnector extends BaseConnector<
  StripeSettings,
  StripeCredentials
> {
  static readonly id = 'stripe';

  static create(input: unknown): { connector: StripeConnector } {
    const parsed = configFields.parse(input);
    return {
      connector: new StripeConnector(
        { accountId: parsed.accountId },
        { apiKey: parsed.apiKey },
      ),
    };
  }

  readonly id = 'stripe';
  override readonly credentials = stripeCredentials;

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.creds.apiKey}`,
      'Stripe-Version': '2024-06-20',
      'User-Agent': 'rawdash/connector-stripe (+https://rawdash.dev)',
    };
    if (this.settings.accountId) {
      headers['Stripe-Account'] = this.settings.accountId;
    }
    return headers;
  }

  private get<T>(url: string, signal?: AbortSignal): Promise<HttpResponse<T>> {
    const req: HttpRequest = {
      url,
      headers: this.buildHeaders(),
      signal,
    };
    return request<T>(req);
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

  // created[gte] cutoff for entity phases in incremental mode (7-day lookback)
  private entityCreatedGte(options: SyncOptions): string | undefined {
    if (options.mode !== 'latest' || !options.since) {
      return undefined;
    }
    const sinceMs = new Date(options.since).getTime();
    return String(Math.floor((sinceMs - 7 * 24 * 60 * 60 * 1000) / 1000));
  }

  // created[gt] cutoff for event phases in incremental mode
  private eventCreatedGt(options: SyncOptions): string | undefined {
    if (options.mode !== 'latest' || !options.since) {
      return undefined;
    }
    return String(Math.floor(new Date(options.since).getTime() / 1000));
  }

  private buildPhaseUrl(
    phase: StripePhase,
    page: string | null,
    options: SyncOptions,
  ): string {
    const startingAfter = page ?? undefined;
    if (phase in ENTITY_TYPE_BY_PHASE) {
      const extra: Record<string, string | undefined> =
        phase === 'subscriptions' ? { status: 'all' } : {};
      return this.buildListUrl(phase, {
        ...extra,
        starting_after: startingAfter,
        'created[gte]': this.entityCreatedGte(options),
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

    return paginateChunked<StripePhase, string>({
      phases: PHASE_ORDER,
      cursor,
      signal,
      fetchPage: async (phase, page, sig) => {
        const url = this.buildPhaseUrl(phase, page, options);
        const res = await this.get<StripeListResponse<{ id: string }>>(
          url,
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
