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

export const configFields = defineConfigFields(
  z.object({
    email: z.string().min(1).meta({
      label: 'Account email',
      description:
        'Atlassian account email paired with the API token for Basic auth.',
      placeholder: 'you@yourorg.com',
    }),
    apiToken: z.object({ $secret: z.string() }).meta({
      label: 'API Token',
      description:
        'Atlassian API token. Create one at id.atlassian.com → Security → API tokens.',
      placeholder: 'ATATT...',
      secret: true,
    }),
    host: z
      .string()
      .min(1)
      .regex(
        /^[^/\s:?#]+$/,
        'Use host only (no protocol, port, path, or query).',
      )
      .meta({
        label: 'Site host',
        description:
          'Your Jira Cloud host, e.g. yourorg.atlassian.net (no protocol, no trailing slash).',
        placeholder: 'yourorg.atlassian.net',
      }),
    projectKeys: z.array(z.string().min(1)).nonempty().optional().meta({
      label: 'Service desk project keys (optional)',
      description:
        'Restrict the sync to specific service desk project keys (e.g. IT, HELP). Omit to sync every service desk the account can see.',
    }),
    resources: z
      .array(
        z.enum(['service_desks', 'requests', 'request_events', 'sla_breaches']),
      )
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          "Which Jira Service Management resources to sync. Omit to sync all of them. 'request_events' and 'sla_breaches' share the requests query - enabling either without 'requests' still fetches requests (with changelog and SLA fields) but skips writing request entities.",
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Jira Service Management',
  category: 'support',
  brandColor: '#0052CC',
  tagline:
    'Sync service desks, customer requests, request status-change events, and SLA breach events from a Jira Service Management site for request volume, MTTR, and SLA-attainment dashboards.',
  vendor: {
    name: 'Atlassian',
    domain: 'atlassian.com',
    apiDocs:
      'https://developer.atlassian.com/cloud/jira/service-desk/rest/intro/',
    website: 'https://www.atlassian.com/software/jira/service-management',
  },
  auth: {
    summary:
      'Authenticates over HTTP Basic auth using your Atlassian account email and an API token (the same auth as the Jira connector). The token must belong to an account with agent access to the service desks you want to sync.',
    setup: [
      'Open id.atlassian.com -> Security -> Create and manage API tokens.',
      'Create an API token and copy its value.',
      'Store the token as a secret and reference it from the connector config as `apiToken: secret("JIRA_API_TOKEN")`, alongside your account email and site host (e.g. yourorg.atlassian.net).',
      'The account needs agent (or admin) access to the service desks; a read-only customer account cannot list requests via the Jira search API.',
    ],
  },
  rateLimit:
    'Jira Cloud uses cost-based rate limiting; 429 responses with Retry-After are honored by the shared HTTP client.',
  limitations: [
    'Service desks are enumerated via the Service Desk API; requests are read via the Jira Cloud REST v3 issue search (service desk requests are Jira issues).',
    'Request status-change events are derived from each request changelog; only `status` field transitions are written.',
    'SLA breach events are derived from completed SLA cycles on each request; SLA field IDs are auto-discovered per site, and ongoing (unfinished) cycles are skipped. When the account cannot see any SLA fields, no SLA events are written.',
    'Targets Jira Service Management Cloud; Jira Service Management Data Center / Server is out of scope.',
  ],
});

export type JsmResource =
  | 'service_desks'
  | 'requests'
  | 'request_events'
  | 'sla_breaches';

export interface JsmSettings {
  host: string;
  projectKeys?: readonly string[];
  resources?: readonly JsmResource[];
}

const jsmCredentials = {
  email: {
    description: 'Atlassian account email',
    auth: 'required' as const,
  },
  apiToken: {
    description: 'Atlassian API token',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type JsmCredentials = typeof jsmCredentials;

const PHASE_ORDER = ['service_desks', 'requests'] as const;

type JsmPhase = (typeof PHASE_ORDER)[number];

const isJsmSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const SERVICE_DESK_ENTITY = 'jsm_service_desk';
const REQUEST_ENTITY = 'jsm_request';
const REQUEST_STATUS_EVENT = 'jsm_request_status_change';
const SLA_EVENT = 'jsm_sla_cycle';

const SERVICE_DESKS_PAGE_SIZE = 50;
const REQUESTS_PAGE_SIZE = 100;
const CHANGELOG_PAGE_SIZE = 100;
const CHANGELOG_INLINE_CAP = 100;

const SLA_FIELD_CUSTOM_TYPE = 'com.atlassian.servicedesk:sd-sla-field';
const REQUEST_TYPE_FIELD_CUSTOM_TYPE = 'com.atlassian.servicedesk:vp-origin';

const ISSUE_FIELDS = [
  'summary',
  'status',
  'priority',
  'issuetype',
  'assignee',
  'reporter',
  'project',
  'created',
  'updated',
  'resolutiondate',
] as const;

const idString = z.string().min(1);
const nonNegInt = z.number().int().nonnegative();

const accountRefSchema = z.object({
  accountId: idString,
  displayName: z.string().nullable().optional(),
});

const serviceDeskSchema = z.object({
  id: idString,
  projectId: z.union([z.string(), z.number()]).nullable().optional(),
  projectKey: z.string().nullable().optional(),
  projectName: z.string().nullable().optional(),
});

const serviceDesksResponseSchema = z.object({
  values: z.array(serviceDeskSchema),
  isLastPage: z.boolean().optional(),
  size: nonNegInt.optional(),
  start: nonNegInt.optional(),
  limit: nonNegInt.optional(),
});

const changelogHistorySchema = z.object({
  id: idString,
  created: z.iso.datetime(),
  author: accountRefSchema.nullable().optional(),
  items: z.array(
    z.object({
      field: z.string(),
      fromString: z.string().nullable().optional(),
      toString: z.string().nullable().optional(),
    }),
  ),
});

const issueSchema = z.object({
  id: idString,
  key: z.string().min(1),
  fields: z.object({
    summary: z.string().nullable().optional(),
    status: z
      .object({
        name: z.string(),
        statusCategory: z
          .object({ key: z.string(), name: z.string().nullable().optional() })
          .nullable()
          .optional(),
      })
      .nullable()
      .optional(),
    priority: z.object({ name: z.string() }).nullable().optional(),
    issuetype: z.object({ name: z.string() }).nullable().optional(),
    assignee: accountRefSchema.nullable().optional(),
    reporter: accountRefSchema.nullable().optional(),
    project: z
      .object({ id: idString, key: z.string().min(1) })
      .nullable()
      .optional(),
    created: z.iso.datetime(),
    updated: z.iso.datetime(),
    resolutiondate: z.iso.datetime().nullable().optional(),
  }),
  changelog: z.object({ histories: z.array(changelogHistorySchema) }),
});

const issuesResponseSchema = z.object({
  issues: z.array(issueSchema),
  nextPageToken: z.string().nullable().optional(),
  isLast: z.boolean().optional(),
});

const slaCycleSchema = z.object({
  startTime: z.object({ epochMillis: z.number() }).nullable().optional(),
  stopTime: z.object({ epochMillis: z.number() }).nullable().optional(),
  breached: z.boolean().nullable().optional(),
  goalDuration: z.object({ millis: z.number() }).nullable().optional(),
  elapsedTime: z.object({ millis: z.number() }).nullable().optional(),
  remainingTime: z.object({ millis: z.number() }).nullable().optional(),
});

const slaFieldValueSchema = z.object({
  completedCycles: z.array(slaCycleSchema).nullable().optional(),
});

const requestTypeFieldValueSchema = z.object({
  requestType: z
    .object({ id: idString.optional(), name: z.string().nullable().optional() })
    .nullable()
    .optional(),
});

const fieldListSchema = z.array(
  z.object({
    id: idString,
    name: z.string().nullable().optional(),
    schema: z
      .object({ custom: z.string().nullable().optional() })
      .nullable()
      .optional(),
  }),
);

interface ServiceDeskRecord {
  id: string;
  projectId?: string | number | null;
  projectKey?: string | null;
  projectName?: string | null;
}

interface ServiceDesksPage {
  values: ServiceDeskRecord[];
  isLastPage?: boolean;
}

interface JsmChangelogHistory {
  id: string;
  created: string;
  author?: { accountId: string; displayName?: string | null } | null;
  items: Array<{
    field: string;
    fromString?: string | null;
    toString?: string | null;
  }>;
}

interface JsmIssue {
  id: string;
  key: string;
  fields: {
    summary?: string | null;
    status?: {
      name: string;
      statusCategory?: { key: string; name?: string | null } | null;
    } | null;
    priority?: { name: string } | null;
    issuetype?: { name: string } | null;
    assignee?: { accountId: string; displayName?: string | null } | null;
    reporter?: { accountId: string; displayName?: string | null } | null;
    project?: { id: string; key: string } | null;
    created: string;
    updated: string;
    resolutiondate?: string | null;
    [key: string]: unknown;
  };
  changelog?: { histories: JsmChangelogHistory[] } | null;
}

interface JsmSearchResponse {
  issues: JsmIssue[];
  nextPageToken?: string | null;
  isLast?: boolean;
}

interface JsmChangelogPage {
  values: JsmChangelogHistory[];
  isLast?: boolean;
  startAt: number;
  maxResults: number;
  total: number;
}

interface JsmSelf {
  timeZone?: string | null;
}

interface JsmFieldMap {
  slaFields: Array<{ id: string; name: string }>;
  requestTypeFieldId: string | null;
}

function parseOffset(page: string | null): number {
  if (page === null) {
    return 0;
  }
  const n = Number.parseInt(page, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function formatJqlDateUtc(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
}

function formatJqlDate(iso: string, timeZone: string | null): string | null {
  const ms = parseEpoch(iso, 'iso');
  if (ms === null) {
    return null;
  }
  if (timeZone === null) {
    return formatJqlDateUtc(ms);
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(ms));
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
  } catch (err) {
    console.warn(
      `[connector-jira-service-management] could not format JQL date in time zone "${timeZone}", falling back to UTC: ${String(err)}`,
    );
    return formatJqlDateUtc(ms);
  }
}

function jqlQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export const jsmResources = defineResources({
  [SERVICE_DESK_ENTITY]: {
    shape: 'entity',
    filterable: [],
    description:
      'Service desks on the site, with the backing project id, key, and name.',
    endpoint: 'GET /rest/servicedeskapi/servicedesk',
    fields: [
      { name: 'projectId', description: 'Id of the backing Jira project.' },
      { name: 'projectKey', description: 'Key of the backing Jira project.' },
      { name: 'projectName', description: 'Name of the service desk project.' },
    ],
    responses: { service_desks: serviceDesksResponseSchema },
  },
  [REQUEST_ENTITY]: {
    shape: 'entity',
    filterable: [
      { field: 'statusName', ops: ['eq'] },
      { field: 'priority', ops: ['eq'] },
    ],
    description:
      'Service desk requests with status, priority, request/issue type, assignee, reporter, project, created and resolution timestamps.',
    endpoint: 'GET /rest/api/3/search/jql',
    notes:
      'Service desk requests are Jira issues; the sync is scoped to service desk projects.',
    fields: [
      { name: 'key', description: 'Human-readable request key (e.g. IT-42).' },
      { name: 'summary', description: 'Request summary.' },
      { name: 'statusName', description: 'Current workflow status name.' },
      {
        name: 'statusCategory',
        description:
          'Status category key (new, indeterminate, done) for open/closed grouping.',
      },
      { name: 'priority', description: 'Priority name (null if unset).' },
      {
        name: 'requestType',
        description:
          'Customer request type name when a request-type field is present (null otherwise).',
      },
      { name: 'issueType', description: 'Underlying Jira issue type name.' },
      {
        name: 'assigneeId',
        description: 'Account id of the assignee (null if unassigned).',
      },
      { name: 'reporterId', description: 'Account id of the reporter.' },
      {
        name: 'projectKey',
        description: 'Key of the owning service desk project.',
      },
      {
        name: 'createdAt',
        description: 'When the request was created (Unix ms).',
      },
      {
        name: 'resolvedAt',
        description:
          'When the request was resolved (Unix ms, null if unresolved).',
      },
    ],
    responses: { requests: issuesResponseSchema },
  },
  [REQUEST_STATUS_EVENT]: {
    shape: 'event',
    filterable: [],
    description:
      'Request status transition events derived from request changelogs, capturing the from/to status, author, and project.',
    endpoint: 'GET /rest/api/3/search/jql (expand=changelog)',
    notes:
      'start_ts is the changelog entry time, end_ts is null. Timestamps are Unix epoch milliseconds.',
    fields: [
      { name: 'historyId', description: 'Changelog history id.' },
      { name: 'requestId', description: 'Issue id of the request.' },
      { name: 'requestKey', description: 'Human-readable request key.' },
      {
        name: 'projectKey',
        description: 'Key of the owning service desk project.',
      },
      { name: 'authorId', description: 'Account id of the transition author.' },
      { name: 'fromStatus', description: 'Status the request moved from.' },
      { name: 'toStatus', description: 'Status the request moved to.' },
    ],
  },
  [SLA_EVENT]: {
    shape: 'event',
    filterable: [],
    description:
      'SLA cycle completion events derived from completed SLA cycles on each request; each event flags whether the SLA goal was breached.',
    endpoint: 'GET /rest/api/3/search/jql (SLA custom fields)',
    notes:
      'start_ts is the cycle stop time, end_ts is null. `breached` is 1 when the SLA goal was missed. Aggregate breach rate as an average of `breached` in the widget definition.',
    fields: [
      { name: 'requestId', description: 'Issue id of the request.' },
      { name: 'requestKey', description: 'Human-readable request key.' },
      {
        name: 'projectKey',
        description: 'Key of the owning service desk project.',
      },
      {
        name: 'slaName',
        description: 'Name of the SLA (e.g. Time to resolution).',
      },
      {
        name: 'breached',
        description: '1 when the SLA goal was breached, 0 when it was met.',
      },
      {
        name: 'startedAt',
        description: 'When the SLA cycle started (Unix ms).',
      },
      { name: 'goalMs', description: 'SLA goal duration in milliseconds.' },
      {
        name: 'elapsedMs',
        description: 'Elapsed working time in milliseconds.',
      },
    ],
  },
});

export const id = 'jira-service-management';

export class JiraServiceManagementConnector extends BaseConnector<
  JsmSettings,
  JsmCredentials
> {
  static readonly id = id;

  static readonly resources = jsmResources;

  static readonly schemas = schemasFromResources(jsmResources);

  static create(
    input: unknown,
    ctx?: ConnectorContext,
  ): JiraServiceManagementConnector {
    const parsed = configFields.parse(input);
    return new JiraServiceManagementConnector(
      {
        host: parsed.host,
        projectKeys: parsed.projectKeys,
        resources: parsed.resources,
      },
      { email: parsed.email, apiToken: parsed.apiToken },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = jsmCredentials;

  private accountTimeZone: string | null | undefined;
  private projectKeys: readonly string[] | undefined;
  private fieldMap: JsmFieldMap | undefined;

  private get baseUrl(): string {
    const host = this.settings.host
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');
    return `https://${host}`;
  }

  private buildHeaders(): Record<string, string> {
    const basic = btoa(`${this.creds.email}:${this.creds.apiToken}`);
    return {
      Authorization: `Basic ${basic}`,
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('jira-service-management'),
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
    });
  }

  private activePhases(): JsmPhase[] {
    return selectActivePhases<JsmResource, JsmPhase>(
      (r) => {
        switch (r) {
          case 'service_desks':
            return 'service_desks';
          case 'requests':
          case 'request_events':
          case 'sla_breaches':
            return 'requests';
        }
      },
      PHASE_ORDER,
      this.settings.resources,
    );
  }

  private async resolveAccountTimeZone(
    signal: AbortSignal | undefined,
  ): Promise<string | null> {
    if (this.accountTimeZone !== undefined) {
      return this.accountTimeZone;
    }
    try {
      const res = await this.fetch<JsmSelf>(
        `${this.baseUrl}/rest/api/3/myself`,
        'requests',
        signal,
      );
      const tz = res.body.timeZone;
      this.accountTimeZone =
        typeof tz === 'string' && tz.length > 0 ? tz : null;
    } catch (err) {
      console.warn(
        `[connector-jira-service-management] could not resolve account time zone, falling back to UTC: ${String(err)}`,
      );
      this.accountTimeZone = null;
    }
    return this.accountTimeZone;
  }

  private async fetchServiceDesksPage(
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<{ items: ServiceDeskRecord[]; next: string | null }> {
    const startAt = parseOffset(page);
    const u = new URL(`${this.baseUrl}/rest/servicedeskapi/servicedesk`);
    u.searchParams.set('start', String(startAt));
    u.searchParams.set('limit', String(SERVICE_DESKS_PAGE_SIZE));
    const res = await this.fetch<ServiceDesksPage>(
      u.toString(),
      'service_desks',
      signal,
    );
    const values = Array.isArray(res.body.values) ? res.body.values : [];
    const isLast =
      res.body.isLastPage === true || values.length < SERVICE_DESKS_PAGE_SIZE;
    const next =
      isLast || values.length === 0 ? null : String(startAt + values.length);
    return { items: values, next };
  }

  private async resolveProjectKeys(
    signal: AbortSignal | undefined,
  ): Promise<readonly string[]> {
    if (this.projectKeys !== undefined) {
      return this.projectKeys;
    }
    if (this.settings.projectKeys && this.settings.projectKeys.length > 0) {
      this.projectKeys = this.settings.projectKeys;
      return this.projectKeys;
    }
    const keys: string[] = [];
    let page: string | null = null;
    try {
      do {
        const { items, next } = await this.fetchServiceDesksPage(page, signal);
        for (const desk of items) {
          if (
            typeof desk.projectKey === 'string' &&
            desk.projectKey.length > 0
          ) {
            keys.push(desk.projectKey);
          }
        }
        page = next;
      } while (page !== null);
    } catch (err) {
      console.warn(
        `[connector-jira-service-management] could not enumerate service desks for project scoping, syncing all visible requests: ${String(err)}`,
      );
    }
    this.projectKeys = keys;
    return this.projectKeys;
  }

  private async resolveFieldMap(
    signal: AbortSignal | undefined,
  ): Promise<JsmFieldMap> {
    if (this.fieldMap !== undefined) {
      return this.fieldMap;
    }
    const map: JsmFieldMap = { slaFields: [], requestTypeFieldId: null };
    try {
      const res = await this.fetch<unknown>(
        `${this.baseUrl}/rest/api/3/field`,
        'requests',
        signal,
      );
      const fields = fieldListSchema.safeParse(res.body);
      if (fields.success) {
        for (const field of fields.data) {
          const custom = field.schema?.custom ?? null;
          if (custom === SLA_FIELD_CUSTOM_TYPE) {
            map.slaFields.push({ id: field.id, name: field.name ?? field.id });
          } else if (
            custom === REQUEST_TYPE_FIELD_CUSTOM_TYPE &&
            map.requestTypeFieldId === null
          ) {
            map.requestTypeFieldId = field.id;
          }
        }
      }
    } catch (err) {
      console.warn(
        `[connector-jira-service-management] could not resolve custom fields (SLA / request type), continuing without them: ${String(err)}`,
      );
    }
    this.fieldMap = map;
    return this.fieldMap;
  }

  private buildJql(
    options: SyncOptions,
    projectKeys: readonly string[],
    timeZone: string | null,
  ): string {
    const clauses: string[] = [];
    if (projectKeys.length > 0) {
      const quoted = projectKeys.map((k) => jqlQuote(k));
      clauses.push(`project in (${quoted.join(',')})`);
    }
    if (options.mode === 'latest' && options.since) {
      const formatted = formatJqlDate(options.since, timeZone);
      if (formatted !== null) {
        clauses.push(`updated >= "${formatted}"`);
      }
    }
    const where = clauses.join(' AND ');
    return where.length > 0
      ? `${where} ORDER BY updated ASC`
      : 'ORDER BY updated ASC';
  }

  private async fetchRequestsPage(
    page: string | null,
    options: SyncOptions,
    signal: AbortSignal | undefined,
  ): Promise<{ items: JsmIssue[]; next: string | null }> {
    const projectKeys = await this.resolveProjectKeys(signal);
    const fieldMap = await this.resolveFieldMap(signal);
    const timeZone =
      options.mode === 'latest' && options.since
        ? await this.resolveAccountTimeZone(signal)
        : null;

    const wantSla = this.isResourceEnabled('sla_breaches');
    const extraFields: string[] = [];
    if (fieldMap.requestTypeFieldId !== null) {
      extraFields.push(fieldMap.requestTypeFieldId);
    }
    if (wantSla) {
      for (const sla of fieldMap.slaFields) {
        extraFields.push(sla.id);
      }
    }

    const u = new URL(`${this.baseUrl}/rest/api/3/search/jql`);
    u.searchParams.set('jql', this.buildJql(options, projectKeys, timeZone));
    u.searchParams.set('maxResults', String(REQUESTS_PAGE_SIZE));
    u.searchParams.set('fields', [...ISSUE_FIELDS, ...extraFields].join(','));
    u.searchParams.set('expand', 'changelog');
    if (page !== null) {
      u.searchParams.set('nextPageToken', page);
    }
    const res = await this.fetch<JsmSearchResponse>(
      u.toString(),
      'requests',
      signal,
    );
    const issues = Array.isArray(res.body.issues) ? res.body.issues : [];
    if (this.isResourceEnabled('request_events')) {
      for (const issue of issues) {
        const histories = issue.changelog?.histories ?? [];
        if (histories.length >= CHANGELOG_INLINE_CAP) {
          issue.changelog = {
            histories: await this.fetchFullChangelog(issue.id, signal),
          };
        }
      }
    }
    const token = res.body.nextPageToken ?? null;
    const next = res.body.isLast === true || token === null ? null : token;
    return { items: issues, next };
  }

  private async fetchFullChangelog(
    issueId: string,
    signal: AbortSignal | undefined,
  ): Promise<JsmChangelogHistory[]> {
    const out: JsmChangelogHistory[] = [];
    let startAt = 0;
    while (true) {
      signal?.throwIfAborted();
      const u = new URL(
        `${this.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueId)}/changelog`,
      );
      u.searchParams.set('startAt', String(startAt));
      u.searchParams.set('maxResults', String(CHANGELOG_PAGE_SIZE));
      const res = await this.fetch<JsmChangelogPage>(
        u.toString(),
        'requests',
        signal,
      );
      const values = res.body.values;
      out.push(...values);
      const isLast = res.body.isLast ?? values.length < CHANGELOG_PAGE_SIZE;
      if (isLast || values.length === 0) {
        break;
      }
      startAt += values.length;
    }
    return out;
  }

  private async writeServiceDesks(
    storage: StorageHandle,
    desks: ServiceDeskRecord[],
  ): Promise<void> {
    const now = Date.now();
    for (const desk of desks) {
      await storage.entity({
        type: SERVICE_DESK_ENTITY,
        id: String(desk.id),
        attributes: {
          projectId:
            desk.projectId === null || desk.projectId === undefined
              ? null
              : String(desk.projectId),
          projectKey: desk.projectKey ?? null,
          projectName: desk.projectName ?? null,
        },
        updated_at: now,
      });
    }
  }

  private requestType(issue: JsmIssue): string | null {
    const fieldId = this.fieldMap?.requestTypeFieldId;
    if (!fieldId) {
      return null;
    }
    const parsed = requestTypeFieldValueSchema.safeParse(issue.fields[fieldId]);
    if (!parsed.success) {
      return null;
    }
    return parsed.data.requestType?.name ?? null;
  }

  private async writeRequests(
    storage: StorageHandle,
    issues: JsmIssue[],
    sinceMs: number | null,
  ): Promise<void> {
    const writeEntities = this.isResourceEnabled('requests');
    const writeEvents = this.isResourceEnabled('request_events');
    const writeSla = this.isResourceEnabled('sla_breaches');

    for (const issue of issues) {
      const f = issue.fields;
      const createdMs = parseEpoch(f.created, 'iso');
      const updatedMs = parseEpoch(f.updated, 'iso');
      if (createdMs === null || updatedMs === null) {
        console.warn(
          `[connector-jira-service-management] skipping request ${issue.key} with unparseable created/updated`,
        );
        continue;
      }
      const projectKey = f.project?.key ?? null;

      if (writeEntities) {
        await storage.entity({
          type: REQUEST_ENTITY,
          id: issue.id,
          attributes: {
            key: issue.key,
            summary: f.summary ?? null,
            statusName: f.status?.name ?? null,
            statusCategory: f.status?.statusCategory?.key ?? null,
            priority: f.priority?.name ?? null,
            requestType: this.requestType(issue),
            issueType: f.issuetype?.name ?? null,
            assigneeId: f.assignee?.accountId ?? null,
            reporterId: f.reporter?.accountId ?? null,
            projectKey,
            createdAt: createdMs,
            resolvedAt: parseEpoch(f.resolutiondate ?? null, 'iso'),
          },
          updated_at: updatedMs,
        });
      }

      if (writeEvents) {
        const histories = issue.changelog?.histories ?? [];
        for (const h of histories) {
          const ts = parseEpoch(h.created, 'iso');
          if (ts === null || (sinceMs !== null && ts <= sinceMs)) {
            continue;
          }
          for (const item of h.items) {
            if (item.field !== 'status') {
              continue;
            }
            const attributes: Record<string, JSONValue> = {
              historyId: h.id,
              requestId: issue.id,
              requestKey: issue.key,
              projectKey,
              authorId: h.author?.accountId ?? null,
              fromStatus: item.fromString ?? null,
              toStatus: item.toString ?? null,
            };
            await storage.event({
              name: REQUEST_STATUS_EVENT,
              start_ts: ts,
              end_ts: null,
              attributes,
            });
          }
        }
      }

      if (writeSla) {
        await this.writeSlaCycles(storage, issue, projectKey, sinceMs);
      }
    }
  }

  private async writeSlaCycles(
    storage: StorageHandle,
    issue: JsmIssue,
    projectKey: string | null,
    sinceMs: number | null,
  ): Promise<void> {
    const slaFields = this.fieldMap?.slaFields ?? [];
    for (const sla of slaFields) {
      const parsed = slaFieldValueSchema.safeParse(issue.fields[sla.id]);
      if (!parsed.success) {
        continue;
      }
      const cycles = parsed.data.completedCycles ?? [];
      for (const cycle of cycles) {
        const stopMs = cycle.stopTime?.epochMillis ?? null;
        if (stopMs === null || (sinceMs !== null && stopMs <= sinceMs)) {
          continue;
        }
        const attributes: Record<string, JSONValue> = {
          requestId: issue.id,
          requestKey: issue.key,
          projectKey,
          slaName: sla.name,
          breached: cycle.breached ? 1 : 0,
          startedAt: cycle.startTime?.epochMillis ?? null,
          goalMs: cycle.goalDuration?.millis ?? null,
          elapsedMs: cycle.elapsedTime?.millis ?? null,
        };
        await storage.event({
          name: SLA_EVENT,
          start_ts: stopMs,
          end_ts: null,
          attributes,
        });
      }
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = isJsmSyncCursor(options.cursor) ? options.cursor : undefined;
    const isFull = options.mode === 'full';
    const sinceMs = options.since ? parseEpoch(options.since, 'iso') : null;
    const phases = this.activePhases();

    return paginateChunked<JsmPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'service_desks':
            return this.fetchServiceDesksPage(page, sig);
          case 'requests':
            return this.fetchRequestsPage(page, options, sig);
        }
      },
      writeBatch: async (phase, items, page) => {
        if (page === null) {
          if (phase === 'service_desks') {
            if (isFull) {
              await storage.entities([], { types: [SERVICE_DESK_ENTITY] });
            }
          } else {
            if (isFull && this.isResourceEnabled('requests')) {
              await storage.entities([], { types: [REQUEST_ENTITY] });
            }
            if (isFull && this.isResourceEnabled('request_events')) {
              await storage.events([], { names: [REQUEST_STATUS_EVENT] });
            }
            if (isFull && this.isResourceEnabled('sla_breaches')) {
              await storage.events([], { names: [SLA_EVENT] });
            }
          }
        }
        switch (phase) {
          case 'service_desks':
            return this.writeServiceDesks(
              storage,
              items as ServiceDeskRecord[],
            );
          case 'requests':
            return this.writeRequests(storage, items as JsmIssue[], sinceMs);
        }
      },
    });
  }
}
