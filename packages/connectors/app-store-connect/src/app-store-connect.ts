import {
  AuthError,
  connectorUserAgent,
  sanitizeAllowedUrl,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ChunkedSyncCursor,
  type ConnectorContext,
  type ConnectorCost,
  type ConnectorDoc,
  type CredentialsSchema,
  type FetchPageResult,
  type JSONValue,
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
    issuerId: z.string().min(1).meta({
      label: 'Issuer ID',
      description:
        'App Store Connect API issuer ID (UUID). Found at Users and Access -> Integrations -> App Store Connect API.',
      placeholder: '69a6de7f-...',
    }),
    keyId: z.string().min(1).meta({
      label: 'Key ID',
      description:
        'App Store Connect API key ID (10 characters). Shown next to the key in Users and Access -> Integrations -> App Store Connect API.',
      placeholder: 'ABC1234DEF',
    }),
    privateKey: z.object({ $secret: z.string() }).meta({
      label: 'Private key (.p8)',
      description:
        'Contents of the App Store Connect API private key file (.p8). PKCS#8 PEM, starting with -----BEGIN PRIVATE KEY-----. Apple only lets you download the key once on creation.',
      placeholder: '-----BEGIN PRIVATE KEY-----\n...',
      secret: true,
    }),
    vendorNumber: z
      .string()
      .regex(/^\d+$/u, 'Vendor number must be a numeric string')
      .optional()
      .meta({
        label: 'Vendor number',
        description:
          'Apple vendor number (8-9 digit numeric). Required to sync sales reports (app_installs and app_revenue). Found in App Store Connect -> Payments and Financial Reports -> top-left dropdown.',
        placeholder: '85912345',
      }),
    resources: z
      .array(z.enum(['apps', 'app_installs', 'app_revenue', 'app_ratings']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which App Store Connect resources to sync. Omit to sync all resources. Sales-derived resources (app_installs, app_revenue) require vendorNumber and are silently skipped without it.',
      }),
    salesBackfillDays: z.number().int().positive().max(365).optional().meta({
      label: 'Sales backfill window (days)',
      description:
        'How many days of daily sales reports to pull on a full sync. Defaults to 30. Apple keeps daily reports for the last 365 days.',
      placeholder: '30',
    }),
    reviewLimit: z.number().int().positive().max(2000).optional().meta({
      label: 'Review sample size',
      description:
        'Most-recent customer reviews to fetch per app for the app_ratings metric. Defaults to 200 (one Apple page). Higher values smooth the rolling rating at the cost of more requests.',
      placeholder: '200',
    }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'App Store Connect',
  category: 'mobile',
  brandColor: '#0D96F6',
  tagline:
    'Sync your iOS / macOS apps, daily sales (downloads and proceeds), and customer review ratings from the App Store Connect API for mobile-team dashboards.',
  vendor: {
    name: 'Apple',
    apiDocs: 'https://developer.apple.com/documentation/appstoreconnectapi',
    website: 'https://appstoreconnect.apple.com',
  },
  auth: {
    summary:
      'App Store Connect API uses an ES256-signed JWT minted per request from an issuer ID, key ID, and a PKCS#8 EC private key (.p8) downloaded from App Store Connect. The key only needs read access to Sales and Reports.',
    setup: [
      'Open App Store Connect -> Users and Access -> Integrations -> App Store Connect API.',
      'Generate a key with the "Sales" or "Finance" role (read-only is enough). Copy the key ID shown in the table; capture the issuer ID at the top of the page.',
      'Download the .p8 file once on creation - Apple does not let you re-download it.',
      'Store the .p8 contents as a secret (e.g. APPSTORECONNECT_P8) and reference it as `privateKey: secret("APPSTORECONNECT_P8")`.',
      'Set `vendorNumber` from App Store Connect -> Payments and Financial Reports (the top-left dropdown shows the 8-9 digit number). Only required for app_installs and app_revenue.',
    ],
  },
  rateLimit:
    'App Store Connect enforces a 3,600 requests-per-hour quota per team. The shared HTTP client backs off on 429 using Retry-After. Sales report endpoints are billed in the same bucket and cost one request per (day, report) pair.',
  limitations: [
    'app_crashes (per-build crash counts) is not implemented. Apple only exposes crash analytics via the asynchronous Analytics Reports flow (create report request -> poll for completion -> download gzipped CSV) which spans multiple syncs; a follow-up will add it.',
    'app_ratings is sampled from the most recent N customer reviews per app (default 200, capped at 2,000). It is a rolling rating, not the lifetime average shown in the App Store, because Apple does not expose lifetime aggregates over the REST API.',
    'Sales reports are pulled in DAILY frequency only; weekly, monthly, and yearly summaries are not synced.',
    'Subscription, in-app-purchase, and refund line items in the SALES summary report are aggregated into `units` and `proceeds` rather than broken out by product type. Filter by `productTypeIdentifier` on the metric sample attributes if you need to separate them.',
  ],
});

export const cost: ConnectorCost = {
  recommendedInterval: '6 hours',
  minInterval: '1 hour',
  warning:
    'Daily sales reports are only finalized 24-48 hours after the day closes; syncing more often than the recommended interval will not bring fresher revenue data.',
};

export interface AppStoreConnectSettings {
  resources?: readonly AppStoreConnectResource[];
  vendorNumber?: string;
  salesBackfillDays?: number;
  reviewLimit?: number;
}

const appStoreConnectCredentials = {
  issuerId: {
    description: 'App Store Connect API issuer ID',
    auth: 'required' as const,
  },
  keyId: {
    description: 'App Store Connect API key ID',
    auth: 'required' as const,
  },
  privateKey: {
    description: 'App Store Connect API private key (.p8 PEM contents)',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type AppStoreConnectCredentials = typeof appStoreConnectCredentials;

const PHASE_ORDER = [
  'apps',
  'app_installs',
  'app_revenue',
  'app_ratings',
] as const;

type AppStoreConnectPhase = (typeof PHASE_ORDER)[number];

export type AppStoreConnectResource = AppStoreConnectPhase;

const isAppStoreConnectCursor = makeChunkedCursorGuard(PHASE_ORDER);

type AppStoreConnectCursor = ChunkedSyncCursor<AppStoreConnectPhase, string>;

const API_HOST = 'api.appstoreconnect.apple.com';
const API_BASE = `https://${API_HOST}`;
const APPS_PATH = '/v1/apps';
const SALES_REPORTS_PATH = '/v1/salesReports';
const PER_PAGE = 200;
const DEFAULT_SALES_BACKFILL_DAYS = 30;
const DEFAULT_REVIEW_LIMIT = 200;
const SALES_REPORT_DELAY_HOURS = 48;
const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

const APP_ENTITY = 'app_store_connect_app';
const APP_INSTALLS_METRIC = 'app_store_connect_app_installs';
const APP_REVENUE_METRIC = 'app_store_connect_app_revenue';
const APP_RATINGS_METRIC = 'app_store_connect_app_ratings';

interface AppRecord {
  id: string;
  attributes?: {
    name?: string | null;
    bundleId?: string | null;
    sku?: string | null;
    primaryLocale?: string | null;
  } | null;
}

interface ReviewRecord {
  id: string;
  attributes?: {
    rating?: number | null;
    territory?: string | null;
    title?: string | null;
    reviewerNickname?: string | null;
    createdDate?: string | null;
  } | null;
}

const appAttributesSchema = z.object({
  name: z.string().nullish(),
  bundleId: z.string().nullish(),
  sku: z.string().nullish(),
  primaryLocale: z.string().nullish(),
});

const appSchema = z.object({
  id: z.string().min(1),
  type: z.string().optional(),
  attributes: appAttributesSchema.nullish(),
});

const appsResponseSchema = z.object({
  data: z.array(appSchema),
  links: z
    .object({
      next: z.string().nullish(),
    })
    .nullish(),
});

const reviewAttributesSchema = z.object({
  rating: z.number().int().min(1).max(5).nullish(),
  territory: z.string().nullish(),
  title: z.string().nullish(),
  reviewerNickname: z.string().nullish(),
  createdDate: z.string().nullish(),
});

const reviewSchema = z.object({
  id: z.string().min(1),
  type: z.string().optional(),
  attributes: reviewAttributesSchema.nullish(),
});

const reviewsResponseSchema = z.object({
  data: z.array(reviewSchema),
  links: z
    .object({
      next: z.string().nullish(),
    })
    .nullish(),
});

export const appStoreConnectResources = defineResources({
  [APP_ENTITY]: {
    shape: 'entity',
    description:
      'Apps registered in the team, with bundle id, SKU, and primary locale. Synced from /v1/apps.',
    endpoint: 'GET /v1/apps',
    fields: [
      { name: 'name', description: 'App display name.' },
      {
        name: 'bundleId',
        description: 'Bundle identifier, e.g. com.example.app.',
      },
      {
        name: 'sku',
        description: 'App SKU set when the app was registered.',
      },
      {
        name: 'primaryLocale',
        description: 'Primary App Store locale, e.g. en-US.',
      },
    ],
    responses: { apps: appsResponseSchema },
  },
  [APP_INSTALLS_METRIC]: {
    shape: 'metric',
    description:
      'Daily installs (units sold or downloaded) aggregated from the SALES SUMMARY report by (date, app, country code, product type). One sample per (day, app, country, productTypeIdentifier).',
    endpoint: 'GET /v1/salesReports',
    granularity: 'daily',
    notes:
      'Requires a vendor number. Apple delays daily reports by ~24-48 hours; the connector backs off two days from today to avoid empty / partial reports. Reports are gzipped TSV under the hood.',
    dimensions: [
      {
        name: 'appId',
        description:
          'App Store Connect app id (Apple Identifier from the report).',
      },
      {
        name: 'countryCode',
        description: 'Two-letter ISO country code from the sale.',
      },
      {
        name: 'productTypeIdentifier',
        description:
          'Apple product type, e.g. 1 (paid app), 1F (universal app), IA1 (in-app purchase).',
      },
    ],
    responses: { sales_installs_report: z.string() },
  },
  [APP_REVENUE_METRIC]: {
    shape: 'metric',
    description:
      'Daily developer proceeds aggregated from the SALES SUMMARY report by (date, app, country code, product type). Values are summed across rows that share a currency; rows are emitted per currency.',
    endpoint: 'GET /v1/salesReports',
    unit: 'native currency (see currency attribute)',
    granularity: 'daily',
    notes:
      'Proceeds are NOT FX-normalised; each sample carries its native currency in the `currency` attribute. Filter or convert downstream.',
    dimensions: [
      {
        name: 'appId',
        description: 'App Store Connect app id.',
      },
      {
        name: 'countryCode',
        description: 'Two-letter ISO country code from the sale.',
      },
      {
        name: 'currency',
        description:
          'ISO 4217 currency of the proceeds, e.g. USD, EUR, JPY (matches Apple "Currency of Proceeds").',
      },
      {
        name: 'productTypeIdentifier',
        description: 'Apple product type code (same as app_installs).',
      },
    ],
    responses: { sales_revenue_report: z.string() },
  },
  [APP_RATINGS_METRIC]: {
    shape: 'metric',
    description:
      'Rolling per-review ratings sampled from the most-recent N customer reviews per app (default 200). Each sample carries one review with the rating (1-5) as the value and the territory on the attribute.',
    endpoint: 'GET /v1/apps/{id}/customerReviews',
    notes:
      'Apple does NOT expose the lifetime average rating over the REST API. Average over a time window downstream to get a rolling rating.',
    dimensions: [
      {
        name: 'appId',
        description: 'App Store Connect app id.',
      },
      {
        name: 'territory',
        description: 'Two-letter ISO country code where the review was filed.',
      },
    ],
    responses: { customer_reviews: reviewsResponseSchema },
  },
});

export const id = 'app-store-connect';

export class AppStoreConnectConnector extends BaseConnector<
  AppStoreConnectSettings,
  AppStoreConnectCredentials
> {
  static readonly id = id;

  static readonly resources = appStoreConnectResources;

  static readonly schemas = schemasFromResources(appStoreConnectResources);

  static readonly cost = cost;

  static create(
    input: unknown,
    ctx?: ConnectorContext,
  ): AppStoreConnectConnector {
    const parsed = configFields.parse(input);
    return new AppStoreConnectConnector(
      {
        resources: parsed.resources,
        vendorNumber: parsed.vendorNumber,
        salesBackfillDays: parsed.salesBackfillDays,
        reviewLimit: parsed.reviewLimit,
      },
      {
        issuerId: parsed.issuerId,
        keyId: parsed.keyId,
        privateKey: parsed.privateKey,
      },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = appStoreConnectCredentials;

  private cachedJwt: { token: string; expiresAt: number } | null = null;
  private cachedAppIds: string[] | null = null;

  private async buildAuthHeader(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cachedJwt && this.cachedJwt.expiresAt > now + 60) {
      return `Bearer ${this.cachedJwt.token}`;
    }
    const { issuerId, keyId, privateKey } = this.creds;
    if (!issuerId || !keyId || !privateKey) {
      throw new AuthError(`${this.id}: missing App Store Connect credentials`);
    }
    const exp = now + 900;
    const jwt = await signES256Jwt({
      header: { alg: 'ES256', kid: keyId, typ: 'JWT' },
      payload: {
        iss: issuerId,
        iat: now,
        exp,
        aud: 'appstoreconnect-v1',
      },
      privateKeyPem: privateKey,
    });
    this.cachedJwt = { token: jwt, expiresAt: exp };
    return `Bearer ${jwt}`;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    return {
      Authorization: await this.buildAuthHeader(),
      Accept: 'application/json',
      'User-Agent': connectorUserAgent(this.id),
    };
  }

  private sanitizeListUrl(
    phase: AppStoreConnectPhase,
    pageUrl: string | null,
  ): string | null {
    const allowedPath = phase === 'apps' ? APPS_PATH : null;
    if (allowedPath === null) {
      return null;
    }
    return sanitizeAllowedUrl({
      url: pageUrl,
      host: API_HOST,
      pathname: allowedPath,
    });
  }

  private resolveCursor(cursor: unknown): AppStoreConnectCursor | undefined {
    if (!isAppStoreConnectCursor(cursor)) {
      return undefined;
    }
    if (cursor.phase === 'apps') {
      return {
        phase: cursor.phase,
        page: this.sanitizeListUrl(cursor.phase, cursor.page),
      };
    }
    return { phase: cursor.phase, page: null };
  }

  private async listApps(signal?: AbortSignal): Promise<string[]> {
    if (this.cachedAppIds !== null) {
      return this.cachedAppIds;
    }
    const ids: string[] = [];
    let url: string | null = `${API_BASE}${APPS_PATH}?limit=${PER_PAGE}`;
    while (url !== null) {
      if (signal?.aborted) {
        return ids;
      }
      const headers = await this.authHeaders();
      const res = await this.get<z.infer<typeof appsResponseSchema>>(url, {
        resource: 'apps',
        headers,
        signal,
      });
      for (const app of res.body.data ?? []) {
        ids.push(app.id);
      }
      const next = res.body.links?.next ?? null;
      url = this.sanitizeListUrl('apps', next);
    }
    this.cachedAppIds = ids;
    return ids;
  }

  private async fetchAppsPage(
    page: string | null,
    signal?: AbortSignal,
  ): Promise<FetchPageResult<string>> {
    const url = page ?? `${API_BASE}${APPS_PATH}?limit=${PER_PAGE}`;
    const headers = await this.authHeaders();
    const res = await this.get<z.infer<typeof appsResponseSchema>>(url, {
      resource: 'apps',
      headers,
      signal,
    });
    const items = res.body.data ?? [];
    if (this.cachedAppIds === null) {
      this.cachedAppIds = [];
    }
    for (const app of items) {
      if (!this.cachedAppIds.includes(app.id)) {
        this.cachedAppIds.push(app.id);
      }
    }
    const rawNext = res.body.links?.next ?? null;
    const next = this.sanitizeListUrl('apps', rawNext);
    return { items, next };
  }

  private buildSalesReportUrl(reportDate: string): string {
    const vendor = this.settings.vendorNumber;
    if (!vendor) {
      throw new Error(
        'vendorNumber is required for app_installs / app_revenue resources',
      );
    }
    const params = new URLSearchParams();
    params.set('filter[frequency]', 'DAILY');
    params.set('filter[reportType]', 'SALES');
    params.set('filter[reportSubType]', 'SUMMARY');
    params.set('filter[vendorNumber]', vendor);
    params.set('filter[reportDate]', reportDate);
    return `${API_BASE}${SALES_REPORTS_PATH}?${params.toString()}`;
  }

  private async fetchSalesReportTsv(
    reportDate: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const url = this.buildSalesReportUrl(reportDate);
    const headers = await this.authHeaders();
    headers['Accept'] = 'application/a-gzip';

    const res = await globalThis.fetch(url, {
      method: 'GET',
      headers,
      signal,
    });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(
        `App Store Connect sales report ${reportDate} failed: HTTP ${res.status}`,
      );
    }
    const body = res.body;
    if (!body) {
      return null;
    }
    const decompressed = body.pipeThrough(new DecompressionStream('gzip'));
    return await new Response(decompressed).text();
  }

  private async fetchReviewsForApp(
    appId: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<ReviewRecord[]> {
    const reviews: ReviewRecord[] = [];
    const reviewsBase = `/v1/apps/${encodeURIComponent(appId)}/customerReviews`;
    let url: string | null =
      `${API_BASE}${reviewsBase}?limit=${PER_PAGE}&sort=-createdDate`;
    while (url !== null && reviews.length < limit) {
      if (signal?.aborted) {
        return reviews;
      }
      const headers = await this.authHeaders();
      const res = await this.get<z.infer<typeof reviewsResponseSchema>>(url, {
        resource: 'customer_reviews',
        headers,
        signal,
      });
      for (const review of res.body.data ?? []) {
        reviews.push(review);
        if (reviews.length >= limit) {
          break;
        }
      }
      const rawNext = res.body.links?.next ?? null;
      url = sanitizeAllowedUrl({
        url: rawNext,
        host: API_HOST,
        pathname: reviewsBase,
      });
    }
    return reviews;
  }

  private async writeApps(
    storage: StorageHandle,
    items: AppRecord[],
  ): Promise<void> {
    const nowMs = Date.now();
    for (const app of items) {
      const attrs = app.attributes ?? {};
      await storage.entity({
        type: APP_ENTITY,
        id: app.id,
        attributes: {
          name: attrs.name ?? null,
          bundleId: attrs.bundleId ?? null,
          sku: attrs.sku ?? null,
          primaryLocale: attrs.primaryLocale ?? null,
        },
        updated_at: nowMs,
      });
    }
  }

  private async syncSalesReports(
    storage: StorageHandle,
    metricName: typeof APP_INSTALLS_METRIC | typeof APP_REVENUE_METRIC,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!this.settings.vendorNumber) {
      this.logger.info('skipping sales report (no vendorNumber configured)', {
        resource: metricName,
      });
      await storage.metrics([], { names: [metricName] });
      return;
    }
    const dates = computeSalesReportDates(options, this.settings);
    const samples: MetricSample[] = [];
    for (const reportDate of dates) {
      if (signal?.aborted) {
        return;
      }
      let tsv: string | null;
      try {
        tsv = await this.fetchSalesReportTsv(reportDate, signal);
      } catch (err) {
        this.logger.warn('sales report fetch failed', {
          reportDate,
          resource: metricName,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      if (tsv === null || tsv.length === 0) {
        continue;
      }
      for (const sample of parseSalesReportTsv(tsv, metricName)) {
        samples.push(sample);
      }
    }
    await storage.metrics(samples, { names: [metricName] });
  }

  private async syncAppRatings(
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<void> {
    const appIds = await this.listApps(signal);
    const limit = this.settings.reviewLimit ?? DEFAULT_REVIEW_LIMIT;
    const samples: MetricSample[] = [];
    for (const appId of appIds) {
      if (signal?.aborted) {
        return;
      }
      const reviews = await this.fetchReviewsForApp(appId, limit, signal);
      for (const review of reviews) {
        const attrs = review.attributes ?? {};
        if (typeof attrs.rating !== 'number') {
          continue;
        }
        const ts = isoToMs(attrs.createdDate);
        if (ts === null) {
          continue;
        }
        const attributes: Record<string, JSONValue> = {
          appId,
          reviewId: review.id,
          territory: attrs.territory ?? null,
          title: attrs.title ?? null,
          reviewerNickname: attrs.reviewerNickname ?? null,
        };
        samples.push({
          name: APP_RATINGS_METRIC,
          ts,
          value: attrs.rating,
          attributes,
        });
      }
    }
    await storage.metrics(samples, { names: [APP_RATINGS_METRIC] });
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = this.resolveCursor(options.cursor);
    const isFull = options.mode === 'full';
    const phases = selectActivePhases<
      AppStoreConnectResource,
      AppStoreConnectPhase
    >((r) => r, PHASE_ORDER, this.settings.resources);

    return paginateChunked<AppStoreConnectPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        if (phase === 'apps') {
          return this.fetchAppsPage(page, sig);
        }
        return { items: [{ phase }], next: null };
      },
      writeBatch: async (phase, items, page) => {
        if (phase === 'apps') {
          if (page === null && isFull) {
            await storage.entities([], { types: [APP_ENTITY] });
          }
          await this.writeApps(storage, items as AppRecord[]);
          return;
        }
        if (phase === 'app_installs') {
          await this.syncSalesReports(
            storage,
            APP_INSTALLS_METRIC,
            options,
            signal,
          );
          return;
        }
        if (phase === 'app_revenue') {
          await this.syncSalesReports(
            storage,
            APP_REVENUE_METRIC,
            options,
            signal,
          );
          return;
        }
        if (phase === 'app_ratings') {
          await this.syncAppRatings(storage, signal);
          return;
        }
      },
    });
  }
}

function isoToMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toIsoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(
    d.getUTCDate(),
  )}`;
}

function parseSalesDate(value: string): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(value);
  if (m) {
    const month = Number(m[1]!);
    const day = Number(m[2]!);
    const year = Number(m[3]!);
    const ms = Date.UTC(year, month - 1, day);
    return Number.isFinite(ms) ? ms : null;
  }
  const direct = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(direct) ? direct : null;
}

export function computeSalesReportDates(
  options: SyncOptions,
  settings: AppStoreConnectSettings,
): string[] {
  const now = Date.now();
  const endMs = now - SALES_REPORT_DELAY_HOURS * MS_PER_HOUR;
  let startMs: number;
  if (options.since) {
    const sinceMs = Date.parse(options.since);
    startMs = Number.isFinite(sinceMs) ? sinceMs : endMs - MS_PER_DAY;
  } else if (options.mode === 'latest') {
    startMs = endMs - 2 * MS_PER_DAY;
  } else {
    const days = settings.salesBackfillDays ?? DEFAULT_SALES_BACKFILL_DAYS;
    startMs = endMs - days * MS_PER_DAY;
  }
  if (startMs > endMs) {
    return [];
  }
  const dates: string[] = [];
  const start = new Date(Math.floor(startMs / MS_PER_DAY) * MS_PER_DAY);
  const end = new Date(Math.floor(endMs / MS_PER_DAY) * MS_PER_DAY);
  for (
    let d = new Date(start.getTime());
    d.getTime() <= end.getTime();
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    dates.push(toIsoDate(d));
  }
  return dates;
}

export function parseSalesReportTsv(
  tsv: string,
  metricName: typeof APP_INSTALLS_METRIC | typeof APP_REVENUE_METRIC,
): MetricSample[] {
  const lines = tsv.split(/\r?\n/u).filter((l) => l.length > 0);
  if (lines.length < 2) {
    return [];
  }
  const header = lines[0]!.split('\t').map((h) => h.trim());
  const idx = (name: string): number => header.indexOf(name);

  const beginDateIdx = idx('Begin Date');
  const unitsIdx = idx('Units');
  const proceedsIdx = idx('Developer Proceeds');
  const countryIdx = idx('Country Code');
  const appleIdIdx = idx('Apple Identifier');
  const currencyIdx = idx('Currency of Proceeds');
  const productTypeIdx = idx('Product Type Identifier');

  if (
    beginDateIdx === -1 ||
    appleIdIdx === -1 ||
    countryIdx === -1 ||
    (metricName === APP_INSTALLS_METRIC && unitsIdx === -1) ||
    (metricName === APP_REVENUE_METRIC &&
      (proceedsIdx === -1 || currencyIdx === -1))
  ) {
    return [];
  }

  const samples: MetricSample[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i]!.split('\t');
    const ts = parseSalesDate(row[beginDateIdx]?.trim() ?? '');
    if (ts === null) {
      continue;
    }
    const appId = row[appleIdIdx]?.trim() ?? '';
    if (appId === '') {
      continue;
    }
    const countryCode = row[countryIdx]?.trim() ?? '';
    const productType =
      productTypeIdx === -1 ? '' : (row[productTypeIdx]?.trim() ?? '');

    if (metricName === APP_INSTALLS_METRIC) {
      const raw = row[unitsIdx]?.trim() ?? '';
      const value = Number.parseFloat(raw);
      if (!Number.isFinite(value)) {
        continue;
      }
      const attributes: Record<string, JSONValue> = {
        appId,
        countryCode,
        productTypeIdentifier: productType,
      };
      samples.push({ name: metricName, ts, value, attributes });
    } else {
      const raw = row[proceedsIdx]?.trim() ?? '';
      const value = Number.parseFloat(raw);
      if (!Number.isFinite(value)) {
        continue;
      }
      const currency = row[currencyIdx]?.trim() ?? '';
      const attributes: Record<string, JSONValue> = {
        appId,
        countryCode,
        currency,
        productTypeIdentifier: productType,
      };
      samples.push({ name: metricName, ts, value, attributes });
    }
  }
  return samples;
}

interface JwtHeader {
  alg: 'ES256';
  kid: string;
  typ: 'JWT';
}

interface JwtPayload {
  iss: string;
  iat: number;
  exp: number;
  aud: string;
}

export async function signES256Jwt({
  header,
  payload,
  privateKeyPem,
}: {
  header: JwtHeader;
  payload: JwtPayload;
  privateKeyPem: string;
}): Promise<string> {
  const encoder = new TextEncoder();
  const headerB64 = base64urlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64urlEncode(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await importEcPrivateKey(privateKeyPem);
  const signature = await globalThis.crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    encoder.encode(signingInput),
  );
  return `${signingInput}.${base64urlEncode(new Uint8Array(signature))}`;
}

async function importEcPrivateKey(pem: string): Promise<CryptoKey> {
  const trimmed = pem.trim();
  const body = trimmed
    .replace(/-----BEGIN PRIVATE KEY-----/u, '')
    .replace(/-----END PRIVATE KEY-----/u, '')
    .replace(/\s+/gu, '');
  if (body.length === 0) {
    throw new AuthError(
      'app-store-connect: privateKey is empty or not a PEM-encoded PKCS#8 key',
    );
  }
  const der = base64ToBytes(body);
  return globalThis.crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary)
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '');
}
