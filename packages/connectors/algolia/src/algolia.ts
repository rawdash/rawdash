import {
  type HttpResponse,
  connectorUserAgent,
  parseEpoch,
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
  metricSample,
  schemasFromResources,
  selectActivePhases,
} from '@rawdash/core';
import { z } from 'zod';

const MS_PER_DAY = 86_400_000;
const DEFAULT_LOOKBACK_DAYS = 30;
const INCREMENTAL_LOOKBACK_DAYS = 2;
const DEFAULT_TOP_QUERIES_LIMIT = 20;

const ANALYTICS_HOST_BY_REGION = {
  us: 'analytics.us.algolia.com',
  de: 'analytics.de.algolia.com',
} as const;

type AlgoliaRegion = keyof typeof ANALYTICS_HOST_BY_REGION;

export const configFields = defineConfigFields(
  z.object({
    appId: z.string().trim().min(1).meta({
      label: 'Application ID',
      description:
        'Algolia Application ID, found under Settings -> API Keys in the Algolia dashboard.',
      placeholder: 'YourApplicationID',
    }),
    apiKey: z.object({ $secret: z.string().min(1) }).meta({
      label: 'Analytics API key',
      description:
        'An Algolia API key with the analytics ACL (read-only is sufficient). Do not use the admin key. Create a dedicated key under Settings -> API Keys.',
      placeholder: 'ALGOLIA_ANALYTICS_API_KEY',
      secret: true,
    }),
    indexes: z.array(z.string().trim().min(1)).nonempty().meta({
      label: 'Indexes',
      description:
        'One or more Algolia index names to pull analytics for. Each index is reported as its own dimension so a single dashboard can compare them.',
    }),
    region: z.enum(['us', 'de']).optional().meta({
      label: 'Analytics region',
      description:
        'Which Algolia analytics region hosts your application: "us" (analytics.us.algolia.com) or "de" (analytics.de.algolia.com). Defaults to "us".',
      placeholder: 'us',
    }),
    resources: z
      .array(
        z.enum([
          'algolia_search_count',
          'algolia_click_through_rate',
          'algolia_no_results_rate',
          'algolia_average_click_position',
          'algolia_top_queries',
          'algolia_no_result_queries',
        ]),
      )
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Algolia analytics series to sync. Omit to sync all of them.',
      }),
    lookbackDays: z.number().int().positive().max(365).optional().meta({
      label: 'Backfill window (days)',
      description:
        'How many days of analytics history to fetch on a full sync. Defaults to 30. Note: analytics retention depends on your Algolia plan, so older days may return empty.',
      placeholder: '30',
    }),
    topQueriesLimit: z.number().int().positive().max(1000).optional().meta({
      label: 'Top queries limit',
      description:
        'How many rows to keep for the top-queries and no-result-queries series. Defaults to 20.',
      placeholder: '20',
    }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Algolia',
  category: 'product',
  brandColor: '#003DFF',
  tagline:
    'Track Algolia site search health - daily search volume, click-through rate, no-result rate, average click position, and top / no-result queries per index.',
  vendor: {
    name: 'Algolia',
    domain: 'algolia.com',
    apiDocs: 'https://www.algolia.com/doc/rest-api/analytics/',
    website: 'https://www.algolia.com',
  },
  auth: {
    summary:
      'Authenticates with an Algolia Application ID and an API key that carries the analytics ACL. A read-only analytics key is sufficient; the admin key should not be used.',
    setup: [
      'Open the Algolia dashboard -> Settings -> API Keys and note your Application ID.',
      'Create a new API key restricted to the analytics ACL (optionally scoped to the indexes you want to report on). Store it as a secret (e.g. ALGOLIA_ANALYTICS_API_KEY).',
      'Reference it from config as `apiKey: secret("ALGOLIA_ANALYTICS_API_KEY")` together with `appId` and the list of `indexes` to sync.',
      'If your application is hosted in the EU analytics region, set `region: "de"`.',
    ],
  },
  rateLimit:
    'The Analytics API is rate limited per application; 429 responses are retried automatically with exponential backoff by the shared HTTP client.',
  limitations: [
    'Click-through rate and average click position require Click & Conversion Analytics to be enabled on the index; without it those series return empty or zero.',
    'Top-queries and no-result-queries are aggregated over the whole sync window and stamped at the last day of the window, not per calendar day.',
    'Per-query click-through rate is not exposed by the top-searches endpoint, so the top-queries series carries search count and result count (nbHits) only.',
    'Analytics data retention depends on your Algolia plan; requesting a lookback window longer than your retention returns empty days.',
  ],
});

const PHASE_ORDER = [
  'algolia_search_count',
  'algolia_click_through_rate',
  'algolia_no_results_rate',
  'algolia_average_click_position',
  'algolia_top_queries',
  'algolia_no_result_queries',
] as const;

export type AlgoliaResource = (typeof PHASE_ORDER)[number];

const isAlgoliaSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const PHASE_ENDPOINT_PATH: Record<AlgoliaResource, string> = {
  algolia_search_count: '/2/searches/count',
  algolia_click_through_rate: '/2/clicks/clickThroughRate',
  algolia_no_results_rate: '/2/searches/noResultRate',
  algolia_average_click_position: '/2/clicks/averageClickPosition',
  algolia_top_queries: '/2/searches',
  algolia_no_result_queries: '/2/searches/noResults',
};

const searchesCountSchema = z.object({
  count: z.number().nullish(),
  dates: z.array(
    z.object({
      date: z.string(),
      count: z.number(),
    }),
  ),
});

const clickThroughRateSchema = z.object({
  rate: z.number().nullish(),
  clickCount: z.number().nullish(),
  trackedSearchCount: z.number().nullish(),
  dates: z.array(
    z.object({
      date: z.string(),
      rate: z.number().nullable(),
      clickCount: z.number(),
      trackedSearchCount: z.number(),
    }),
  ),
});

const noResultsRateSchema = z.object({
  rate: z.number().nullish(),
  count: z.number().nullish(),
  noResultCount: z.number().nullish(),
  dates: z.array(
    z.object({
      date: z.string(),
      rate: z.number().nullable(),
      count: z.number(),
      noResultCount: z.number(),
    }),
  ),
});

const averageClickPositionSchema = z.object({
  average: z.number().nullish(),
  clickCount: z.number().nullish(),
  dates: z.array(
    z.object({
      date: z.string(),
      average: z.number().nullable(),
      clickCount: z.number(),
    }),
  ),
});

const topSearchesSchema = z.object({
  searches: z.array(
    z.object({
      search: z.string(),
      count: z.number(),
      nbHits: z.number().nullish(),
    }),
  ),
});

const noResultSearchesSchema = z.object({
  searches: z.array(
    z.object({
      search: z.string(),
      count: z.number(),
      withFilterCount: z.number().nullish(),
    }),
  ),
});

type SearchesCountResponse = z.infer<typeof searchesCountSchema>;
type ClickThroughRateResponse = z.infer<typeof clickThroughRateSchema>;
type NoResultsRateResponse = z.infer<typeof noResultsRateSchema>;
type AverageClickPositionResponse = z.infer<typeof averageClickPositionSchema>;
type TopSearchesResponse = z.infer<typeof topSearchesSchema>;
type NoResultSearchesResponse = z.infer<typeof noResultSearchesSchema>;

const INDEX_DIMENSION = {
  name: 'index',
  description: 'Algolia index the analytics sample belongs to.',
} as const;

const QUERY_DIMENSION = {
  name: 'query',
  description: 'Search term entered by end users.',
} as const;

export const algoliaResources = defineResources({
  algolia_search_count: {
    shape: 'metric',
    description:
      'Daily number of searches performed against the index, from the Algolia Analytics API.',
    endpoint: 'GET /2/searches/count',
    unit: 'searches',
    granularity: 'daily',
    dimensions: [INDEX_DIMENSION],
    responses: { searches_count: searchesCountSchema },
  },
  algolia_click_through_rate: {
    shape: 'metric',
    description:
      'Daily click-through rate (fraction of tracked searches that led to a click) for the index. Requires Click Analytics to be enabled.',
    endpoint: 'GET /2/clicks/clickThroughRate',
    unit: 'rate',
    granularity: 'daily',
    dimensions: [INDEX_DIMENSION],
    measures: [
      {
        name: 'click_count',
        description: 'Number of clicks recorded on the day.',
      },
      {
        name: 'tracked_search_count',
        description: 'Number of searches with click tracking on the day.',
      },
    ],
    notes:
      'Sample value is the daily rate in [0, 1]. Click Analytics must be enabled on the index or the series is empty.',
    responses: { click_through_rate: clickThroughRateSchema },
  },
  algolia_no_results_rate: {
    shape: 'metric',
    description:
      'Daily no-result rate (fraction of searches that returned zero hits) for the index.',
    endpoint: 'GET /2/searches/noResultRate',
    unit: 'rate',
    granularity: 'daily',
    dimensions: [INDEX_DIMENSION],
    measures: [
      {
        name: 'search_count',
        description: 'Total number of searches on the day.',
      },
      {
        name: 'no_result_count',
        description: 'Number of searches that returned no results on the day.',
      },
    ],
    notes: 'Sample value is the daily rate in [0, 1].',
    responses: { no_results_rate: noResultsRateSchema },
  },
  algolia_average_click_position: {
    shape: 'metric',
    description:
      'Daily average position of clicked results (1-based) for the index. Requires Click Analytics to be enabled.',
    endpoint: 'GET /2/clicks/averageClickPosition',
    unit: 'position',
    granularity: 'daily',
    dimensions: [INDEX_DIMENSION],
    measures: [
      {
        name: 'click_count',
        description: 'Number of clicks the average is computed over.',
      },
    ],
    notes:
      'Days with no clicks report a null average from Algolia and are skipped rather than written as 0.',
    responses: { average_click_position: averageClickPositionSchema },
  },
  algolia_top_queries: {
    shape: 'metric',
    description:
      'Most frequent search queries over the sync window, with their search count and result count, for the index.',
    endpoint: 'GET /2/searches',
    unit: 'searches',
    granularity: 'daily',
    dimensions: [INDEX_DIMENSION, QUERY_DIMENSION],
    measures: [
      {
        name: 'nb_hits',
        description: 'Number of results the query returned.',
      },
    ],
    notes:
      'Aggregated over the sync window and stamped at the last day of the window. Sample value is the search count for the query.',
    responses: { top_searches: topSearchesSchema },
  },
  algolia_no_result_queries: {
    shape: 'metric',
    description:
      'Most frequent search queries that returned zero results over the sync window, for the index.',
    endpoint: 'GET /2/searches/noResults',
    unit: 'searches',
    granularity: 'daily',
    dimensions: [INDEX_DIMENSION, QUERY_DIMENSION],
    measures: [
      {
        name: 'with_filter_count',
        description:
          'Number of those no-result searches that also carried a filter.',
      },
    ],
    notes:
      'Aggregated over the sync window and stamped at the last day of the window. Sample value is the no-result count for the query.',
    responses: { no_result_searches: noResultSearchesSchema },
  },
});

export interface AlgoliaSettings {
  appId: string;
  indexes: readonly string[];
  region?: AlgoliaRegion;
  resources?: readonly AlgoliaResource[];
  lookbackDays?: number;
  topQueriesLimit?: number;
}

const algoliaCredentials = {
  apiKey: {
    description: 'Algolia API key with the analytics ACL',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type AlgoliaCredentials = typeof algoliaCredentials;

export const id = 'algolia';

interface AnalyticsWindow {
  startDate: string;
  endDate: string;
  startMs: number;
  endMs: number;
  endDayMs: number;
}

function toDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function getAnalyticsWindow(
  options: SyncOptions,
  lookbackDays: number,
  now: number = Date.now(),
): AnalyticsWindow {
  const todayStart = Math.floor(now / MS_PER_DAY) * MS_PER_DAY;

  let days = lookbackDays;
  if (options.mode === 'latest') {
    days = INCREMENTAL_LOOKBACK_DAYS;
  } else if (options.since !== undefined) {
    const sinceMs = parseEpoch(options.since, 'iso');
    if (sinceMs !== null) {
      const elapsed = Math.ceil((now - sinceMs) / MS_PER_DAY);
      days = Math.min(
        Math.max(elapsed + INCREMENTAL_LOOKBACK_DAYS, 1),
        lookbackDays,
      );
    }
  }

  const startMs = todayStart - (days - 1) * MS_PER_DAY;
  return {
    startDate: toDateString(startMs),
    endDate: toDateString(todayStart),
    startMs,
    endMs: todayStart + MS_PER_DAY - 1,
    endDayMs: todayStart,
  };
}

function dailySamples<Row extends { date: string }, K extends AlgoliaResource>(
  resource: K,
  index: string,
  dates: readonly Row[],
  toValue: (row: Row) => number | null,
  toMeasures: (row: Row) => Record<string, number>,
): MetricSample[] {
  const samples: MetricSample[] = [];
  for (const row of dates) {
    const ts = parseEpoch(row.date, 'iso');
    if (ts === null) {
      continue;
    }
    const value = toValue(row);
    if (value === null || !Number.isFinite(value)) {
      continue;
    }
    samples.push({
      name: resource,
      ts,
      value,
      attributes: { index, ...toMeasures(row) },
    });
  }
  return samples;
}

export function buildSearchCountSamples(
  index: string,
  body: SearchesCountResponse,
): MetricSample[] {
  return dailySamples(
    'algolia_search_count',
    index,
    body.dates,
    (row: SearchesCountResponse['dates'][number]) => row.count,
    () => ({}),
  );
}

export function buildClickThroughRateSamples(
  index: string,
  body: ClickThroughRateResponse,
): MetricSample[] {
  return dailySamples(
    'algolia_click_through_rate',
    index,
    body.dates,
    (row: ClickThroughRateResponse['dates'][number]) => row.rate,
    (row: ClickThroughRateResponse['dates'][number]) => ({
      click_count: row.clickCount,
      tracked_search_count: row.trackedSearchCount,
    }),
  );
}

export function buildNoResultsRateSamples(
  index: string,
  body: NoResultsRateResponse,
): MetricSample[] {
  return dailySamples(
    'algolia_no_results_rate',
    index,
    body.dates,
    (row: NoResultsRateResponse['dates'][number]) => row.rate,
    (row: NoResultsRateResponse['dates'][number]) => ({
      search_count: row.count,
      no_result_count: row.noResultCount,
    }),
  );
}

export function buildAverageClickPositionSamples(
  index: string,
  body: AverageClickPositionResponse,
): MetricSample[] {
  return dailySamples(
    'algolia_average_click_position',
    index,
    body.dates,
    (row: AverageClickPositionResponse['dates'][number]) => row.average,
    (row: AverageClickPositionResponse['dates'][number]) => ({
      click_count: row.clickCount,
    }),
  );
}

export function buildTopQueriesSamples(
  index: string,
  ts: number,
  body: TopSearchesResponse,
): MetricSample[] {
  return body.searches.map((row) =>
    metricSample(algoliaResources, 'algolia_top_queries', {
      ts,
      value: row.count,
      attributes: {
        index,
        query: row.search,
        nb_hits: row.nbHits ?? 0,
      },
    }),
  );
}

export function buildNoResultQueriesSamples(
  index: string,
  ts: number,
  body: NoResultSearchesResponse,
): MetricSample[] {
  return body.searches.map((row) =>
    metricSample(algoliaResources, 'algolia_no_result_queries', {
      ts,
      value: row.count,
      attributes: {
        index,
        query: row.search,
        with_filter_count: row.withFilterCount ?? 0,
      },
    }),
  );
}

export class AlgoliaConnector extends BaseConnector<
  AlgoliaSettings,
  AlgoliaCredentials
> {
  static readonly id = id;

  static readonly resources = algoliaResources;

  static readonly schemas = schemasFromResources(algoliaResources);

  static create(input: unknown, ctx?: ConnectorContext): AlgoliaConnector {
    const parsed = configFields.parse(input);
    return new AlgoliaConnector(
      {
        appId: parsed.appId,
        indexes: parsed.indexes,
        region: parsed.region,
        resources: parsed.resources,
        lookbackDays: parsed.lookbackDays,
        topQueriesLimit: parsed.topQueriesLimit,
      },
      { apiKey: parsed.apiKey },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = algoliaCredentials;

  private get baseUrl(): string {
    const host = ANALYTICS_HOST_BY_REGION[this.settings.region ?? 'us'];
    return `https://${host}`;
  }

  private buildHeaders(): Record<string, string> {
    return {
      'X-Algolia-Application-Id': this.settings.appId,
      'X-Algolia-API-Key': String(this.creds.apiKey),
      'User-Agent': connectorUserAgent(this.id),
    };
  }

  private buildUrl(
    phase: AlgoliaResource,
    index: string,
    window: AnalyticsWindow,
  ): string {
    const url = new URL(`${this.baseUrl}${PHASE_ENDPOINT_PATH[phase]}`);
    url.searchParams.set('index', index);
    url.searchParams.set('startDate', window.startDate);
    url.searchParams.set('endDate', window.endDate);
    if (
      phase === 'algolia_top_queries' ||
      phase === 'algolia_no_result_queries'
    ) {
      const limit = this.settings.topQueriesLimit ?? DEFAULT_TOP_QUERIES_LIMIT;
      url.searchParams.set('limit', String(limit));
    }
    return url.toString();
  }

  private async fetchPhase<T>(
    phase: AlgoliaResource,
    index: string,
    schema: z.ZodType<T>,
    window: AnalyticsWindow,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    const url = this.buildUrl(phase, index, window);
    const res: HttpResponse<unknown> = await this.get<unknown>(url, {
      resource: phase,
      headers: this.buildHeaders(),
      signal,
    });
    return schema.parse(res.body);
  }

  private async collectPhaseSamples(
    phase: AlgoliaResource,
    index: string,
    window: AnalyticsWindow,
    signal: AbortSignal | undefined,
  ): Promise<MetricSample[]> {
    switch (phase) {
      case 'algolia_search_count':
        return buildSearchCountSamples(
          index,
          await this.fetchPhase(
            phase,
            index,
            searchesCountSchema,
            window,
            signal,
          ),
        );
      case 'algolia_click_through_rate':
        return buildClickThroughRateSamples(
          index,
          await this.fetchPhase(
            phase,
            index,
            clickThroughRateSchema,
            window,
            signal,
          ),
        );
      case 'algolia_no_results_rate':
        return buildNoResultsRateSamples(
          index,
          await this.fetchPhase(
            phase,
            index,
            noResultsRateSchema,
            window,
            signal,
          ),
        );
      case 'algolia_average_click_position':
        return buildAverageClickPositionSamples(
          index,
          await this.fetchPhase(
            phase,
            index,
            averageClickPositionSchema,
            window,
            signal,
          ),
        );
      case 'algolia_top_queries':
        return buildTopQueriesSamples(
          index,
          window.endDayMs,
          await this.fetchPhase(
            phase,
            index,
            topSearchesSchema,
            window,
            signal,
          ),
        );
      case 'algolia_no_result_queries':
        return buildNoResultQueriesSamples(
          index,
          window.endDayMs,
          await this.fetchPhase(
            phase,
            index,
            noResultSearchesSchema,
            window,
            signal,
          ),
        );
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = isAlgoliaSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const lookbackDays = this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const window = getAnalyticsWindow(options, lookbackDays);
    const replaceWindow = { start: window.startMs, end: window.endMs };

    const phases = selectActivePhases<AlgoliaResource, AlgoliaResource>(
      (resource) => resource,
      PHASE_ORDER,
      this.settings.resources,
    );

    const startIdx = cursor ? phases.indexOf(cursor.phase) : 0;
    const resumeIdx = startIdx >= 0 ? startIdx : 0;

    for (let i = resumeIdx; i < phases.length; i++) {
      const phase = phases[i]!;
      if (signal?.aborted) {
        return { done: false, cursor: { phase, page: null } };
      }
      const phaseStart = Date.now();
      const samples: MetricSample[] = [];
      for (const index of this.settings.indexes) {
        if (signal?.aborted) {
          return { done: false, cursor: { phase, page: null } };
        }
        samples.push(
          ...(await this.collectPhaseSamples(phase, index, window, signal)),
        );
      }
      await storage.metrics(samples, { names: [phase], replaceWindow });
      this.logger.info('resource done', {
        resource: phase,
        indexes: this.settings.indexes.length,
        items: samples.length,
        duration_ms: Date.now() - phaseStart,
      });
    }

    return { done: true };
  }
}
