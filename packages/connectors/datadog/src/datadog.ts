import {
  type HttpResponse,
  connectorUserAgent,
  parseEpoch,
  sanitizeAllowedUrl,
  standardRateLimitPolicy,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ChunkedSyncCursor,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
  type Entity,
  type JSONValue,
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

// ---------------------------------------------------------------------------
// configFields
// ---------------------------------------------------------------------------

const metricQuerySchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_]+$/, {
      message: 'Metric name must be alphanumeric / underscore',
    }),
  query: z.string().min(1),
  interval: z
    .enum(['5m', '15m', '1h', '1d'])
    .optional()
    .describe('Aggregation interval - defaults to 1h.'),
});

const datadogSiteSchema = z
  .string()
  .trim()
  .min(1)
  .toLowerCase()
  .regex(/^(?:[a-z0-9-]+\.)*(?:datadoghq\.com|datadoghq\.eu|ddog-gov\.com)$/, {
    message:
      'Site must be a Datadog hostname (e.g. datadoghq.com, datadoghq.eu, us3.datadoghq.com)',
  });

export const configFields = defineConfigFields(
  z.object({
    apiKey: z.object({ $secret: z.string().min(1) }).meta({
      label: 'API Key',
      description:
        'Datadog API key. Create at Datadog → Organization Settings → API Keys.',
      placeholder: 'dd_api_key',
      secret: true,
    }),
    appKey: z.object({ $secret: z.string().min(1) }).meta({
      label: 'Application Key',
      description:
        'Datadog Application key. Create at Datadog → Organization Settings → Application Keys. Used in tandem with the API key to authenticate REST calls.',
      placeholder: 'dd_app_key',
      secret: true,
    }),
    site: datadogSiteSchema.optional().meta({
      label: 'Site',
      description:
        'Datadog site host (e.g. `datadoghq.com`, `datadoghq.eu`, `us3.datadoghq.com`). Defaults to `datadoghq.com`.',
      placeholder: 'datadoghq.com',
    }),
    metricQueries: z.array(metricQuerySchema).nonempty().optional().meta({
      label: 'Metric queries (optional)',
      description:
        'User-declared metric timeseries queries. Each entry produces `datadog_metric` samples named `<name>` from the Datadog Metrics Query API.',
    }),
    resources: z
      .array(
        z.enum([
          'monitors',
          'monitor_events',
          'incidents',
          'slos',
          'metric_queries',
        ]),
      )
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          "Which Datadog resources to sync. Omit to sync all of them. 'monitor_events' depends on 'monitors' being fetched - enabling it without 'monitors' still runs the monitors query but skips writing monitor entities.",
      }),
    metricsLookbackHours: z.number().int().positive().max(168).optional().meta({
      label: 'Metrics lookback (hours)',
      description:
        'Window of metric samples to pull on each sync, in hours. Defaults to 24.',
      placeholder: '24',
    }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Datadog',
  category: 'infrastructure',
  brandColor: '#632CA6',
  tagline:
    'Sync monitor health, monitor state-change events, incidents, SLOs, and user-declared metric queries from a Datadog org.',
  vendor: {
    name: 'Datadog',
    apiDocs: 'https://docs.datadoghq.com/api/latest/',
    website: 'https://www.datadoghq.com',
  },
  auth: {
    summary:
      'A Datadog API key and Application key are required, scoped to the org and site you want to read from. Both are stored as secrets.',
    setup: [
      'Open Datadog → Organization Settings → API Keys and create (or copy) an API key.',
      'Open Datadog → Organization Settings → Application Keys and create an Application key with read access to monitors, incidents, SLOs, and metrics.',
      'Store both as secrets and reference them from the connector config as `apiKey: secret("DD_API_KEY")` and `appKey: secret("DD_APP_KEY")`.',
      'Set `site` to your Datadog site host (e.g. `datadoghq.com`, `datadoghq.eu`, `us3.datadoghq.com`); it defaults to `datadoghq.com`.',
    ],
  },
  rateLimit:
    'Datadog returns X-RateLimit-Remaining / X-RateLimit-Reset headers (reset in seconds) on the v2 endpoints, wired through the standard rate-limit policy so the host scheduler backs off on near-empty windows.',
  limitations: [
    'Logs and RUM session data are out of scope (high volume, low dashboard signal).',
    'Synthetic monitor results are out of scope.',
    'Monitor entities are not cleared on a full sync - the monitor_events diff depends on the prior status being stored.',
    'Pagination URLs are pinned to the configured `api.<site>` host.',
  ],
});

export type DatadogResource =
  | 'monitors'
  | 'monitor_events'
  | 'incidents'
  | 'slos'
  | 'metric_queries';

export interface DatadogMetricQuery {
  name: string;
  query: string;
  interval?: '5m' | '15m' | '1h' | '1d';
}

export interface DatadogSettings {
  site?: string;
  metricQueries?: readonly DatadogMetricQuery[];
  resources?: readonly DatadogResource[];
  metricsLookbackHours?: number;
}

const datadogCredentials = {
  apiKey: {
    description: 'Datadog API key',
    auth: 'required' as const,
  },
  appKey: {
    description: 'Datadog Application key',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type DatadogCredentials = typeof datadogCredentials;

// ---------------------------------------------------------------------------
// Sync phases + cursor
// ---------------------------------------------------------------------------

// Datadog exposes `X-RateLimit-Remaining` / `X-RateLimit-Reset` on the v2
// endpoints (Reset is seconds-until). We treat reset as a relative-seconds
// value; standardRateLimitPolicy with `resetUnit: 's'` and the right header
// names parses it as the "remaining" budget — close enough for the host
// scheduler to back off on near-empty windows.
const datadogRateLimit = standardRateLimitPolicy({
  remainingHeader: 'x-ratelimit-remaining',
  resetHeader: 'x-ratelimit-reset',
  resetUnit: 's',
});

const PHASE_ORDER = ['monitors', 'incidents', 'slos', 'metrics'] as const;

type DatadogPhase = (typeof PHASE_ORDER)[number];

type DatadogSyncCursor = ChunkedSyncCursor<DatadogPhase, string>;

const isDatadogSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

// ---------------------------------------------------------------------------
// Datadog API types
// ---------------------------------------------------------------------------

type DatadogMonitorStatus = 'OK' | 'Alert' | 'Warn' | 'No Data' | 'Ignored';

interface DatadogMonitor {
  id: number;
  name: string;
  type: string;
  status: DatadogMonitorStatus;
  priority: number | null;
  tags: string[];
  overall_state_modified?: string | null;
  created: string;
  modified: string;
}

interface DatadogMonitorSearchResponse {
  monitors: DatadogMonitor[];
  metadata: {
    page: number;
    page_count: number;
    per_page: number;
    total_count: number;
  };
}

interface DatadogIncident {
  id: string;
  type: 'incidents';
  attributes: {
    title: string;
    severity?: string | null;
    state?: string | null;
    customer_impact_scope?: string | null;
    created: string;
    modified?: string | null;
    resolved?: string | null;
  };
}

interface DatadogIncidentsResponse {
  data: DatadogIncident[];
  meta?: {
    pagination?: {
      next_offset?: number | null;
      offset?: number;
      size?: number;
    };
  };
}

interface DatadogSloThreshold {
  timeframe: string;
  target: number;
  warning?: number | null;
}

interface DatadogSloStatus {
  sli_value?: number | null;
  indexed_at?: number | null;
}

interface DatadogSlo {
  id: string;
  name: string;
  type: string;
  thresholds: DatadogSloThreshold[];
  overall_status?: DatadogSloStatus[] | null;
  created_at?: number | null;
  modified_at?: number | null;
}

interface DatadogSlosResponse {
  data: DatadogSlo[];
}

interface DatadogTimeseriesResponse {
  data: {
    type: 'timeseries_response';
    attributes: {
      series?: Array<{
        group_tags?: string[];
        query_index?: number;
        unit?: Array<{ name?: string } | null> | null;
      }>;
      times?: number[];
      values?: number[][];
    };
  };
}

interface MonitorsBatchItem {
  monitor: DatadogMonitor;
}

interface MetricsBatchItem {
  queryName: string;
  query: string;
  response: DatadogTimeseriesResponse;
}

// ---------------------------------------------------------------------------
// Schemas — describe the per-resource API response shape consumed by request()
// ---------------------------------------------------------------------------

const idString = z.string().min(1);

const monitorSchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string(),
  type: z.string(),
  status: z.enum(['OK', 'Alert', 'Warn', 'No Data', 'Ignored']),
  priority: z.number().int().nullable(),
  tags: z.array(z.string()),
  overall_state_modified: z.iso.datetime().nullable().optional(),
  created: z.iso.datetime(),
  modified: z.iso.datetime(),
});

const monitorSearchResponseSchema = z.object({
  monitors: z.array(monitorSchema),
  metadata: z.object({
    page: z.number().int().nonnegative(),
    page_count: z.number().int().nonnegative(),
    per_page: z.number().int().positive(),
    total_count: z.number().int().nonnegative(),
  }),
});

const incidentSchema = z.object({
  id: idString,
  type: z.literal('incidents'),
  attributes: z.object({
    title: z.string(),
    severity: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    customer_impact_scope: z.string().nullable().optional(),
    created: z.iso.datetime(),
    modified: z.iso.datetime().nullable().optional(),
    resolved: z.iso.datetime().nullable().optional(),
  }),
});

const incidentsResponseSchema = z.object({
  data: z.array(incidentSchema),
  meta: z
    .object({
      pagination: z
        .object({
          next_offset: z.number().int().nullable().optional(),
          offset: z.number().int().optional(),
          size: z.number().int().optional(),
        })
        .optional(),
    })
    .optional(),
});

const sloSchema = z.object({
  id: idString,
  name: z.string(),
  type: z.string(),
  thresholds: z.array(
    z.object({
      timeframe: z.string(),
      target: z.number(),
      warning: z.number().nullable().optional(),
    }),
  ),
  overall_status: z
    .array(
      z.object({
        sli_value: z.number().nullable().optional(),
        indexed_at: z.number().nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
  created_at: z.number().nullable().optional(),
  modified_at: z.number().nullable().optional(),
});

const slosResponseSchema = z.object({
  data: z.array(sloSchema),
});

const timeseriesResponseSchema = z.object({
  data: z.object({
    type: z.literal('timeseries_response'),
    attributes: z.object({
      series: z
        .array(
          z.object({
            group_tags: z.array(z.string()).optional(),
            query_index: z.number().int().optional(),
          }),
        )
        .optional(),
      times: z.array(z.number()).optional(),
      values: z.array(z.array(z.number())).optional(),
    }),
  }),
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SITE = 'datadoghq.com';
const MONITORS_PAGE_SIZE = 100;
const INCIDENTS_PAGE_SIZE = 50;
const DEFAULT_METRICS_LOOKBACK_HOURS = 24;
const INTERVAL_MS: Record<
  NonNullable<DatadogMetricQuery['interval']>,
  number
> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};
const DEFAULT_INTERVAL_MS = INTERVAL_MS['1h'];

// ---------------------------------------------------------------------------
// Resource definitions
// ---------------------------------------------------------------------------

export const datadogResources = defineResources({
  datadog_monitor: {
    shape: 'entity',
    description:
      'Datadog monitors with name, type, current status (OK / Alert / Warn / No Data), priority, and tags.',
    endpoint: 'GET /api/v1/monitor/search',
    responses: { monitors: monitorSearchResponseSchema },
  },
  datadog_monitor_event: {
    shape: 'event',
    description:
      "Monitor state-transition events, emitted whenever a monitor's status changes from its previously-stored value.",
    notes:
      "Derived by diffing each monitor's current status against the last-synced status, so it depends on the monitors phase running and on prior monitor state being stored.",
  },
  datadog_incident: {
    shape: 'entity',
    description:
      'Datadog incidents with title, severity, state, and created / resolved timestamps.',
    endpoint: 'GET /api/v2/incidents',
    responses: { incidents: incidentsResponseSchema },
  },
  datadog_slo: {
    shape: 'entity',
    description:
      'Service Level Objectives with type, thresholds, primary target, and latest SLI value.',
    endpoint: 'GET /api/v1/slo',
    responses: { slos: slosResponseSchema },
  },
  datadog_slo_sli: {
    shape: 'metric',
    description:
      'SLI value samples per SLO, one per overall_status snapshot reported by Datadog.',
    unit: 'percent',
    dimensions: [
      { name: 'sloId', description: 'Datadog SLO id.' },
      { name: 'sloType', description: 'SLO type (metric, monitor, etc.).' },
    ],
  },
  datadog_metric: {
    shape: 'metric',
    dynamic: true,
    description:
      'User-declared metric timeseries samples, stored as `datadog_metric.<query name>`, from the Datadog Metrics Query API.',
    endpoint: 'POST /api/v2/query/timeseries',
    dimensions: [
      { name: 'queryName', description: 'The user-declared query name.' },
      { name: 'query', description: 'The Datadog metrics query string.' },
      {
        name: 'tags',
        description:
          'Comma-joined group tags for the series, or `*` when the series is ungrouped.',
      },
    ],
    responses: { metric_queries: timeseriesResponseSchema },
  },
});

// ---------------------------------------------------------------------------
// DatadogConnector
// ---------------------------------------------------------------------------

export const id = 'datadog';

export class DatadogConnector extends BaseConnector<
  DatadogSettings,
  DatadogCredentials
> {
  static readonly id = id;

  static readonly resources = datadogResources;

  static readonly schemas = schemasFromResources(datadogResources);

  static create(input: unknown, ctx?: ConnectorContext): DatadogConnector {
    const parsed = configFields.parse(input);
    return new DatadogConnector(
      {
        site: parsed.site,
        metricQueries: parsed.metricQueries,
        resources: parsed.resources,
        metricsLookbackHours: parsed.metricsLookbackHours,
      },
      { apiKey: parsed.apiKey, appKey: parsed.appKey },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = datadogCredentials;

  private get apiHost(): string {
    return `api.${(this.settings.site ?? DEFAULT_SITE).toLowerCase()}`;
  }

  private get apiBase(): string {
    return `https://${this.apiHost}`;
  }

  private buildHeaders(): Record<string, string> {
    return {
      'DD-API-KEY': this.creds.apiKey,
      'DD-APPLICATION-KEY': this.creds.appKey,
      'User-Agent': connectorUserAgent('datadog'),
    };
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
      rateLimit: datadogRateLimit,
    });
  }

  private postJson<T>(
    url: string,
    body: unknown,
    resource: string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.post<T>(url, {
      resource,
      headers: {
        ...this.buildHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
      rateLimit: datadogRateLimit,
    });
  }

  // -------------------------------------------------------------------------
  // Resource enablement
  // -------------------------------------------------------------------------

  private activePhases(): DatadogPhase[] {
    return selectActivePhases<DatadogResource, DatadogPhase>(
      (r) => {
        switch (r) {
          case 'monitors':
          case 'monitor_events':
            return 'monitors';
          case 'incidents':
            return 'incidents';
          case 'slos':
            return 'slos';
          case 'metric_queries':
            return 'metrics';
        }
      },
      PHASE_ORDER,
      this.settings.resources,
    );
  }

  // -------------------------------------------------------------------------
  // URL building + sanitization
  // -------------------------------------------------------------------------

  private allowedPagePath(phase: DatadogPhase): string {
    switch (phase) {
      case 'monitors':
        return '/api/v1/monitor/search';
      case 'incidents':
        return '/api/v2/incidents';
      case 'slos':
        return '/api/v1/slo';
      case 'metrics':
        return '/api/v2/query/timeseries';
    }
  }

  private sanitizePageUrl(
    phase: DatadogPhase,
    pageUrl: string | null,
  ): string | null {
    return sanitizeAllowedUrl({
      url: pageUrl,
      host: this.apiHost,
      pathname: this.allowedPagePath(phase),
    });
  }

  private resolveCursor(cursor: unknown): DatadogSyncCursor | undefined {
    if (!isDatadogSyncCursor(cursor)) {
      return undefined;
    }
    return {
      phase: cursor.phase,
      page: this.sanitizePageUrl(cursor.phase, cursor.page),
    };
  }

  private buildInitialMonitorsUrl(): string {
    const u = new URL(`${this.apiBase}/api/v1/monitor/search`);
    u.searchParams.set('per_page', String(MONITORS_PAGE_SIZE));
    u.searchParams.set('page', '0');
    u.searchParams.set('sort', 'status,desc');
    return u.toString();
  }

  private buildNextMonitorsUrl(currentUrl: string, nextPage: number): string {
    const u = new URL(currentUrl);
    u.searchParams.set('page', String(nextPage));
    return u.toString();
  }

  private buildInitialIncidentsUrl(options: SyncOptions): string {
    const u = new URL(`${this.apiBase}/api/v2/incidents`);
    u.searchParams.set('page[size]', String(INCIDENTS_PAGE_SIZE));
    u.searchParams.set('page[offset]', '0');
    u.searchParams.set('include', '');
    if (options.since) {
      u.searchParams.set('filter[created.from]', options.since);
    }
    return u.toString();
  }

  private buildNextIncidentsUrl(
    currentUrl: string,
    nextOffset: number,
  ): string {
    const u = new URL(currentUrl);
    u.searchParams.set('page[offset]', String(nextOffset));
    return u.toString();
  }

  private buildSlosUrl(): string {
    const u = new URL(`${this.apiBase}/api/v1/slo`);
    u.searchParams.set('limit', '1000');
    u.searchParams.set('offset', '0');
    return u.toString();
  }

  private buildMetricsUrl(): string {
    return `${this.apiBase}/api/v2/query/timeseries`;
  }

  // -------------------------------------------------------------------------
  // Fetchers
  // -------------------------------------------------------------------------

  private async fetchMonitorsPage(
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<{ items: MonitorsBatchItem[]; next: string | null }> {
    const url = page ?? this.buildInitialMonitorsUrl();
    const res = await this.fetch<DatadogMonitorSearchResponse>(
      url,
      'monitors',
      signal,
    );
    const meta = res.body.metadata;
    const currentPage = meta.page;
    const totalPages = meta.page_count;
    const hasNext = currentPage + 1 < totalPages;
    const next = hasNext
      ? this.sanitizePageUrl(
          'monitors',
          this.buildNextMonitorsUrl(url, currentPage + 1),
        )
      : null;
    return {
      items: res.body.monitors.map((m) => ({ monitor: m })),
      next,
    };
  }

  private async fetchIncidentsPage(
    page: string | null,
    options: SyncOptions,
    signal: AbortSignal | undefined,
  ): Promise<{ items: DatadogIncident[]; next: string | null }> {
    const url = page ?? this.buildInitialIncidentsUrl(options);
    const res = await this.fetch<DatadogIncidentsResponse>(
      url,
      'incidents',
      signal,
    );
    const nextOffset = res.body.meta?.pagination?.next_offset ?? null;
    const incidents = res.body.data;
    const cutoff = options.since
      ? (parseEpoch(options.since, 'iso') ?? null)
      : null;
    const filtered =
      cutoff !== null
        ? incidents.filter((inc) => {
            const ts = parseEpoch(inc.attributes.created, 'iso');
            return ts === null || ts >= cutoff;
          })
        : incidents;
    const lastIncident = incidents.at(-1);
    const lastTs = lastIncident
      ? parseEpoch(lastIncident.attributes.created, 'iso')
      : null;
    const cutoffReached = cutoff !== null && lastTs !== null && lastTs < cutoff;
    const next =
      !cutoffReached && nextOffset !== null
        ? this.sanitizePageUrl(
            'incidents',
            this.buildNextIncidentsUrl(url, nextOffset),
          )
        : null;
    return { items: filtered, next };
  }

  private async fetchSlos(
    signal: AbortSignal | undefined,
  ): Promise<{ items: DatadogSlo[]; next: string | null }> {
    const res = await this.fetch<DatadogSlosResponse>(
      this.buildSlosUrl(),
      'slos',
      signal,
    );
    return { items: res.body.data, next: null };
  }

  private async fetchMetrics(
    options: SyncOptions,
    signal: AbortSignal | undefined,
  ): Promise<{ items: MetricsBatchItem[]; next: string | null }> {
    const queries = this.settings.metricQueries ?? [];
    if (queries.length === 0) {
      return { items: [], next: null };
    }
    const lookbackHours =
      this.settings.metricsLookbackHours ?? DEFAULT_METRICS_LOOKBACK_HOURS;
    const now = Date.now();
    const sinceMs = options.since ? parseEpoch(options.since, 'iso') : null;
    const fromMs =
      sinceMs !== null ? sinceMs : now - lookbackHours * 60 * 60 * 1000;
    const items: MetricsBatchItem[] = [];
    for (const q of queries) {
      signal?.throwIfAborted();
      const intervalMs = q.interval
        ? INTERVAL_MS[q.interval]
        : DEFAULT_INTERVAL_MS;
      const body = {
        data: {
          type: 'timeseries_request',
          attributes: {
            from: fromMs,
            to: now,
            interval: intervalMs,
            queries: [
              {
                name: 'a',
                data_source: 'metrics',
                query: q.query,
              },
            ],
            formulas: [{ formula: 'a' }],
          },
        },
      };
      const res = await this.postJson<DatadogTimeseriesResponse>(
        this.buildMetricsUrl(),
        body,
        'metric_queries',
        signal,
      );
      items.push({
        queryName: q.name,
        query: q.query,
        response: res.body,
      });
    }
    return { items, next: null };
  }

  // -------------------------------------------------------------------------
  // Writers
  // -------------------------------------------------------------------------

  private async writeMonitorsBatch(
    storage: StorageHandle,
    items: MonitorsBatchItem[],
  ): Promise<void> {
    const writeEntities = this.isResourceEnabled('monitors');
    const writeEvents = this.isResourceEnabled('monitor_events');

    for (const item of items) {
      const m = item.monitor;
      const createdMs = parseEpoch(m.created, 'iso');
      const modifiedMs = parseEpoch(m.modified, 'iso');
      const stateModifiedMs =
        m.overall_state_modified !== undefined &&
        m.overall_state_modified !== null
          ? parseEpoch(m.overall_state_modified, 'iso')
          : null;
      if (createdMs === null || modifiedMs === null) {
        console.warn(
          `[connector-datadog] skipping monitor ${m.id} with unparseable created/modified timestamps`,
        );
        continue;
      }
      const updatedMs = Math.max(modifiedMs, stateModifiedMs ?? 0);

      const attributes: Record<string, JSONValue> = {
        monitorId: m.id,
        name: m.name,
        monitorType: m.type,
        status: m.status,
        priority: m.priority,
        tags: m.tags,
        createdAt: createdMs,
        modifiedAt: modifiedMs,
        stateModifiedAt: stateModifiedMs,
      };

      if (writeEvents) {
        const prior = await storage.getEntity('datadog_monitor', String(m.id));
        const priorStatus =
          prior !== null &&
          typeof prior.attributes === 'object' &&
          prior.attributes !== null
            ? (prior.attributes as { status?: string }).status
            : undefined;
        if (
          priorStatus !== m.status &&
          stateModifiedMs !== null &&
          Number.isFinite(stateModifiedMs)
        ) {
          await storage.event({
            name: 'datadog_monitor_event',
            start_ts: stateModifiedMs,
            end_ts: null,
            attributes: {
              monitorId: m.id,
              name: m.name,
              monitorType: m.type,
              fromStatus: priorStatus ?? null,
              toStatus: m.status,
              priority: m.priority,
              tags: m.tags,
            },
          });
        }
      }

      if (writeEntities) {
        await storage.entity({
          type: 'datadog_monitor',
          id: String(m.id),
          attributes,
          updated_at: updatedMs,
        });
      } else if (writeEvents) {
        // We still upsert to keep the comparison baseline fresh even when the
        // host hasn't asked for the monitor entity itself — the next sync's
        // monitor_event diff depends on a stored prior state.
        await storage.entity({
          type: 'datadog_monitor',
          id: String(m.id),
          attributes,
          updated_at: updatedMs,
        });
      }
    }
  }

  private async writeIncidents(
    storage: StorageHandle,
    incidents: DatadogIncident[],
  ): Promise<void> {
    for (const inc of incidents) {
      const createdMs = parseEpoch(inc.attributes.created, 'iso');
      if (createdMs === null) {
        console.warn(
          `[connector-datadog] skipping incident ${inc.id} with unparseable created timestamp`,
        );
        continue;
      }
      const modifiedMs = inc.attributes.modified
        ? parseEpoch(inc.attributes.modified, 'iso')
        : null;
      const resolvedMs = inc.attributes.resolved
        ? parseEpoch(inc.attributes.resolved, 'iso')
        : null;
      await storage.entity({
        type: 'datadog_incident',
        id: inc.id,
        attributes: {
          incidentId: inc.id,
          title: inc.attributes.title,
          severity: inc.attributes.severity ?? null,
          state: inc.attributes.state ?? null,
          customerImpactScope: inc.attributes.customer_impact_scope ?? null,
          createdAt: createdMs,
          modifiedAt: modifiedMs,
          resolvedAt: resolvedMs,
        },
        updated_at: Math.max(createdMs, modifiedMs ?? 0, resolvedMs ?? 0),
      });
    }
  }

  private async writeSlos(
    storage: StorageHandle,
    slos: DatadogSlo[],
  ): Promise<void> {
    const sliSamples: Array<{
      name: string;
      ts: number;
      value: number;
      attributes: Record<string, string | number>;
    }> = [];
    const entities: Entity[] = [];
    for (const s of slos) {
      const createdMs =
        s.created_at !== null && s.created_at !== undefined
          ? parseEpoch(s.created_at, 's')
          : null;
      const modifiedMs =
        s.modified_at !== null && s.modified_at !== undefined
          ? parseEpoch(s.modified_at, 's')
          : null;
      const targets = s.thresholds.map((t) => ({
        timeframe: t.timeframe,
        target: t.target,
      }));
      const primaryTarget = s.thresholds[0]?.target ?? null;
      const latestStatus = (s.overall_status ?? []).find(
        (st) => st.sli_value !== null && st.sli_value !== undefined,
      );
      const latestSli = latestStatus?.sli_value ?? null;
      entities.push({
        type: 'datadog_slo',
        id: s.id,
        attributes: {
          sloId: s.id,
          name: s.name,
          sloType: s.type,
          thresholds: targets as unknown as JSONValue,
          target: primaryTarget,
          latestSliValue: latestSli,
          createdAt: createdMs,
          modifiedAt: modifiedMs,
        },
        updated_at: modifiedMs ?? createdMs ?? Date.now(),
      });

      for (const status of s.overall_status ?? []) {
        const ts =
          status.indexed_at !== null && status.indexed_at !== undefined
            ? parseEpoch(status.indexed_at, 's')
            : null;
        const value = status.sli_value;
        if (
          ts === null ||
          value === null ||
          value === undefined ||
          !Number.isFinite(value)
        ) {
          continue;
        }
        sliSamples.push({
          name: 'datadog_slo_sli',
          ts,
          value,
          attributes: { sloId: s.id, sloType: s.type },
        });
      }
    }
    for (const entity of entities) {
      await storage.entity(entity);
    }
    if (sliSamples.length > 0) {
      await storage.metrics(sliSamples, { names: ['datadog_slo_sli'] });
    }
  }

  private async writeMetrics(
    storage: StorageHandle,
    items: MetricsBatchItem[],
  ): Promise<void> {
    if (items.length === 0) {
      return;
    }
    const samplesByName: Map<
      string,
      Array<{
        name: string;
        ts: number;
        value: number;
        attributes: Record<string, string | number>;
      }>
    > = new Map();
    for (const item of items) {
      const attrs = item.response.data.attributes;
      const times = attrs.times ?? [];
      const series = attrs.series ?? [];
      const values = attrs.values ?? [];
      for (let s = 0; s < series.length; s++) {
        const seriesValues = values[s];
        if (!seriesValues) {
          continue;
        }
        const tagsArr = series[s]?.group_tags ?? [];
        const tagsStr = tagsArr.length > 0 ? tagsArr.join(',') : '*';
        for (let t = 0; t < times.length; t++) {
          const rawTs = times[t];
          const rawValue = seriesValues[t];
          if (rawTs === undefined || rawValue === undefined) {
            continue;
          }
          const ts = parseEpoch(rawTs, 'ms');
          if (ts === null || !Number.isFinite(rawValue)) {
            continue;
          }
          const name = `datadog_metric.${item.queryName}`;
          let bucket = samplesByName.get(name);
          if (!bucket) {
            bucket = [];
            samplesByName.set(name, bucket);
          }
          bucket.push({
            name,
            ts,
            value: rawValue,
            attributes: {
              queryName: item.queryName,
              query: item.query,
              tags: tagsStr,
            },
          });
        }
      }
    }
    for (const [name, samples] of samplesByName) {
      await storage.metrics(samples, { names: [name] });
    }
  }

  // -------------------------------------------------------------------------
  // sync
  // -------------------------------------------------------------------------

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = this.resolveCursor(options.cursor);
    const isFull = options.mode === 'full';
    const phases = this.activePhases();

    return paginateChunked<DatadogPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'monitors':
            return this.fetchMonitorsPage(page, sig);
          case 'incidents':
            return this.fetchIncidentsPage(page, options, sig);
          case 'slos':
            return this.fetchSlos(sig);
          case 'metrics':
            return this.fetchMetrics(options, sig);
        }
      },
      writeBatch: async (phase, items, page) => {
        if (isFull && page === null) {
          switch (phase) {
            case 'monitors':
              if (this.isResourceEnabled('monitor_events')) {
                await storage.events([], { names: ['datadog_monitor_event'] });
              }
              // Monitor entities are intentionally NOT cleared on a full
              // sync — `writeMonitorsBatch` reads the prior status off the
              // existing entity to derive monitor_events. Wiping it here
              // would forget every state we'd seen on the previous run.
              break;
            case 'incidents':
              await storage.entities([], { types: ['datadog_incident'] });
              break;
            case 'slos':
              await storage.entities([], { types: ['datadog_slo'] });
              await storage.metrics([], { names: ['datadog_slo_sli'] });
              break;
            case 'metrics':
              for (const q of this.settings.metricQueries ?? []) {
                await storage.metrics([], {
                  names: [`datadog_metric.${q.name}`],
                });
              }
              break;
          }
        }
        switch (phase) {
          case 'monitors':
            return this.writeMonitorsBatch(
              storage,
              items as MonitorsBatchItem[],
            );
          case 'incidents':
            return this.writeIncidents(storage, items as DatadogIncident[]);
          case 'slos':
            return this.writeSlos(storage, items as DatadogSlo[]);
          case 'metrics':
            return this.writeMetrics(storage, items as MetricsBatchItem[]);
        }
      },
    });
  }
}
