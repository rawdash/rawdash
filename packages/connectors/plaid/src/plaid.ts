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

export const configFields = defineConfigFields(
  z.object({
    clientId: z.string().min(1).meta({
      label: 'Client ID',
      description:
        'Plaid client_id from the Dashboard → Team Settings → Keys. Not secret, but pairs with the secret below.',
      placeholder: '5f1a2b3c4d5e6f0011223344',
    }),
    secret: z.object({ $secret: z.string() }).meta({
      label: 'Secret',
      description:
        'Plaid API secret for the selected environment. Create or reveal it under Dashboard → Team Settings → Keys.',
      placeholder: 'PLAID_SECRET',
      secret: true,
    }),
    accessToken: z.object({ $secret: z.string() }).meta({
      label: 'Access Token',
      description:
        'Per-Item access_token returned by /item/public_token/exchange. One connector instance syncs one Item (one linked institution); add another instance per Item.',
      placeholder: 'PLAID_ACCESS_TOKEN',
      secret: true,
    }),
    environment: z
      .enum(['sandbox', 'development', 'production'])
      .default('production')
      .meta({
        label: 'Environment',
        description:
          'Which Plaid environment the secret and access token belong to.',
      }),
    resources: z
      .array(z.enum(['accounts', 'transactions']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Plaid resources to sync. Omit to sync all of them (accounts and transactions).',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Plaid',
  category: 'finance',
  brandColor: '#000000',
  tagline:
    'Sync account balances and transactions for a linked Plaid Item so finance teams can watch cash position and spend across every account in one place.',
  vendor: {
    name: 'Plaid',
    domain: 'plaid.com',
    apiDocs: 'https://plaid.com/docs/api/',
    website: 'https://plaid.com',
  },
  auth: {
    summary:
      'Authenticates with a Plaid client_id and secret plus a per-Item access_token. Each connector instance covers one linked institution (Item); the Item itself may expose several accounts.',
    setup: [
      'In the Plaid Dashboard → Team Settings → Keys, copy your client_id and the secret for the environment you want to sync (sandbox, development, or production).',
      'Link an institution with Plaid Link and exchange the resulting public_token for a long-lived access_token via POST /item/public_token/exchange.',
      'Store the secret and the access_token as secrets and reference them from the connector config as `secret: secret("PLAID_SECRET")` and `accessToken: secret("PLAID_ACCESS_TOKEN")`.',
      'Add one connector instance per Item you want on the dashboard.',
    ],
  },
  rateLimit:
    'Requests are POSTed with credentials in the JSON body. Plaid enforces per-product rate limits (e.g. /transactions/get) and returns 429s that are retried with exponential backoff. /transactions/get is paginated with the count/offset options (500 per page).',
  limitations: [
    'One connector instance syncs a single Item (one linked institution). Link several institutions by adding one instance per access_token.',
    'Transaction amounts follow the Plaid sign convention: positive amounts are money leaving the account, negative amounts are money coming in.',
    'Monetary values are in the account’s native currency (iso_currency_code, or unofficial_currency_code when Plaid cannot resolve an ISO code).',
    'Incremental syncs re-request transactions from a 14-day lookback so that pending transactions are updated once they post.',
  ],
});

export interface PlaidSettings {
  clientId: string;
  environment: PlaidEnvironment;
  resources?: readonly PlaidResource[];
}

type PlaidEnvironment = 'sandbox' | 'development' | 'production';

const BASE_URL_BY_ENV: Record<PlaidEnvironment, string> = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com',
};

const PLAID_VERSION = '2020-09-14';
const TRANSACTIONS_PAGE_SIZE = 500;
const INCREMENTAL_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const FULL_BACKFILL_MS = 730 * 24 * 60 * 60 * 1000;

interface PlaidBalances {
  available: number | null;
  current: number | null;
  limit: number | null;
  iso_currency_code: string | null;
  unofficial_currency_code: string | null;
}

interface PlaidAccount {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  balances: PlaidBalances;
}

interface PlaidItem {
  item_id: string;
  institution_id: string | null;
}

interface PlaidBalanceResponse {
  accounts: PlaidAccount[];
  item: PlaidItem;
  request_id: string;
}

interface PlaidPersonalFinanceCategory {
  primary: string;
  detailed: string;
}

interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  amount: number;
  iso_currency_code: string | null;
  unofficial_currency_code: string | null;
  name: string;
  merchant_name: string | null;
  pending: boolean;
  date: string;
  datetime: string | null;
  category: string[] | null;
  personal_finance_category: PlaidPersonalFinanceCategory | null;
}

interface PlaidTransactionsResponse {
  accounts: PlaidAccount[];
  transactions: PlaidTransaction[];
  total_transactions: number;
  item: PlaidItem;
  request_id: string;
}

const plaidCredentials = {
  secret: {
    description: 'Plaid API secret for the selected environment',
    auth: 'required' as const,
  },
  accessToken: {
    description: 'Per-Item Plaid access_token',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type PlaidCredentials = typeof plaidCredentials;

const PHASE_ORDER = ['accounts', 'transactions'] as const;

type PlaidPhase = (typeof PHASE_ORDER)[number];

export type PlaidResource = PlaidPhase;

const isPlaidSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const balancesSchema = z.object({
  available: z.number().nullable(),
  current: z.number().nullable(),
  limit: z.number().nullable(),
  iso_currency_code: z.string().nullable(),
  unofficial_currency_code: z.string().nullable(),
});

const accountSchema = z.object({
  account_id: z.string().min(1),
  name: z.string(),
  official_name: z.string().nullable(),
  mask: z.string().nullable(),
  type: z.string(),
  subtype: z.string().nullable(),
  balances: balancesSchema,
});

const transactionSchema = z.object({
  transaction_id: z.string().min(1),
  account_id: z.string().min(1),
  amount: z.number(),
  iso_currency_code: z.string().nullable(),
  unofficial_currency_code: z.string().nullable(),
  name: z.string(),
  merchant_name: z.string().nullable(),
  pending: z.boolean(),
  date: z.iso.date(),
  datetime: z.iso.datetime().nullable(),
  category: z.array(z.string()).nullable(),
  personal_finance_category: z
    .object({ primary: z.string(), detailed: z.string() })
    .nullable(),
});

export const plaidResources = defineResources({
  plaid_account: {
    shape: 'entity',
    filterable: [{ field: 'type', ops: ['eq'], values: [] }],
    description:
      'Accounts under the linked Item with current and available balances, type, subtype, and mask.',
    endpoint: 'POST /accounts/balance/get',
    fields: [
      { name: 'itemId', description: 'Item the account belongs to.' },
      { name: 'name', description: 'Account name.' },
      { name: 'officialName', description: 'Official account name, if any.' },
      { name: 'mask', description: 'Last 2-4 digits of the account number.' },
      { name: 'type', description: 'Account type (depository, credit, ...).' },
      {
        name: 'subtype',
        description: 'Account subtype (checking, savings, ...).',
      },
      {
        name: 'currentBalance',
        description: 'Current balance in the account currency.',
      },
      {
        name: 'availableBalance',
        description: 'Available balance in the account currency, if provided.',
      },
      { name: 'limit', description: 'Credit or overdraft limit, if any.' },
      { name: 'currency', description: 'ISO (or unofficial) currency code.' },
    ],
    responses: { accounts: z.array(accountSchema) },
  },
  plaid_transaction: {
    shape: 'event',
    filterable: [],
    description:
      'Transactions timestamped at their posted (or authorized) date, with amount, currency, category, and merchant.',
    endpoint: 'POST /transactions/get',
    notes:
      'Amount sign follows Plaid: positive is money out of the account, negative is money in. Category prefers personal_finance_category.primary and falls back to the first legacy category.',
    fields: [
      { name: 'id', description: 'Plaid transaction_id.' },
      { name: 'accountId', description: 'Account the transaction belongs to.' },
      {
        name: 'amount',
        description:
          'Transaction amount (positive = outflow, negative = inflow).',
      },
      { name: 'currency', description: 'ISO (or unofficial) currency code.' },
      { name: 'category', description: 'Primary category, if resolved.' },
      { name: 'merchantName', description: 'Merchant name, if resolved.' },
      { name: 'name', description: 'Raw transaction description.' },
      {
        name: 'pending',
        description: 'Whether the transaction is still pending.',
      },
      { name: 'date', description: 'Posted or authorized date (YYYY-MM-DD).' },
    ],
    responses: { transactions: z.array(transactionSchema) },
  },
});

export const id = 'plaid';

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function transactionCurrency(t: PlaidTransaction): string | null {
  return t.iso_currency_code ?? t.unofficial_currency_code ?? null;
}

function transactionCategory(t: PlaidTransaction): string | null {
  return t.personal_finance_category?.primary ?? t.category?.[0] ?? null;
}

function transactionTs(t: PlaidTransaction): number {
  const source = t.datetime ?? t.date;
  const parsed = Date.parse(source);
  return Number.isNaN(parsed) ? Date.parse(t.date) : parsed;
}

interface EnrichedAccount extends PlaidAccount {
  itemId: string | null;
}

export class PlaidConnector extends BaseConnector<
  PlaidSettings,
  PlaidCredentials
> {
  static readonly id = id;

  static readonly resources = plaidResources;

  static readonly schemas = schemasFromResources(plaidResources);

  static create(input: unknown, ctx?: ConnectorContext): PlaidConnector {
    const parsed = configFields.parse(input);
    return new PlaidConnector(
      {
        clientId: parsed.clientId,
        environment: parsed.environment,
        resources: parsed.resources,
      },
      { secret: parsed.secret, accessToken: parsed.accessToken },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = plaidCredentials;

  private get baseUrl(): string {
    return BASE_URL_BY_ENV[this.settings.environment];
  }

  private buildBody(extra: Record<string, unknown>): Record<string, unknown> {
    return {
      client_id: this.settings.clientId,
      secret: this.creds.secret,
      access_token: this.creds.accessToken,
      ...extra,
    };
  }

  private postJson<T>(
    path: string,
    body: Record<string, unknown>,
    resource: string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.post<T>(`${this.baseUrl}${path}`, {
      resource,
      headers: {
        'Content-Type': 'application/json',
        'PLAID-VERSION': PLAID_VERSION,
        'User-Agent': connectorUserAgent('plaid'),
      },
      body: JSON.stringify(body),
      signal,
    });
  }

  private transactionsWindow(options: SyncOptions): {
    start_date: string;
    end_date: string;
  } {
    const now = Date.now();
    const sinceMs = options.since ? new Date(options.since).getTime() : null;
    let startMs: number;
    if (sinceMs === null) {
      startMs = now - FULL_BACKFILL_MS;
    } else if (options.mode === 'latest') {
      startMs = sinceMs - INCREMENTAL_LOOKBACK_MS;
    } else {
      startMs = sinceMs;
    }
    return { start_date: formatDate(startMs), end_date: formatDate(now) };
  }

  private async fetchAccounts(
    signal?: AbortSignal,
  ): Promise<EnrichedAccount[]> {
    const res = await this.postJson<PlaidBalanceResponse>(
      '/accounts/balance/get',
      this.buildBody({}),
      'accounts',
      signal,
    );
    const itemId = res.body.item?.item_id ?? null;
    return res.body.accounts.map((account) => ({ ...account, itemId }));
  }

  private async fetchTransactionsPage(
    offset: number,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<{ items: PlaidTransaction[]; next: string | null }> {
    const res = await this.postJson<PlaidTransactionsResponse>(
      '/transactions/get',
      this.buildBody({
        ...this.transactionsWindow(options),
        options: {
          count: TRANSACTIONS_PAGE_SIZE,
          offset,
          include_personal_finance_category: true,
        },
      }),
      'transactions',
      signal,
    );
    const { transactions, total_transactions } = res.body;
    const nextOffset = offset + transactions.length;
    const next =
      transactions.length > 0 && nextOffset < total_transactions
        ? String(nextOffset)
        : null;
    return { items: transactions, next };
  }

  private async writeAccounts(
    storage: StorageHandle,
    accounts: EnrichedAccount[],
  ): Promise<void> {
    for (const a of accounts) {
      await storage.entity({
        type: 'plaid_account',
        id: a.account_id,
        attributes: {
          itemId: a.itemId,
          name: a.name,
          officialName: a.official_name ?? null,
          mask: a.mask ?? null,
          type: a.type,
          subtype: a.subtype ?? null,
          currentBalance: a.balances.current ?? null,
          availableBalance: a.balances.available ?? null,
          limit: a.balances.limit ?? null,
          currency:
            a.balances.iso_currency_code ??
            a.balances.unofficial_currency_code ??
            null,
        },
        updated_at: Date.now(),
      });
    }
  }

  private async writeTransactions(
    storage: StorageHandle,
    transactions: PlaidTransaction[],
  ): Promise<void> {
    for (const t of transactions) {
      await storage.event({
        name: 'plaid_transaction',
        start_ts: transactionTs(t),
        end_ts: null,
        attributes: {
          id: t.transaction_id,
          accountId: t.account_id,
          amount: t.amount,
          currency: transactionCurrency(t),
          category: transactionCategory(t),
          merchantName: t.merchant_name ?? null,
          name: t.name,
          pending: t.pending,
          date: t.date,
        },
      });
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = isPlaidSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';

    const phases = selectActivePhases<PlaidResource, PlaidPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<PlaidPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        if (phase === 'accounts') {
          return { items: await this.fetchAccounts(sig), next: null };
        }
        const offset = page ? Number(page) : 0;
        return this.fetchTransactionsPage(offset, options, sig);
      },
      writeBatch: async (phase, items, page) => {
        if (isFull && page === null) {
          if (phase === 'accounts') {
            await storage.entities([], { types: ['plaid_account'] });
          } else {
            await storage.events([], { names: ['plaid_transaction'] });
          }
        }
        if (phase === 'accounts') {
          await this.writeAccounts(storage, items as EnrichedAccount[]);
        } else {
          await this.writeTransactions(storage, items as PlaidTransaction[]);
        }
      },
    });
  }
}
