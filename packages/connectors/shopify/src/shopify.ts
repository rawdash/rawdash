import {
  type HttpResponse,
  connectorUserAgent,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
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

const API_VERSION = '2025-01';

export const configFields = defineConfigFields(
  z.object({
    shopDomain: z
      .string()
      .min(1)
      .regex(
        /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i,
        'Must be a myshopify.com domain, e.g. yourshop.myshopify.com',
      )
      .meta({
        label: 'Shop domain',
        description:
          'Your store myshopify.com domain, without protocol, e.g. yourshop.myshopify.com.',
        placeholder: 'yourshop.myshopify.com',
      }),
    accessToken: z.object({ $secret: z.string() }).meta({
      label: 'Admin API access token',
      description:
        'Custom App Admin API access token with read_orders, read_customers, and read_products scopes.',
      placeholder: 'shpat_...',
      secret: true,
    }),
    resources: z
      .array(z.enum(['products', 'customers', 'orders']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Shopify resources to sync. Omit to sync all resources. The `orders` phase also emits a refund event for each refund attached to an order.',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Shopify',
  category: 'sales',
  brandColor: '#7AB55C',
  tagline:
    'Sync orders, customers, products, and refund events from a Shopify store via the Admin GraphQL API.',
  vendor: {
    name: 'Shopify',
    domain: 'shopify.com',
    apiDocs: 'https://shopify.dev/docs/api/admin-graphql',
    website: 'https://www.shopify.com',
  },
  auth: {
    summary:
      'A Custom App Admin API access token authenticates every GraphQL request. The token scopes the sync to the store it was created in and the read scopes granted to the app.',
    setup: [
      'In the Shopify admin, open Settings -> Apps and sales channels -> Develop apps.',
      'Create a new app (or open an existing custom app) and open the Configuration tab.',
      'Under Admin API integration, grant the read_orders, read_customers, and read_products scopes and save.',
      'Open the API credentials tab and install the app to reveal the Admin API access token (starts with shpat_).',
      'Store the token as a secret and reference it from the connector config as `accessToken: secret("SHOPIFY_ACCESS_TOKEN")`, and set `shopDomain` to your yourshop.myshopify.com domain.',
    ],
  },
  rateLimit:
    'The Admin GraphQL API uses a cost-based leaky-bucket limit per access token; this connector pages 250 records at a time and relies on standard HTTP 429 retry/backoff.',
  limitations: [
    'Custom App access token auth only (OAuth app distribution not supported).',
    'Order status-transition history and inventory-level resources are out of scope; refund events are derived from each order.',
  ],
});

export interface ShopifySettings {
  shopDomain: string;
  resources?: readonly ShopifyResource[];
}

const shopifyCredentials = {
  accessToken: {
    description: 'Shopify Admin API access token',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type ShopifyCredentials = typeof shopifyCredentials;

const PHASE_ORDER = ['products', 'customers', 'orders'] as const;

type ShopifyPhase = (typeof PHASE_ORDER)[number];

export type ShopifyResource = ShopifyPhase;

const isShopifySyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface Connection<T> {
  nodes: T[];
  pageInfo: PageInfo;
}

interface MoneyV2 {
  amount: string;
  currencyCode: string;
}

interface MoneyBag {
  shopMoney: MoneyV2;
}

interface ShopifyProduct {
  id: string;
  title: string;
  vendor: string;
  status: string;
  totalInventory: number | null;
  createdAt: string;
  updatedAt: string;
}

interface ShopifyCustomer {
  id: string;
  defaultEmailAddress: { emailAddress: string | null } | null;
  numberOfOrders: string;
  amountSpent: MoneyV2;
  createdAt: string;
  updatedAt: string;
}

interface ShopifyRefund {
  id: string;
  createdAt: string | null;
  totalRefundedSet: MoneyBag;
}

interface ShopifyOrder {
  id: string;
  name: string;
  currentTotalPriceSet: MoneyBag;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  customer: { id: string } | null;
  createdAt: string;
  processedAt: string;
  cancelledAt: string | null;
  updatedAt: string;
  refunds: ShopifyRefund[];
}

interface GraphQLError {
  message: string;
  extensions?: { code?: string };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

const PRODUCTS_QUERY = `
  query Products($cursor: String, $first: Int!, $query: String) {
    products(after: $cursor, first: $first, query: $query, sortKey: UPDATED_AT) {
      nodes { id title vendor status totalInventory createdAt updatedAt }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const CUSTOMERS_QUERY = `
  query Customers($cursor: String, $first: Int!, $query: String) {
    customers(after: $cursor, first: $first, query: $query, sortKey: UPDATED_AT) {
      nodes {
        id
        defaultEmailAddress { emailAddress }
        numberOfOrders
        amountSpent { amount currencyCode }
        createdAt updatedAt
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const ORDERS_QUERY = `
  query Orders($cursor: String, $first: Int!, $query: String) {
    orders(after: $cursor, first: $first, query: $query, sortKey: UPDATED_AT) {
      nodes {
        id name
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        displayFinancialStatus displayFulfillmentStatus
        customer { id }
        createdAt processedAt cancelledAt updatedAt
        refunds {
          id createdAt
          totalRefundedSet { shopMoney { amount currencyCode } }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const MAX_PAGE_SIZE = 250;
const DEFAULT_PAGE_SIZE = 250;
const CHUNK_BUDGET_MS = 25_000;

function clampPageSize(requested: number | undefined): number {
  const n = requested ?? DEFAULT_PAGE_SIZE;
  if (!Number.isFinite(n) || n < 1) {
    return 1;
  }
  return Math.min(Math.floor(n), MAX_PAGE_SIZE);
}

function parseMoney(amount: string | null | undefined): number | null {
  if (amount == null) {
    return null;
  }
  const n = Number(amount);
  return Number.isFinite(n) ? n : null;
}

function parseCount(value: string | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const idString = z.string().min(1);
const moneyV2Schema = z.object({
  amount: z.string(),
  currencyCode: z.string(),
});
const moneyBagSchema = z.object({ shopMoney: moneyV2Schema });

const productSchema = z.object({
  id: idString,
  title: z.string(),
  vendor: z.string(),
  status: z.string(),
  totalInventory: z.number().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const customerSchema = z.object({
  id: idString,
  defaultEmailAddress: z
    .object({ emailAddress: z.string().nullable() })
    .nullable(),
  numberOfOrders: z.string(),
  amountSpent: moneyV2Schema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const refundSchema = z.object({
  id: idString,
  createdAt: z.iso.datetime().nullable(),
  totalRefundedSet: moneyBagSchema,
});

const orderSchema = z.object({
  id: idString,
  name: z.string(),
  currentTotalPriceSet: moneyBagSchema,
  displayFinancialStatus: z.string().nullable(),
  displayFulfillmentStatus: z.string(),
  customer: z.object({ id: idString }).nullable(),
  createdAt: z.iso.datetime(),
  processedAt: z.iso.datetime(),
  cancelledAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
  refunds: z.array(refundSchema),
});

export const shopifyResources = defineResources({
  shopify_product: {
    shape: 'entity',
    filterable: [
      {
        field: 'status',
        ops: ['eq'],
        values: ['ACTIVE', 'ARCHIVED', 'DRAFT'],
      },
      { field: 'vendor', ops: ['eq'] },
    ],
    description:
      'Store products with their title, vendor, status, and total inventory.',
    endpoint: 'GraphQL query: products { nodes { ... } }',
    responses: { products: z.array(productSchema) },
  },
  shopify_customer: {
    shape: 'entity',
    filterable: [],
    description:
      'Store customers with their email, lifetime order count, and total amount spent.',
    endpoint: 'GraphQL query: customers { nodes { ... } }',
    responses: { customers: z.array(customerSchema) },
  },
  shopify_order: {
    shape: 'entity',
    filterable: [
      {
        field: 'financialStatus',
        ops: ['eq'],
        values: [
          'PENDING',
          'AUTHORIZED',
          'PARTIALLY_PAID',
          'PAID',
          'PARTIALLY_REFUNDED',
          'REFUNDED',
          'VOIDED',
        ],
      },
      {
        field: 'fulfillmentStatus',
        ops: ['eq'],
        values: [
          'FULFILLED',
          'IN_PROGRESS',
          'ON_HOLD',
          'OPEN',
          'PARTIALLY_FULFILLED',
          'PENDING_FULFILLMENT',
          'RESTOCKED',
          'SCHEDULED',
          'UNFULFILLED',
        ],
      },
    ],
    description:
      'Orders with their total price, currency, financial and fulfillment status, customer, and lifecycle timestamps.',
    endpoint: 'GraphQL query: orders { nodes { ... } }',
    responses: { orders: z.array(orderSchema) },
  },
  shopify_refund: {
    shape: 'event',
    filterable: [],
    description:
      'Refund events derived from each order, carrying the refunded amount and currency.',
    endpoint: 'GraphQL query: orders { nodes { refunds { ... } } }',
    notes:
      'Derived from the `refunds` list on each synced order. Each refund becomes one append-only event keyed by its refund id; refunds attached to orders outside the current incremental window are not revisited.',
  },
});

export const id = 'shopify';

export class ShopifyConnector extends BaseConnector<
  ShopifySettings,
  ShopifyCredentials
> {
  static readonly id = id;

  static readonly resources = shopifyResources;

  static readonly schemas = schemasFromResources(shopifyResources);

  static create(input: unknown, ctx?: ConnectorContext): ShopifyConnector {
    const parsed = configFields.parse(input);
    return new ShopifyConnector(
      { shopDomain: parsed.shopDomain, resources: parsed.resources },
      { accessToken: parsed.accessToken },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = shopifyCredentials;

  private endpoint(): string {
    return `https://${this.settings.shopDomain}/admin/api/${API_VERSION}/graphql.json`;
  }

  private buildHeaders(): Record<string, string> {
    return {
      'X-Shopify-Access-Token': this.creds.accessToken,
      'Content-Type': 'application/json',
      'User-Agent': connectorUserAgent('shopify'),
    };
  }

  private async graphql<T>(
    query: string,
    variables: Record<string, unknown>,
    resource: string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<GraphQLResponse<T>>> {
    const res = await this.post<GraphQLResponse<T>>(this.endpoint(), {
      resource,
      headers: this.buildHeaders(),
      body: JSON.stringify({ query, variables }),
      signal,
    });
    if (res.body.errors && res.body.errors.length > 0) {
      const messages = res.body.errors.map((e) => e.message).join('; ');
      throw new Error(`Shopify GraphQL error: ${messages}`);
    }
    if (!res.body.data) {
      throw new Error(
        `Shopify GraphQL response missing data for resource '${resource}'`,
      );
    }
    return res;
  }

  private sinceQuery(options: SyncOptions): string | undefined {
    if (!options.since) {
      return undefined;
    }
    return `updated_at:>'${options.since}'`;
  }

  private async fetchProductsPage(
    page: string | null,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<{ items: ShopifyProduct[]; next: string | null }> {
    const res = await this.graphql<{ products: Connection<ShopifyProduct> }>(
      PRODUCTS_QUERY,
      {
        cursor: page ?? null,
        first: clampPageSize(options.pageSize),
        query: this.sinceQuery(options) ?? null,
      },
      'products',
      signal,
    );
    const conn = res.body.data!.products;
    return {
      items: conn.nodes,
      next: conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null,
    };
  }

  private async fetchCustomersPage(
    page: string | null,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<{ items: ShopifyCustomer[]; next: string | null }> {
    const res = await this.graphql<{ customers: Connection<ShopifyCustomer> }>(
      CUSTOMERS_QUERY,
      {
        cursor: page ?? null,
        first: clampPageSize(options.pageSize),
        query: this.sinceQuery(options) ?? null,
      },
      'customers',
      signal,
    );
    const conn = res.body.data!.customers;
    return {
      items: conn.nodes,
      next: conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null,
    };
  }

  private async fetchOrdersPage(
    page: string | null,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<{ items: ShopifyOrder[]; next: string | null }> {
    const res = await this.graphql<{ orders: Connection<ShopifyOrder> }>(
      ORDERS_QUERY,
      {
        cursor: page ?? null,
        first: clampPageSize(options.pageSize),
        query: this.sinceQuery(options) ?? null,
      },
      'orders',
      signal,
    );
    const conn = res.body.data!.orders;
    return {
      items: conn.nodes,
      next: conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null,
    };
  }

  private async writeProducts(
    storage: StorageHandle,
    products: ShopifyProduct[],
  ): Promise<void> {
    for (const p of products) {
      await storage.entity({
        type: 'shopify_product',
        id: p.id,
        attributes: {
          title: p.title,
          vendor: p.vendor,
          status: p.status,
          totalInventory: p.totalInventory,
          createdAt: new Date(p.createdAt).getTime(),
        },
        updated_at: new Date(p.updatedAt).getTime(),
      });
    }
  }

  private async writeCustomers(
    storage: StorageHandle,
    customers: ShopifyCustomer[],
  ): Promise<void> {
    for (const c of customers) {
      await storage.entity({
        type: 'shopify_customer',
        id: c.id,
        attributes: {
          email: c.defaultEmailAddress?.emailAddress ?? null,
          ordersCount: parseCount(c.numberOfOrders),
          totalSpent: parseMoney(c.amountSpent.amount),
          currency: c.amountSpent.currencyCode,
          createdAt: new Date(c.createdAt).getTime(),
        },
        updated_at: new Date(c.updatedAt).getTime(),
      });
    }
  }

  private async writeOrders(
    storage: StorageHandle,
    orders: ShopifyOrder[],
    since?: string,
  ): Promise<void> {
    const sinceMs = since ? Date.parse(since) : null;
    for (const o of orders) {
      const money = o.currentTotalPriceSet.shopMoney;
      await storage.entity({
        type: 'shopify_order',
        id: o.id,
        attributes: {
          name: o.name,
          totalPrice: parseMoney(money.amount),
          currency: money.currencyCode,
          financialStatus: o.displayFinancialStatus,
          fulfillmentStatus: o.displayFulfillmentStatus,
          customerId: o.customer?.id ?? null,
          createdAt: new Date(o.createdAt).getTime(),
          processedAt: new Date(o.processedAt).getTime(),
          cancelledAt: o.cancelledAt ? new Date(o.cancelledAt).getTime() : null,
        },
        updated_at: new Date(o.updatedAt).getTime(),
      });

      for (const r of o.refunds) {
        const createdMs = r.createdAt ? Date.parse(r.createdAt) : NaN;
        if (
          sinceMs !== null &&
          Number.isFinite(createdMs) &&
          createdMs <= sinceMs
        ) {
          continue;
        }
        const refundMoney = r.totalRefundedSet.shopMoney;
        const refundTs = Number.isFinite(createdMs)
          ? createdMs
          : new Date(o.updatedAt).getTime();
        await storage.event({
          name: 'shopify_refund',
          start_ts: refundTs,
          end_ts: null,
          attributes: {
            refundId: r.id,
            orderId: o.id,
            orderName: o.name,
            customerId: o.customer?.id ?? null,
            amount: parseMoney(refundMoney.amount),
            currency: refundMoney.currencyCode,
          },
        });
      }
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = isShopifySyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';

    const phases = selectActivePhases<ShopifyResource, ShopifyPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<ShopifyPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      pipeline: true,
      maxChunkMs: CHUNK_BUDGET_MS,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'products':
            return this.fetchProductsPage(page, options, sig);
          case 'customers':
            return this.fetchCustomersPage(page, options, sig);
          case 'orders':
            return this.fetchOrdersPage(page, options, sig);
        }
      },
      writeBatch: async (phase, items, page) => {
        if (isFull && page === null) {
          switch (phase) {
            case 'products':
              await storage.entities([], { types: ['shopify_product'] });
              break;
            case 'customers':
              await storage.entities([], { types: ['shopify_customer'] });
              break;
            case 'orders':
              await storage.entities([], { types: ['shopify_order'] });
              await storage.events([], { names: ['shopify_refund'] });
              break;
          }
        }
        switch (phase) {
          case 'products':
            return this.writeProducts(storage, items as ShopifyProduct[]);
          case 'customers':
            return this.writeCustomers(storage, items as ShopifyCustomer[]);
          case 'orders':
            return this.writeOrders(
              storage,
              items as ShopifyOrder[],
              options.since,
            );
        }
      },
    });
  }
}
