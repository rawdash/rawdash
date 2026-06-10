import {
  type HttpResponse,
  connectorUserAgent,
  parseEpoch,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ChunkedSyncCursor,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
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

const nrqlQuerySchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_]+$/, {
      message: 'Metric name must be alphanumeric / underscore',
    }),
  query: z.string().min(1),
});

export const configFields = defineConfigFields(
  z.object({
    apiKey: z.object({ $secret: z.string().min(1) }).meta({
      label: 'User API Key',
      description:
        'New Relic User API key. Create at New Relic -> API keys (User key type, ingest-keys do not work for NerdGraph).',
      placeholder: 'NRAK-...',
      secret: true,
    }),
    accountId: z.number().int().positive().meta({
      label: 'Account ID',
      description:
        'New Relic account ID the User API key has access to. Find it under New Relic -> Administration -> Access management.',
      placeholder: '1234567',
    }),
    region: z.enum(['US', 'EU']).optional().meta({
      label: 'Region',
      description:
        'New Relic data region. Defaults to `US` (`api.newrelic.com`); set to `EU` to use `api.eu.newrelic.com`.',
      placeholder: 'US',
    }),
    nrqlQueries: z.array(nrqlQuerySchema).nonempty().optional().meta({
      label: 'NRQL queries (optional)',
      description:
        'User-declared NRQL queries. Each entry produces `newrelic_nrql_metric` samples named `<name>` from the NerdGraph NRQL API.',
    }),
    resources: z
      .array(z.enum(['alerts', 'alert_violations', 'nrql_queries']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which New Relic resources to sync. Omit to sync all of them.',
      }),
    incidentsLookbackHours: z
      .number()
      .int()
      .positive()
      .max(720)
      .optional()
      .meta({
        label: 'Incidents lookback (hours)',
        description:
          'Window of NrAiIncident rows to pull on each sync, in hours. Defaults to 168 (7 days). Ignored when `since` is set by the host.',
        placeholder: '168',
      }),
    metricsLookbackHours: z.number().int().positive().max(168).optional().meta({
      label: 'NRQL metrics lookback (hours)',
      description:
        'Window of NRQL metric samples to pull on each sync, in hours. Defaults to 24. Each user query gets `SINCE <lookback> hours ago` appended unless the query already declares its own `SINCE` clause.',
      placeholder: '24',
    }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'New Relic',
  category: 'infrastructure',
  brandColor: '#1CE783',
  tagline:
    'Sync NRQL alert conditions, AI incidents, and user-declared NRQL metric queries from a New Relic account via NerdGraph.',
  vendor: {
    name: 'New Relic',
    domain: 'newrelic.com',
    apiDocs: 'https://docs.newrelic.com/docs/apis/nerdgraph/',
    website: 'https://newrelic.com',
  },
  auth: {
    summary:
      'A New Relic User API key plus the numeric account ID are required. The key is stored as a secret and used to authenticate every NerdGraph GraphQL request.',
    setup: [
      'Open New Relic -> API keys and create a `User` key. Ingest-keys are not accepted by NerdGraph.',
      'Find the numeric account ID under New Relic -> Administration -> Access management. The User key must have access to that account.',
      'Store the User key as a secret and reference it from the connector config as `apiKey: secret("NEWRELIC_USER_KEY")`.',
      'Set `accountId` to the numeric account ID, and optionally `region: "EU"` if the data lives on the EU host (`api.eu.newrelic.com`); defaults to `US` (`api.newrelic.com`).',
    ],
  },
  rateLimit:
    'NerdGraph enforces per-account NRQL quotas; this connector retries on 429s through the standard HTTP retry policy.',
  limitations: [
    'APM-trace deep inspection is out of scope (not dashboard-shaped).',
    'NRQL queries are single-shot per sync (NRQL does not support cursor pagination); large queries should narrow their `SINCE` window or use `LIMIT MAX`.',
    'Incidents are pulled via NRQL on the NrAiIncident event type, which depends on Applied Intelligence being enabled on the account.',
    'Only NRQL-based alert conditions are synced; legacy V1 condition types are not exposed.',
  ],
});

export type NewRelicResource = 'alerts' | 'alert_violations' | 'nrql_queries';

export interface NewRelicNrqlQuery {
  name: string;
  query: string;
}

export interface NewRelicSettings {
  accountId: number;
  region?: 'US' | 'EU';
  nrqlQueries?: readonly NewRelicNrqlQuery[];
  resources?: readonly NewRelicResource[];
  incidentsLookbackHours?: number;
  metricsLookbackHours?: number;
}

const newRelicCredentials = {
  apiKey: {
    description: 'New Relic User API key',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type NewRelicCredentials = typeof newRelicCredentials;

const PHASE_ORDER = ['alert_conditions', 'incidents', 'metrics'] as const;

type NewRelicPhase = (typeof PHASE_ORDER)[number];

type NewRelicSyncCursor = ChunkedSyncCursor<NewRelicPhase, string>;

const isNewRelicSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

interface NrqlConditionNode {
  id: string;
  name: string;
  enabled: boolean;
  policyId: string;
  type: string;
  createdAt: number | null;
  updatedAt: number | null;
  nrql?: { query: string } | null;
}

interface NrqlConditionsSearchResult {
  nrqlConditions: NrqlConditionNode[];
  nextCursor: string | null;
  totalCount: number;
}

interface NrqlResult {
  results: Array<Record<string, JSONValue>>;
  metadata?: {
    facets?: string[] | null;
    timeWindow?: {
      begin?: number | null;
      end?: number | null;
    } | null;
  } | null;
}

interface AlertConditionsResponse {
  actor: {
    account: {
      alerts: {
        nrqlConditionsSearch: NrqlConditionsSearchResult;
      };
    };
  };
}

interface NrqlResponse {
  actor: {
    account: {
      nrql: NrqlResult;
    };
  };
}

interface MetricsBatchItem {
  queryName: string;
  query: string;
  result: NrqlResult;
}

interface GraphQLError {
  message: string;
  path?: Array<string | number>;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

const ALERT_CONDITIONS_QUERY = `
  query AlertConditions($accountId: Int!, $cursor: String) {
    actor {
      account(id: $accountId) {
        alerts {
          nrqlConditionsSearch(cursor: $cursor) {
            nrqlConditions {
              id
              name
              enabled
              policyId
              type
              createdAt
              updatedAt
              nrql { query }
            }
            nextCursor
            totalCount
          }
        }
      }
    }
  }
`;

const NRQL_QUERY = `
  query RunNrql($accountId: Int!, $query: Nrql!) {
    actor {
      account(id: $accountId) {
        nrql(query: $query) {
          results
          metadata {
            facets
            timeWindow {
              begin
              end
            }
          }
        }
      }
    }
  }
`;

const idString = z.string().min(1);
const nrqlScalarSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);
const nrqlCellSchema = z.union([nrqlScalarSchema, z.array(nrqlScalarSchema)]);

const nrqlConditionNodeSchema = z.object({
  id: idString,
  name: z.string(),
  enabled: z.boolean(),
  policyId: idString,
  type: z.string(),
  createdAt: z.number().nullable(),
  updatedAt: z.number().nullable(),
  nrql: z.object({ query: z.string() }).nullable().optional(),
});

const nrqlConditionsSearchResultSchema = z.object({
  nrqlConditions: z.array(nrqlConditionNodeSchema),
  nextCursor: z.string().nullable(),
  totalCount: z.number().int().nonnegative(),
});

const nrqlResultSchema = z.object({
  results: z.array(z.record(z.string(), nrqlCellSchema)),
  metadata: z
    .object({
      facets: z.array(z.string()).nullable().optional(),
      timeWindow: z
        .object({
          begin: z.number().nullable().optional(),
          end: z.number().nullable().optional(),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});

const DEFAULT_REGION: 'US' | 'EU' = 'US';
const DEFAULT_INCIDENTS_LOOKBACK_HOURS = 168;
const DEFAULT_METRICS_LOOKBACK_HOURS = 24;
const INCIDENTS_NRQL_LIMIT = 5000;
const TIMESTAMP_FIELDS = new Set([
  'timestamp',
  'beginTimeSeconds',
  'endTimeSeconds',
  'begin_time',
  'end_time',
  'beginTime',
  'endTime',
  'openedAt',
  'closedAt',
]);
const FACET_FIELDS = new Set(['facet']);

export const newRelicResources = defineResources({
  newrelic_alert_condition: {
    shape: 'entity',
    description:
      'NRQL alert conditions with name, enabled state, policy id, type, and the underlying NRQL query string.',
    endpoint:
      'GraphQL query: actor.account.alerts.nrqlConditionsSearch { nrqlConditions { ... } }',
    responses: { alert_conditions: nrqlConditionsSearchResultSchema },
  },
  newrelic_alert_violation: {
    shape: 'event',
    description:
      'AI alert violation events. Each row from the NrAiIncident event type becomes one event with openedAt / closedAt and the underlying condition / policy metadata.',
    endpoint:
      'GraphQL nrql() against SELECT ... FROM NrAiIncident WHERE openedAt > ...',
    notes:
      'Append-only across syncs; the connector filters NrAiIncident by `openedAt` against `options.since` (or the configured lookback) to avoid re-emitting old incidents.',
    responses: { incidents: nrqlResultSchema },
  },
  newrelic_nrql_metric: {
    shape: 'metric',
    dynamic: true,
    description:
      'User-declared NRQL metric samples, stored as `newrelic_nrql_metric.<query name>`. Each NRQL result row is mapped to a single sample using the first numeric, non-timestamp/facet field as the value.',
    endpoint: 'GraphQL nrql() against the user-declared NRQL query',
    dimensions: [
      { name: 'queryName', description: 'The user-declared query name.' },
      { name: 'query', description: 'The NRQL query string.' },
      {
        name: 'facets',
        description:
          'Comma-joined facet values for the row, or `*` when the result row is ungrouped.',
      },
    ],
    responses: { nrql_queries: nrqlResultSchema },
  },
});

export const id = 'new-relic';

export class NewRelicConnector extends BaseConnector<
  NewRelicSettings,
  NewRelicCredentials
> {
  static readonly id = id;

  static readonly resources = newRelicResources;

  static readonly schemas = schemasFromResources(newRelicResources);

  static create(input: unknown, ctx?: ConnectorContext): NewRelicConnector {
    const parsed = configFields.parse(input);
    return new NewRelicConnector(
      {
        accountId: parsed.accountId,
        region: parsed.region,
        nrqlQueries: parsed.nrqlQueries,
        resources: parsed.resources,
        incidentsLookbackHours: parsed.incidentsLookbackHours,
        metricsLookbackHours: parsed.metricsLookbackHours,
      },
      { apiKey: parsed.apiKey },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = newRelicCredentials;

  private get endpoint(): string {
    const region = this.settings.region ?? DEFAULT_REGION;
    return region === 'EU'
      ? 'https://api.eu.newrelic.com/graphql'
      : 'https://api.newrelic.com/graphql';
  }

  private buildHeaders(): Record<string, string> {
    return {
      'API-Key': this.creds.apiKey,
      'Content-Type': 'application/json',
      'User-Agent': connectorUserAgent('new-relic'),
    };
  }

  private async graphql<T>(
    query: string,
    variables: Record<string, unknown>,
    resource: string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<GraphQLResponse<T>>> {
    const res = await this.post<GraphQLResponse<T>>(this.endpoint, {
      resource,
      headers: this.buildHeaders(),
      body: JSON.stringify({ query, variables }),
      signal,
    });
    if (res.body.errors && res.body.errors.length > 0) {
      const messages = res.body.errors.map((e) => e.message).join('; ');
      throw new Error(`New Relic NerdGraph error: ${messages}`);
    }
    if (!res.body.data) {
      throw new Error(
        `New Relic NerdGraph response missing data for resource '${resource}'`,
      );
    }
    return res;
  }

  private activePhases(): NewRelicPhase[] {
    return selectActivePhases<NewRelicResource, NewRelicPhase>(
      (r) => {
        switch (r) {
          case 'alerts':
            return 'alert_conditions';
          case 'alert_violations':
            return 'incidents';
          case 'nrql_queries':
            return 'metrics';
        }
      },
      PHASE_ORDER,
      this.settings.resources,
    );
  }

  private async fetchAlertConditionsPage(
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<{ items: NrqlConditionNode[]; next: string | null }> {
    const res = await this.graphql<AlertConditionsResponse>(
      ALERT_CONDITIONS_QUERY,
      { accountId: this.settings.accountId, cursor: page },
      'alert_conditions',
      signal,
    );
    const search = res.body.data!.actor.account.alerts.nrqlConditionsSearch;
    return {
      items: search.nrqlConditions,
      next: search.nextCursor,
    };
  }

  private async fetchIncidents(
    options: SyncOptions,
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<{ items: Array<Record<string, JSONValue>>; next: string | null }> {
    const sinceMs = options.since ? parseEpoch(options.since, 'iso') : null;
    const lookbackHours =
      this.settings.incidentsLookbackHours ?? DEFAULT_INCIDENTS_LOOKBACK_HOURS;
    const fromMs = sinceMs ?? Date.now() - lookbackHours * 60 * 60 * 1000;
    const floorMs = page !== null ? Number(page) : fromMs;
    const nrql = `SELECT incidentId, conditionFamilyId, policyName, conditionName, openedAt, closedAt, durationSeconds, priority, title, state, entityGuid FROM NrAiIncident WHERE openedAt > ${floorMs} ORDER BY openedAt ASC LIMIT ${INCIDENTS_NRQL_LIMIT}`;
    const res = await this.graphql<NrqlResponse>(
      NRQL_QUERY,
      { accountId: this.settings.accountId, query: nrql },
      'incidents',
      signal,
    );
    const results = res.body.data!.actor.account.nrql.results;
    if (results.length < INCIDENTS_NRQL_LIMIT) {
      return { items: results, next: null };
    }
    const lastOpenedAt = results[results.length - 1]?.openedAt;
    const next =
      typeof lastOpenedAt === 'number' &&
      Number.isFinite(lastOpenedAt) &&
      lastOpenedAt > floorMs
        ? String(lastOpenedAt)
        : null;
    return { items: results, next };
  }

  private async fetchMetrics(
    options: SyncOptions,
    signal: AbortSignal | undefined,
  ): Promise<{ items: MetricsBatchItem[]; next: string | null }> {
    const queries = this.settings.nrqlQueries ?? [];
    if (queries.length === 0) {
      return { items: [], next: null };
    }
    const lookbackHours =
      this.settings.metricsLookbackHours ?? DEFAULT_METRICS_LOOKBACK_HOURS;
    const items: MetricsBatchItem[] = [];
    for (const q of queries) {
      signal?.throwIfAborted();
      const nrql = this.appendSinceIfMissing(
        q.query,
        options.since ?? null,
        lookbackHours,
      );
      const res = await this.graphql<NrqlResponse>(
        NRQL_QUERY,
        { accountId: this.settings.accountId, query: nrql },
        'nrql_queries',
        signal,
      );
      items.push({
        queryName: q.name,
        query: q.query,
        result: res.body.data!.actor.account.nrql,
      });
    }
    return { items, next: null };
  }

  private appendSinceIfMissing(
    query: string,
    since: string | null,
    fallbackHours: number,
  ): string {
    if (/\bSINCE\b/i.test(query)) {
      return query;
    }
    const sinceMs = since ? parseEpoch(since, 'iso') : null;
    if (sinceMs !== null) {
      return `${query} SINCE ${sinceMs}`;
    }
    return `${query} SINCE ${fallbackHours} hours ago`;
  }

  private async writeAlertConditions(
    storage: StorageHandle,
    conditions: NrqlConditionNode[],
  ): Promise<void> {
    for (const c of conditions) {
      const createdMs = c.createdAt ?? null;
      const modifiedMs = c.updatedAt ?? null;
      const updatedAt = modifiedMs ?? createdMs ?? Date.now();
      await storage.entity({
        type: 'newrelic_alert_condition',
        id: c.id,
        attributes: {
          conditionId: c.id,
          name: c.name,
          enabled: c.enabled,
          policyId: c.policyId,
          conditionType: c.type,
          nrqlQuery: c.nrql?.query ?? null,
          createdAt: createdMs,
          modifiedAt: modifiedMs,
        },
        updated_at: updatedAt,
      });
    }
  }

  private async writeIncidents(
    storage: StorageHandle,
    rows: Array<Record<string, JSONValue>>,
  ): Promise<void> {
    for (const row of rows) {
      const incidentId =
        typeof row.incidentId === 'string' || typeof row.incidentId === 'number'
          ? String(row.incidentId)
          : null;
      const openedAtRaw = row.openedAt;
      const openedAtMs =
        typeof openedAtRaw === 'number' && Number.isFinite(openedAtRaw)
          ? openedAtRaw
          : null;
      if (incidentId === null || openedAtMs === null) {
        continue;
      }
      const closedAtRaw = row.closedAt;
      const closedAtMs =
        typeof closedAtRaw === 'number' && Number.isFinite(closedAtRaw)
          ? closedAtRaw
          : null;
      await storage.event({
        name: 'newrelic_alert_violation',
        start_ts: openedAtMs,
        end_ts: closedAtMs,
        attributes: {
          incidentId,
          conditionFamilyId: this.coerceScalar(row.conditionFamilyId),
          conditionName: this.coerceScalar(row.conditionName),
          policyName: this.coerceScalar(row.policyName),
          priority: this.coerceScalar(row.priority),
          title: this.coerceScalar(row.title),
          state: this.coerceScalar(row.state),
          entityGuid: this.coerceScalar(row.entityGuid),
          durationSeconds: this.coerceScalar(row.durationSeconds),
        },
      });
    }
  }

  private coerceScalar(value: JSONValue | undefined): JSONValue {
    if (value === undefined) {
      return null;
    }
    return value;
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
      const facets = item.result.metadata?.facets ?? [];
      for (const row of item.result.results) {
        const ts = this.extractTimestamp(row, item.result);
        if (ts === null) {
          continue;
        }
        const value = this.extractValue(row);
        if (value === null) {
          continue;
        }
        const facetsStr = this.extractFacets(row, facets ?? []);
        const name = `newrelic_nrql_metric.${item.queryName}`;
        let bucket = samplesByName.get(name);
        if (!bucket) {
          bucket = [];
          samplesByName.set(name, bucket);
        }
        bucket.push({
          name,
          ts,
          value,
          attributes: {
            queryName: item.queryName,
            query: item.query,
            facets: facetsStr,
          },
        });
      }
    }
    for (const [name, samples] of samplesByName) {
      await storage.metrics(samples, { names: [name] });
    }
  }

  private extractTimestamp(
    row: Record<string, JSONValue>,
    result: NrqlResult,
  ): number | null {
    const endTimeSeconds = row.endTimeSeconds;
    if (typeof endTimeSeconds === 'number' && Number.isFinite(endTimeSeconds)) {
      return parseEpoch(endTimeSeconds, 's');
    }
    const beginTimeSeconds = row.beginTimeSeconds;
    if (
      typeof beginTimeSeconds === 'number' &&
      Number.isFinite(beginTimeSeconds)
    ) {
      return parseEpoch(beginTimeSeconds, 's');
    }
    const timestamp = row.timestamp;
    if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
      return parseEpoch(timestamp, 'ms');
    }
    const endMs = result.metadata?.timeWindow?.end;
    if (typeof endMs === 'number' && Number.isFinite(endMs)) {
      return parseEpoch(endMs, 'ms');
    }
    return Date.now();
  }

  private extractValue(row: Record<string, JSONValue>): number | null {
    for (const [key, value] of Object.entries(row)) {
      if (TIMESTAMP_FIELDS.has(key) || FACET_FIELDS.has(key)) {
        continue;
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
    }
    return null;
  }

  private extractFacets(
    row: Record<string, JSONValue>,
    facetNames: string[],
  ): string {
    const facetRaw = row.facet;
    if (Array.isArray(facetRaw)) {
      return facetRaw.length > 0 ? facetRaw.map(String).join(',') : '*';
    }
    if (typeof facetRaw === 'string' && facetRaw.length > 0) {
      return facetRaw;
    }
    if (facetNames.length > 0) {
      const parts: string[] = [];
      for (const fname of facetNames) {
        const v = row[fname];
        if (v !== undefined && v !== null) {
          parts.push(String(v));
        }
      }
      if (parts.length > 0) {
        return parts.join(',');
      }
    }
    return '*';
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor: NewRelicSyncCursor | undefined = isNewRelicSyncCursor(
      options.cursor,
    )
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';
    const phases = this.activePhases();

    return paginateChunked<NewRelicPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'alert_conditions':
            return this.fetchAlertConditionsPage(page, sig);
          case 'incidents':
            return this.fetchIncidents(options, page, sig);
          case 'metrics':
            return this.fetchMetrics(options, sig);
        }
      },
      writeBatch: async (phase, items, page) => {
        if (isFull && page === null) {
          switch (phase) {
            case 'alert_conditions':
              await storage.entities([], {
                types: ['newrelic_alert_condition'],
              });
              break;
            case 'incidents':
              await storage.events([], { names: ['newrelic_alert_violation'] });
              break;
            case 'metrics':
              for (const q of this.settings.nrqlQueries ?? []) {
                await storage.metrics([], {
                  names: [`newrelic_nrql_metric.${q.name}`],
                });
              }
              break;
          }
        }
        switch (phase) {
          case 'alert_conditions':
            return this.writeAlertConditions(
              storage,
              items as NrqlConditionNode[],
            );
          case 'incidents':
            return this.writeIncidents(
              storage,
              items as Array<Record<string, JSONValue>>,
            );
          case 'metrics':
            return this.writeMetrics(storage, items as MetricsBatchItem[]);
        }
      },
    });
  }
}
