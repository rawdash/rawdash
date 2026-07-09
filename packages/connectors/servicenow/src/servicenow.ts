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
  type FetchSpec,
  type FilterClause,
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
    instanceUrl: z
      .string()
      .trim()
      .min(1)
      .regex(
        /^(https?:\/\/)?[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i,
        'Provide your ServiceNow instance host (e.g. "acme.service-now.com") or its full https base URL, without a path.',
      )
      .meta({
        label: 'Instance URL',
        description:
          'Your ServiceNow instance host; the "acme" part becomes acme.service-now.com. A bare host or a full https URL both work.',
        placeholder: 'acme.service-now.com',
      }),
    username: z.string().trim().min(1).meta({
      label: 'Username',
      description:
        'ServiceNow user with read access to the incident, change_request, and problem tables. A dedicated integration/service account is recommended.',
      placeholder: 'rawdash.integration',
    }),
    password: z.object({ $secret: z.string() }).meta({
      label: 'Password',
      description:
        'Password for the ServiceNow user, paired with the username for HTTP Basic auth.',
      placeholder: 'SERVICENOW_PASSWORD',
      secret: true,
    }),
    resources: z
      .array(
        z.enum(['incidents', 'incident_events', 'change_requests', 'problems']),
      )
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which ServiceNow tables to sync. Omit to sync all of them. The account only needs read access to the tables listed here.',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'ServiceNow',
  category: 'support',
  brandColor: '#62D84E',
  tagline:
    'Sync incidents, incident state-change events, change requests, and problems from the ServiceNow Table API for incident volume, MTTR, and change-throughput analytics.',
  vendor: {
    name: 'ServiceNow',
    domain: 'servicenow.com',
    apiDocs:
      'https://developer.servicenow.com/dev.do#!/reference/api/latest/rest/c_TableAPI',
    website: 'https://www.servicenow.com',
  },
  auth: {
    summary:
      'HTTP Basic auth using a ServiceNow username and password. The account needs read access to the incident, change_request, and problem tables (the standard ITIL role covers these).',
    setup: [
      'Create (or reuse) a ServiceNow user for the integration, ideally a dedicated service account.',
      'Grant it a role with read access to the incident, change_request, and problem tables; the built-in `itil` role is sufficient.',
      'Store the password as a secret and reference it from config as `password: secret("SERVICENOW_PASSWORD")`, alongside the username and your instance host (the "acme" in acme.service-now.com).',
    ],
  },
  rateLimit:
    'ServiceNow applies per-instance inbound REST rate limits configured by the admin (default plans allow thousands of requests/hour); throttled requests return HTTP 429, which the shared HTTP client retries with backoff.',
  limitations: [
    'Incident state-change events are derived from each record’s opened/resolved/closed timestamps; the full sys_journal_field audit history is not synced.',
    'Reference fields (assignment group, assigned to, caller) are synced as sys_id values, not display names.',
    'Incremental syncs filter on `sys_updated_on`, which ServiceNow evaluates in the integration account timezone; set that account to UTC to avoid boundary gaps.',
    'SLA (task_sla) records, attachments, and journal comment bodies are out of scope.',
  ],
});

export interface ServiceNowSettings {
  instanceUrl: string;
  resources?: readonly ServiceNowResource[];
}

const servicenowCredentials = {
  username: {
    description: 'ServiceNow username',
    auth: 'required' as const,
  },
  password: {
    description: 'ServiceNow password',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type ServiceNowCredentials = typeof servicenowCredentials;

const PHASE_ORDER = [
  'incidents',
  'incident_events',
  'change_requests',
  'problems',
] as const;

type ServiceNowPhase = (typeof PHASE_ORDER)[number];

export type ServiceNowResource = ServiceNowPhase;

const isServiceNowSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const PAGE_SIZE = 100;

const INCIDENT_ENTITY = 'servicenow_incident';
const INCIDENT_STATE_EVENT = 'servicenow_incident_state_change';
const CHANGE_REQUEST_ENTITY = 'servicenow_change_request';
const PROBLEM_ENTITY = 'servicenow_problem';

const INCIDENT_STATE_LABELS: Record<string, string> = {
  '1': 'New',
  '2': 'In Progress',
  '3': 'On Hold',
  '6': 'Resolved',
  '7': 'Closed',
  '8': 'Canceled',
};

const PRIORITY_LABELS: Record<string, string> = {
  '1': 'Critical',
  '2': 'High',
  '3': 'Moderate',
  '4': 'Low',
  '5': 'Planning',
};

const INCIDENT_FIELDS = [
  'sys_id',
  'number',
  'short_description',
  'state',
  'priority',
  'urgency',
  'impact',
  'category',
  'assignment_group',
  'assigned_to',
  'caller_id',
  'active',
  'opened_at',
  'resolved_at',
  'closed_at',
  'sys_created_on',
  'sys_updated_on',
] as const;

const CHANGE_REQUEST_FIELDS = [
  'sys_id',
  'number',
  'short_description',
  'state',
  'priority',
  'risk',
  'type',
  'assignment_group',
  'assigned_to',
  'opened_at',
  'closed_at',
  'sys_created_on',
  'sys_updated_on',
] as const;

const PROBLEM_FIELDS = [
  'sys_id',
  'number',
  'short_description',
  'state',
  'priority',
  'assignment_group',
  'assigned_to',
  'opened_at',
  'sys_created_on',
  'sys_updated_on',
] as const;

const TABLE_BY_PHASE: Record<ServiceNowPhase, string> = {
  incidents: 'incident',
  incident_events: 'incident',
  change_requests: 'change_request',
  problems: 'problem',
};

const FIELDS_BY_PHASE: Record<ServiceNowPhase, readonly string[]> = {
  incidents: INCIDENT_FIELDS,
  incident_events: INCIDENT_FIELDS,
  change_requests: CHANGE_REQUEST_FIELDS,
  problems: PROBLEM_FIELDS,
};

const ENTITY_TYPE_BY_PHASE: Partial<Record<ServiceNowPhase, string>> = {
  incidents: INCIDENT_ENTITY,
  change_requests: CHANGE_REQUEST_ENTITY,
  problems: PROBLEM_ENTITY,
};

const referenceValue = z.union([z.string(), z.number()]).nullish();
const scalar = z.union([z.string(), z.number(), z.boolean()]).nullish();

const incidentSchema = z.object({
  sys_id: z.string().min(1),
  number: scalar,
  short_description: scalar,
  state: scalar,
  priority: scalar,
  urgency: scalar,
  impact: scalar,
  category: scalar,
  assignment_group: referenceValue,
  assigned_to: referenceValue,
  caller_id: referenceValue,
  active: scalar,
  opened_at: scalar,
  resolved_at: scalar,
  closed_at: scalar,
  sys_created_on: scalar,
  sys_updated_on: scalar,
});

const changeRequestSchema = z.object({
  sys_id: z.string().min(1),
  number: scalar,
  short_description: scalar,
  state: scalar,
  priority: scalar,
  risk: scalar,
  type: scalar,
  assignment_group: referenceValue,
  assigned_to: referenceValue,
  opened_at: scalar,
  closed_at: scalar,
  sys_created_on: scalar,
  sys_updated_on: scalar,
});

const problemSchema = z.object({
  sys_id: z.string().min(1),
  number: scalar,
  short_description: scalar,
  state: scalar,
  priority: scalar,
  assignment_group: referenceValue,
  assigned_to: referenceValue,
  opened_at: scalar,
  sys_created_on: scalar,
  sys_updated_on: scalar,
});

type IncidentRecord = z.infer<typeof incidentSchema>;
type ChangeRequestRecord = z.infer<typeof changeRequestSchema>;
type ProblemRecord = z.infer<typeof problemSchema>;

interface TableResponse<T> {
  result?: T[] | null;
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value === '' ? null : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function referenceId(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'object') {
    return asString((value as { value?: unknown }).value);
  }
  return asString(value);
}

function parseBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  const s = asString(value);
  if (s === null) {
    return null;
  }
  if (s === 'true' || s === '1') {
    return true;
  }
  if (s === 'false' || s === '0') {
    return false;
  }
  return null;
}

function snowDateToMs(value: unknown): number | null {
  const s = asString(value);
  if (s === null) {
    return null;
  }
  const normalized = s.includes('T')
    ? s
    : `${s.replace(' ', 'T')}${/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z'}`;
  return parseEpoch(normalized, 'iso');
}

function snowDateToMsOrZero(value: unknown): number {
  return snowDateToMs(value) ?? 0;
}

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isoToSnowDate(iso: string | undefined): string | null {
  if (!iso) {
    return null;
  }
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) {
    return null;
  }
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())} ` +
    `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`
  );
}

function mapLabel(
  table: Record<string, string>,
  code: string | null,
): string | null {
  if (code === null) {
    return null;
  }
  return table[code] ?? null;
}

export const servicenowResources = defineResources({
  [INCIDENT_ENTITY]: {
    shape: 'entity',
    filterable: [
      { field: 'state', ops: ['eq'] },
      { field: 'priority', ops: ['eq'] },
    ],
    description:
      'Incidents with state, priority, urgency, impact, assignment, and open/resolve/close timestamps.',
    endpoint: 'GET /api/now/table/incident',
    fields: [
      { name: 'number', description: 'Human-readable incident number (INC…).' },
      { name: 'shortDescription', description: 'Incident short description.' },
      {
        name: 'state',
        description: 'Raw incident state code (1 New … 7 Closed, 8 Canceled).',
      },
      {
        name: 'stateLabel',
        description: 'Human-readable state derived from the standard codes.',
      },
      { name: 'priority', description: 'Raw priority code (1 Critical … 5).' },
      {
        name: 'priorityLabel',
        description: 'Human-readable priority derived from the standard codes.',
      },
      { name: 'urgency', description: 'Raw urgency code.' },
      { name: 'impact', description: 'Raw impact code.' },
      { name: 'category', description: 'Incident category.' },
      {
        name: 'assignmentGroupId',
        description: 'sys_id of the assignment group (null if unassigned).',
      },
      {
        name: 'assignedToId',
        description: 'sys_id of the assigned user (null if unassigned).',
      },
      {
        name: 'callerId',
        description: 'sys_id of the caller who reported the incident.',
      },
      { name: 'active', description: 'Whether the incident is still active.' },
      {
        name: 'openedAt',
        description: 'When the incident was opened (Unix ms).',
      },
      {
        name: 'resolvedAt',
        description: 'When the incident was resolved (Unix ms, null if open).',
      },
      {
        name: 'closedAt',
        description: 'When the incident was closed (Unix ms, null if open).',
      },
      {
        name: 'createdAt',
        description: 'When the record was created (Unix ms).',
      },
    ],
    responses: { incidents: z.array(incidentSchema) },
  },
  [INCIDENT_STATE_EVENT]: {
    shape: 'event',
    filterable: [],
    description:
      'Incident state-change events (opened / resolved / closed) derived from each incident.',
    endpoint: 'GET /api/now/table/incident',
    notes:
      'Derived from each incident’s opened/resolved/closed timestamps; the scope is cleared and rewritten on every sync.',
    fields: [
      {
        name: 'incidentId',
        description: 'sys_id of the incident the event belongs to.',
      },
      { name: 'number', description: 'Human-readable incident number.' },
      { name: 'transition', description: 'opened, resolved, or closed.' },
      { name: 'state', description: 'Incident state code at sync time.' },
      { name: 'priority', description: 'Incident priority code at sync time.' },
      {
        name: 'assignmentGroupId',
        description: 'sys_id of the assignment group at sync time.',
      },
    ],
    responses: { incident_events: z.array(incidentSchema) },
  },
  [CHANGE_REQUEST_ENTITY]: {
    shape: 'entity',
    filterable: [],
    description:
      'Change requests with state, priority, risk, type, assignment, and open/close timestamps.',
    endpoint: 'GET /api/now/table/change_request',
    fields: [
      { name: 'number', description: 'Human-readable change number (CHG…).' },
      { name: 'shortDescription', description: 'Change short description.' },
      { name: 'state', description: 'Raw change state code.' },
      { name: 'priority', description: 'Raw priority code.' },
      { name: 'risk', description: 'Raw risk code.' },
      {
        name: 'type',
        description: 'Change type (normal, standard, emergency).',
      },
      {
        name: 'assignmentGroupId',
        description: 'sys_id of the assignment group (null if unassigned).',
      },
      {
        name: 'assignedToId',
        description: 'sys_id of the assigned user (null if unassigned).',
      },
      {
        name: 'openedAt',
        description: 'When the change was opened (Unix ms).',
      },
      {
        name: 'closedAt',
        description: 'When the change was closed (Unix ms, null if open).',
      },
      {
        name: 'createdAt',
        description: 'When the record was created (Unix ms).',
      },
    ],
    responses: { change_requests: z.array(changeRequestSchema) },
  },
  [PROBLEM_ENTITY]: {
    shape: 'entity',
    filterable: [],
    description:
      'Problems with state, priority, assignment, and open timestamps.',
    endpoint: 'GET /api/now/table/problem',
    fields: [
      { name: 'number', description: 'Human-readable problem number (PRB…).' },
      { name: 'shortDescription', description: 'Problem short description.' },
      { name: 'state', description: 'Raw problem state code.' },
      { name: 'priority', description: 'Raw priority code.' },
      {
        name: 'assignmentGroupId',
        description: 'sys_id of the assignment group (null if unassigned).',
      },
      {
        name: 'assignedToId',
        description: 'sys_id of the assigned user (null if unassigned).',
      },
      {
        name: 'openedAt',
        description: 'When the problem was opened (Unix ms).',
      },
      {
        name: 'createdAt',
        description: 'When the record was created (Unix ms).',
      },
    ],
    responses: { problems: z.array(problemSchema) },
  },
});

export const id = 'servicenow';

export class ServiceNowConnector extends BaseConnector<
  ServiceNowSettings,
  ServiceNowCredentials
> {
  static readonly id = id;

  static readonly resources = servicenowResources;

  static readonly schemas = schemasFromResources(servicenowResources);

  static create(input: unknown, ctx?: ConnectorContext): ServiceNowConnector {
    const parsed = configFields.parse(input);
    return new ServiceNowConnector(
      {
        instanceUrl: parsed.instanceUrl,
        resources: parsed.resources,
      },
      { username: parsed.username, password: parsed.password },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = servicenowCredentials;

  private get baseUrl(): string {
    const raw = this.settings.instanceUrl.trim().replace(/\/+$/, '');
    if (/^https?:\/\//i.test(raw)) {
      return raw;
    }
    return `https://${raw}`;
  }

  private singleSpec(
    options: SyncOptions,
    resource: string,
  ): FetchSpec | undefined {
    const specs = options.fetchSpecs?.[resource];
    return specs && specs.length === 1 ? specs[0] : undefined;
  }

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: encodeBasicAuth(this.creds.username, this.creds.password),
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('servicenow'),
    };
  }

  private apiGet<T>(
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

  private buildQuery(phase: ServiceNowPhase, options: SyncOptions): string {
    const clauses: string[] = [];
    const since = phase === 'incident_events' ? undefined : options.since;
    const sinceValue = isoToSnowDate(since);
    if (sinceValue !== null) {
      clauses.push(`sys_updated_on>=${sinceValue}`);
    }
    if (phase === 'incidents') {
      const spec = this.singleSpec(options, INCIDENT_ENTITY)?.filter;
      const state = pushableEq(spec, 'state');
      if (state !== null) {
        clauses.push(`state=${state}`);
      }
      const priority = pushableEq(spec, 'priority');
      if (priority !== null) {
        clauses.push(`priority=${priority}`);
      }
    }
    clauses.push('ORDERBYsys_updated_on');
    return clauses.join('^');
  }

  private buildTableUrl(
    phase: ServiceNowPhase,
    offset: number,
    options: SyncOptions,
  ): string {
    const params = new URLSearchParams({
      sysparm_limit: String(PAGE_SIZE),
      sysparm_offset: String(offset),
      sysparm_display_value: 'false',
      sysparm_exclude_reference_link: 'true',
      sysparm_fields: FIELDS_BY_PHASE[phase].join(','),
      sysparm_query: this.buildQuery(phase, options),
    });
    return `${this.baseUrl}/api/now/table/${TABLE_BY_PHASE[phase]}?${params.toString()}`;
  }

  private async fetchTable(
    phase: ServiceNowPhase,
    page: string | null,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<{ items: unknown[]; next: string | null }> {
    const offset = page ? Number(page) : 0;
    const res = await this.apiGet<TableResponse<unknown>>(
      this.buildTableUrl(phase, offset, options),
      phase,
      signal,
    );
    const items = res.body.result ?? [];
    const next = items.length === PAGE_SIZE ? String(offset + PAGE_SIZE) : null;
    return { items, next };
  }

  private async writeIncidents(
    storage: StorageHandle,
    items: IncidentRecord[],
  ): Promise<void> {
    for (const incident of items) {
      const state = asString(incident.state);
      const priority = asString(incident.priority);
      const attributes: Record<string, JSONValue> = {
        number: asString(incident.number),
        shortDescription: asString(incident.short_description),
        state,
        stateLabel: mapLabel(INCIDENT_STATE_LABELS, state),
        priority,
        priorityLabel: mapLabel(PRIORITY_LABELS, priority),
        urgency: asString(incident.urgency),
        impact: asString(incident.impact),
        category: asString(incident.category),
        assignmentGroupId: referenceId(incident.assignment_group),
        assignedToId: referenceId(incident.assigned_to),
        callerId: referenceId(incident.caller_id),
        active: parseBool(incident.active),
        openedAt: snowDateToMs(incident.opened_at),
        resolvedAt: snowDateToMs(incident.resolved_at),
        closedAt: snowDateToMs(incident.closed_at),
        createdAt: snowDateToMs(incident.sys_created_on),
      };
      await storage.entity({
        type: INCIDENT_ENTITY,
        id: incident.sys_id,
        attributes,
        updated_at: snowDateToMsOrZero(
          incident.sys_updated_on ?? incident.sys_created_on,
        ),
      });
    }
  }

  private async writeIncidentEvents(
    storage: StorageHandle,
    items: IncidentRecord[],
  ): Promise<void> {
    for (const incident of items) {
      const baseAttrs: Record<string, JSONValue> = {
        incidentId: incident.sys_id,
        number: asString(incident.number),
        state: asString(incident.state),
        priority: asString(incident.priority),
        assignmentGroupId: referenceId(incident.assignment_group),
      };

      const openedMs =
        snowDateToMs(incident.opened_at) ??
        snowDateToMs(incident.sys_created_on);
      if (openedMs !== null) {
        await storage.event({
          name: INCIDENT_STATE_EVENT,
          start_ts: openedMs,
          end_ts: null,
          attributes: { ...baseAttrs, transition: 'opened' },
        });
      }

      const resolvedMs = snowDateToMs(incident.resolved_at);
      if (resolvedMs !== null) {
        await storage.event({
          name: INCIDENT_STATE_EVENT,
          start_ts: resolvedMs,
          end_ts: null,
          attributes: { ...baseAttrs, transition: 'resolved' },
        });
      }

      const closedMs = snowDateToMs(incident.closed_at);
      if (closedMs !== null) {
        await storage.event({
          name: INCIDENT_STATE_EVENT,
          start_ts: closedMs,
          end_ts: null,
          attributes: { ...baseAttrs, transition: 'closed' },
        });
      }
    }
  }

  private async writeChangeRequests(
    storage: StorageHandle,
    items: ChangeRequestRecord[],
  ): Promise<void> {
    for (const change of items) {
      await storage.entity({
        type: CHANGE_REQUEST_ENTITY,
        id: change.sys_id,
        attributes: {
          number: asString(change.number),
          shortDescription: asString(change.short_description),
          state: asString(change.state),
          priority: asString(change.priority),
          risk: asString(change.risk),
          type: asString(change.type),
          assignmentGroupId: referenceId(change.assignment_group),
          assignedToId: referenceId(change.assigned_to),
          openedAt: snowDateToMs(change.opened_at),
          closedAt: snowDateToMs(change.closed_at),
          createdAt: snowDateToMs(change.sys_created_on),
        },
        updated_at: snowDateToMsOrZero(
          change.sys_updated_on ?? change.sys_created_on,
        ),
      });
    }
  }

  private async writeProblems(
    storage: StorageHandle,
    items: ProblemRecord[],
  ): Promise<void> {
    for (const problem of items) {
      await storage.entity({
        type: PROBLEM_ENTITY,
        id: problem.sys_id,
        attributes: {
          number: asString(problem.number),
          shortDescription: asString(problem.short_description),
          state: asString(problem.state),
          priority: asString(problem.priority),
          assignmentGroupId: referenceId(problem.assignment_group),
          assignedToId: referenceId(problem.assigned_to),
          openedAt: snowDateToMs(problem.opened_at),
          createdAt: snowDateToMs(problem.sys_created_on),
        },
        updated_at: snowDateToMsOrZero(
          problem.sys_updated_on ?? problem.sys_created_on,
        ),
      });
    }
  }

  private async clearScopeOnFirstPage(
    storage: StorageHandle,
    phase: ServiceNowPhase,
    isFull: boolean,
  ): Promise<void> {
    if (phase === 'incident_events') {
      await storage.events([], { names: [INCIDENT_STATE_EVENT] });
      return;
    }
    if (!isFull) {
      return;
    }
    const entityType = ENTITY_TYPE_BY_PHASE[phase];
    if (entityType) {
      await storage.entities([], { types: [entityType] });
    }
  }

  private async writePhase(
    storage: StorageHandle,
    phase: ServiceNowPhase,
    items: unknown[],
  ): Promise<void> {
    switch (phase) {
      case 'incidents':
        await this.writeIncidents(storage, items as IncidentRecord[]);
        return;
      case 'incident_events':
        await this.writeIncidentEvents(storage, items as IncidentRecord[]);
        return;
      case 'change_requests':
        await this.writeChangeRequests(storage, items as ChangeRequestRecord[]);
        return;
      case 'problems':
        await this.writeProblems(storage, items as ProblemRecord[]);
        return;
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = isServiceNowSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';

    const phases = selectActivePhases<ServiceNowResource, ServiceNowPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<ServiceNowPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: (phase, page, sig) =>
        this.fetchTable(phase, page, options, sig),
      writeBatch: async (phase, items, page) => {
        if (page === null) {
          await this.clearScopeOnFirstPage(storage, phase, isFull);
        }
        await this.writePhase(storage, phase, items);
      },
    });
  }
}

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
      (typeof clause.value === 'string' || typeof clause.value === 'number')
    ) {
      return String(clause.value);
    }
  }
  return null;
}

function encodeBasicAuth(username: string, secret: string): string {
  const raw = `${username}:${secret}`;
  if (typeof btoa === 'function') {
    return `Basic ${btoa(raw)}`;
  }
  const bufferCtor = (
    globalThis as {
      Buffer?: { from: (s: string) => { toString: (enc: string) => string } };
    }
  ).Buffer;
  if (bufferCtor) {
    return `Basic ${bufferCtor.from(raw).toString('base64')}`;
  }
  throw new Error('No base64 encoder available in this runtime');
}
