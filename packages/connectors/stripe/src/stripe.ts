import {
  type HttpRequest,
  type HttpResponse,
  request,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type CredentialsSchema,
  type Entity,
  type Event,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
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

interface StripeSyncCursor {
  phase: StripePhase;
  startingAfter?: string;
}

type PhaseResult = { done: true } | { done: false; startingAfter: string };

function isStripeSyncCursor(value: unknown): value is StripeSyncCursor {
  if (typeof value !== 'object' || value === null) {return false;}
  const v = value as { phase?: unknown; startingAfter?: unknown };
  if (typeof v.phase !== 'string') {return false;}
  if (!(PHASE_ORDER as readonly string[]).includes(v.phase)) {return false;}
  if (v.startingAfter !== undefined && typeof v.startingAfter !== 'string')
    {return false;}
  return true;
}

// ---------------------------------------------------------------------------
// MRR helper
// ---------------------------------------------------------------------------

export function computeMrrAmountCents(
  subscription: StripeSubscription,
): number | null {
  const item = subscription.items.data[0];
  if (!item) {return null;}
  const { unit_amount, recurring } = item.price;
  if (unit_amount === null || unit_amount === undefined) {return null;}
  const quantity = item.quantity ?? 1;
  const total = unit_amount * quantity;
  switch (recurring?.interval) {
    case 'month':
      return Math.round(total / (recurring.interval_count || 1));
    case 'year':
      return Math.round(total / (12 * (recurring.interval_count || 1)));
    case 'week':
      return Math.round((total * 52) / (12 * (recurring.interval_count || 1)));
    case 'day':
      return Math.round((total * 365) / (12 * (recurring.interval_count || 1)));
    default:
      return null;
  }
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
      if (value !== undefined) {url.searchParams.set(key, value);}
    }
    return url.toString();
  }

  // created[gte] cutoff for entity phases in incremental mode (7-day lookback)
  private entityCreatedGte(options: SyncOptions): string | undefined {
    if (options.mode !== 'latest' || !options.since) {return undefined;}
    const sinceMs = new Date(options.since).getTime();
    return String(Math.floor((sinceMs - 7 * 24 * 60 * 60 * 1000) / 1000));
  }

  // created[gt] cutoff for event phases in incremental mode
  private eventCreatedGt(options: SyncOptions): string | undefined {
    if (options.mode !== 'latest' || !options.since) {return undefined;}
    return String(Math.floor(new Date(options.since).getTime() / 1000));
  }

  // ---------------------------------------------------------------------------
  // Phase: customers
  // ---------------------------------------------------------------------------

  private async syncCustomers(
    storage: StorageHandle,
    options: SyncOptions,
    startingAfter: string | undefined,
    signal?: AbortSignal,
  ): Promise<PhaseResult> {
    const isFull = options.mode === 'full';
    if (isFull && startingAfter === undefined) {
      await storage.entities([], { types: ['stripe_customer'] });
    }

    let cursor = startingAfter;
    while (true) {
      if (signal?.aborted) {return { done: false, startingAfter: cursor ?? '' };}

      const url = this.buildListUrl('customers', {
        starting_after: cursor,
        'created[gte]': this.entityCreatedGte(options),
      });
      const res = await this.get<StripeListResponse<StripeCustomer>>(
        url,
        signal,
      );
      const { data, has_more } = res.body;

      const entities: Entity[] = data.map((c) => ({
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
      }));

      for (const e of entities) {await storage.entity(e);}

      if (!has_more || data.length === 0) {return { done: true };}
      cursor = data.at(-1)!.id;
    }
  }

  // ---------------------------------------------------------------------------
  // Phase: products
  // ---------------------------------------------------------------------------

  private async syncProducts(
    storage: StorageHandle,
    options: SyncOptions,
    startingAfter: string | undefined,
    signal?: AbortSignal,
  ): Promise<PhaseResult> {
    const isFull = options.mode === 'full';
    if (isFull && startingAfter === undefined) {
      await storage.entities([], { types: ['stripe_product'] });
    }

    let cursor = startingAfter;
    while (true) {
      if (signal?.aborted) {return { done: false, startingAfter: cursor ?? '' };}

      const url = this.buildListUrl('products', {
        starting_after: cursor,
        'created[gte]': this.entityCreatedGte(options),
      });
      const res = await this.get<StripeListResponse<StripeProduct>>(
        url,
        signal,
      );
      const { data, has_more } = res.body;

      for (const p of data) {
        await storage.entity({
          type: 'stripe_product',
          id: p.id,
          attributes: {
            name: p.name,
            active: p.active,
            created: p.created,
          },
          updated_at: p.created * 1000,
        });
      }

      if (!has_more || data.length === 0) {return { done: true };}
      cursor = data.at(-1)!.id;
    }
  }

  // ---------------------------------------------------------------------------
  // Phase: prices
  // ---------------------------------------------------------------------------

  private async syncPrices(
    storage: StorageHandle,
    options: SyncOptions,
    startingAfter: string | undefined,
    signal?: AbortSignal,
  ): Promise<PhaseResult> {
    const isFull = options.mode === 'full';
    if (isFull && startingAfter === undefined) {
      await storage.entities([], { types: ['stripe_price'] });
    }

    let cursor = startingAfter;
    while (true) {
      if (signal?.aborted) {return { done: false, startingAfter: cursor ?? '' };}

      const url = this.buildListUrl('prices', {
        starting_after: cursor,
        'created[gte]': this.entityCreatedGte(options),
      });
      const res = await this.get<StripeListResponse<StripePrice>>(url, signal);
      const { data, has_more } = res.body;

      for (const p of data) {
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

      if (!has_more || data.length === 0) {return { done: true };}
      cursor = data.at(-1)!.id;
    }
  }

  // ---------------------------------------------------------------------------
  // Phase: subscriptions
  // ---------------------------------------------------------------------------

  private async syncSubscriptions(
    storage: StorageHandle,
    options: SyncOptions,
    startingAfter: string | undefined,
    signal?: AbortSignal,
  ): Promise<PhaseResult> {
    const isFull = options.mode === 'full';
    if (isFull && startingAfter === undefined) {
      await storage.entities([], { types: ['stripe_subscription'] });
    }

    let cursor = startingAfter;
    while (true) {
      if (signal?.aborted) {return { done: false, startingAfter: cursor ?? '' };}

      const url = this.buildListUrl('subscriptions', {
        status: 'all',
        starting_after: cursor,
        'created[gte]': this.entityCreatedGte(options),
      });
      const res = await this.get<StripeListResponse<StripeSubscription>>(
        url,
        signal,
      );
      const { data, has_more } = res.body;

      for (const s of data) {
        const planItem = s.items.data[0];
        await storage.entity({
          type: 'stripe_subscription',
          id: s.id,
          attributes: {
            customerId: s.customer,
            status: s.status,
            planId: planItem?.price.id ?? null,
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

      if (!has_more || data.length === 0) {return { done: true };}
      cursor = data.at(-1)!.id;
    }
  }

  // ---------------------------------------------------------------------------
  // Phase: invoices
  // ---------------------------------------------------------------------------

  private async syncInvoices(
    storage: StorageHandle,
    options: SyncOptions,
    startingAfter: string | undefined,
    signal?: AbortSignal,
  ): Promise<PhaseResult> {
    const isFull = options.mode === 'full';
    if (isFull && startingAfter === undefined) {
      await storage.entities([], { types: ['stripe_invoice'] });
    }

    let cursor = startingAfter;
    while (true) {
      if (signal?.aborted) {return { done: false, startingAfter: cursor ?? '' };}

      const url = this.buildListUrl('invoices', {
        starting_after: cursor,
        'created[gte]': this.entityCreatedGte(options),
      });
      const res = await this.get<StripeListResponse<StripeInvoice>>(
        url,
        signal,
      );
      const { data, has_more } = res.body;

      for (const inv of data) {
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

      if (!has_more || data.length === 0) {return { done: true };}
      cursor = data.at(-1)!.id;
    }
  }

  // ---------------------------------------------------------------------------
  // Phase: charges
  // ---------------------------------------------------------------------------

  private async syncCharges(
    storage: StorageHandle,
    options: SyncOptions,
    startingAfter: string | undefined,
    signal?: AbortSignal,
  ): Promise<PhaseResult> {
    const isFull = options.mode === 'full';
    if (isFull && startingAfter === undefined) {
      await storage.events([], { names: ['stripe_charge'] });
    }

    let cursor = startingAfter;
    while (true) {
      if (signal?.aborted) {return { done: false, startingAfter: cursor ?? '' };}

      const url = this.buildListUrl('charges', {
        starting_after: cursor,
        'created[gt]': this.eventCreatedGt(options),
      });
      const res = await this.get<StripeListResponse<StripeCharge>>(url, signal);
      const { data, has_more } = res.body;

      const events: Event[] = data.map((c) => ({
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
      }));

      for (const e of events) {await storage.event(e);}

      if (!has_more || data.length === 0) {return { done: true };}
      cursor = data.at(-1)!.id;
    }
  }

  // ---------------------------------------------------------------------------
  // Phase: payment_intents
  // ---------------------------------------------------------------------------

  private async syncPaymentIntents(
    storage: StorageHandle,
    options: SyncOptions,
    startingAfter: string | undefined,
    signal?: AbortSignal,
  ): Promise<PhaseResult> {
    const isFull = options.mode === 'full';
    if (isFull && startingAfter === undefined) {
      await storage.events([], { names: ['stripe_payment_intent'] });
    }

    let cursor = startingAfter;
    while (true) {
      if (signal?.aborted) {return { done: false, startingAfter: cursor ?? '' };}

      const url = this.buildListUrl('payment_intents', {
        starting_after: cursor,
        'created[gt]': this.eventCreatedGt(options),
      });
      const res = await this.get<StripeListResponse<StripePaymentIntent>>(
        url,
        signal,
      );
      const { data, has_more } = res.body;

      for (const pi of data) {
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

      if (!has_more || data.length === 0) {return { done: true };}
      cursor = data.at(-1)!.id;
    }
  }

  // ---------------------------------------------------------------------------
  // Phase: disputes
  // ---------------------------------------------------------------------------

  private async syncDisputes(
    storage: StorageHandle,
    options: SyncOptions,
    startingAfter: string | undefined,
    signal?: AbortSignal,
  ): Promise<PhaseResult> {
    const isFull = options.mode === 'full';
    if (isFull && startingAfter === undefined) {
      await storage.events([], { names: ['stripe_dispute'] });
    }

    let cursor = startingAfter;
    while (true) {
      if (signal?.aborted) {return { done: false, startingAfter: cursor ?? '' };}

      const url = this.buildListUrl('disputes', {
        starting_after: cursor,
        'created[gt]': this.eventCreatedGt(options),
      });
      const res = await this.get<StripeListResponse<StripeDispute>>(
        url,
        signal,
      );
      const { data, has_more } = res.body;

      for (const d of data) {
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

      if (!has_more || data.length === 0) {return { done: true };}
      cursor = data.at(-1)!.id;
    }
  }

  // ---------------------------------------------------------------------------
  // Phase: refunds
  // ---------------------------------------------------------------------------

  private async syncRefunds(
    storage: StorageHandle,
    options: SyncOptions,
    startingAfter: string | undefined,
    signal?: AbortSignal,
  ): Promise<PhaseResult> {
    const isFull = options.mode === 'full';
    if (isFull && startingAfter === undefined) {
      await storage.events([], { names: ['stripe_refund'] });
    }

    let cursor = startingAfter;
    while (true) {
      if (signal?.aborted) {return { done: false, startingAfter: cursor ?? '' };}

      const url = this.buildListUrl('refunds', {
        starting_after: cursor,
        'created[gt]': this.eventCreatedGt(options),
      });
      const res = await this.get<StripeListResponse<StripeRefund>>(url, signal);
      const { data, has_more } = res.body;

      for (const r of data) {
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

      if (!has_more || data.length === 0) {return { done: true };}
      cursor = data.at(-1)!.id;
    }
  }

  // ---------------------------------------------------------------------------
  // Orchestration
  // ---------------------------------------------------------------------------

  private async runPhase(
    phase: StripePhase,
    storage: StorageHandle,
    options: SyncOptions,
    startingAfter: string | undefined,
    signal?: AbortSignal,
  ): Promise<PhaseResult> {
    switch (phase) {
      case 'customers':
        return this.syncCustomers(storage, options, startingAfter, signal);
      case 'products':
        return this.syncProducts(storage, options, startingAfter, signal);
      case 'prices':
        return this.syncPrices(storage, options, startingAfter, signal);
      case 'subscriptions':
        return this.syncSubscriptions(storage, options, startingAfter, signal);
      case 'invoices':
        return this.syncInvoices(storage, options, startingAfter, signal);
      case 'charges':
        return this.syncCharges(storage, options, startingAfter, signal);
      case 'payment_intents':
        return this.syncPaymentIntents(storage, options, startingAfter, signal);
      case 'disputes':
        return this.syncDisputes(storage, options, startingAfter, signal);
      case 'refunds':
        return this.syncRefunds(storage, options, startingAfter, signal);
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const incoming = isStripeSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const startIdx = incoming ? PHASE_ORDER.indexOf(incoming.phase) : 0;

    for (let i = startIdx; i < PHASE_ORDER.length; i++) {
      const phase = PHASE_ORDER[i]!;
      const startingAfter =
        i === startIdx ? incoming?.startingAfter : undefined;
      const result = await this.runPhase(
        phase,
        storage,
        options,
        startingAfter,
        signal,
      );
      if (!result.done) {
        return {
          done: false,
          cursor: {
            phase,
            startingAfter: result.startingAfter,
          } satisfies StripeSyncCursor,
        };
      }
    }

    return { done: true };
  }
}
