import {
  type HttpResponse,
  connectorUserAgent,
  parseEpoch,
  sanitizeAllowedUrl,
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

// ---------------------------------------------------------------------------
// configFields
// ---------------------------------------------------------------------------

export const configFields = defineConfigFields(
  z.object({
    apiKey: z.object({ $secret: z.string() }).meta({
      label: 'API Key',
      description:
        'Statuspage REST API key. Create one at Manage Account -> API Info -> API Key.',
      placeholder: 'sk_live_...',
      secret: true,
    }),
    pageId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{12}$/, 'Page ID must be 12 alphanumeric characters.')
      .meta({
        label: 'Page ID',
        description:
          'Statuspage page id (the 12-character identifier shown next to your page name in Manage Account -> API Info, also visible in the admin URL).',
        placeholder: 'abc123def456',
      }),
    resources: z
      .array(z.enum(['components', 'incidents', 'incident_updates']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          "Which Statuspage resources to sync. Omit to sync all of them. 'incident_updates' rides the 'incidents' phase - enabling it without 'incidents' still fetches incidents but skips writing incident entities.",
      }),
    incidentLookbackDays: z.number().int().positive().max(365).optional().meta({
      label: 'Incident lookback (days)',
      description:
        'How many days back to fetch incidents (and their updates) on a full sync. Defaults to 90. Statuspage returns incidents newest-first; this caps the backfill window.',
      placeholder: '90',
    }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Statuspage',
  category: 'engineering',
  brandColor: '#172B4D',
  tagline:
    'Sync Atlassian Statuspage components, incidents, and incident updates - current component health, recent incident history, and per-update status transitions.',
  vendor: {
    name: 'Atlassian Statuspage',
    domain: 'statuspage.io',
    apiDocs: 'https://developer.statuspage.io/',
    website: 'https://www.atlassian.com/software/statuspage',
  },
  auth: {
    summary:
      'A Statuspage REST API key is required. Keys are scoped to the issuing account and inherit that account read access; a read-only role is sufficient for the resources synced here.',
    setup: [
      'Open Statuspage -> Manage Account -> API Info.',
      'Copy the API Key (or generate one if none exists).',
      'Store the key as a secret and reference it from the connector config as `apiKey: secret("STATUSPAGE_API_KEY")`.',
      'Set `pageId` to your 12-character Page ID (shown on the same screen, e.g. `abc123def456`).',
    ],
  },
  rateLimit:
    'Statuspage rate-limits at roughly 1 request/second per page; this connector paginates sequentially and respects 429 Retry-After. The page size is 100.',
  limitations: [
    'Better Stack Uptime is a separate package and is tracked as a follow-up.',
    'Postmortem bodies, subscribers, metrics-provider configs, and template management are out of scope.',
    'Component groups are exposed via each component group_id but are not synced as separate entities.',
  ],
});

export type StatuspageResource =
  | 'components'
  | 'incidents'
  | 'incident_updates';

export interface StatuspageSettings {
  pageId: string;
  resources?: readonly StatuspageResource[];
  incidentLookbackDays?: number;
}

const statuspageCredentials = {
  apiKey: {
    description: 'Statuspage REST API key',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type StatuspageCredentials = typeof statuspageCredentials;

// ---------------------------------------------------------------------------
// Sync phases + cursor
// ---------------------------------------------------------------------------

const PHASE_ORDER = ['components', 'incidents'] as const;

type StatuspagePhase = (typeof PHASE_ORDER)[number];

type StatuspageSyncCursor = ChunkedSyncCursor<StatuspagePhase, string>;

const isStatuspageSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

// ---------------------------------------------------------------------------
// Statuspage API types
// ---------------------------------------------------------------------------

interface SPComponent {
  id: string;
  page_id: string;
  group_id?: string | null;
  name: string;
  description?: string | null;
  status: string;
  position?: number;
  showcase?: boolean;
  start_date?: string | null;
  group?: boolean;
  only_show_if_degraded?: boolean;
  automation_email?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface SPIncidentUpdate {
  id: string;
  incident_id: string;
  status: string;
  body: string;
  display_at?: string | null;
  created_at: string;
  updated_at?: string | null;
  affected_components?: unknown;
}

interface SPIncident {
  id: string;
  name: string;
  status: string;
  impact: string;
  page_id?: string;
  shortlink?: string | null;
  created_at: string;
  updated_at?: string | null;
  monitoring_at?: string | null;
  resolved_at?: string | null;
  scheduled_for?: string | null;
  scheduled_until?: string | null;
  components?: Array<{ id: string; name?: string; status?: string }>;
  incident_updates?: SPIncidentUpdate[];
}

// ---------------------------------------------------------------------------
// Schemas - describe the per-resource API response shape consumed by request()
// ---------------------------------------------------------------------------

const idString = z.string().min(1);

const componentSchema = z.object({
  id: idString,
  page_id: idString,
  group_id: z.string().nullable().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  status: z.string(),
  position: z.number().int().nonnegative().optional(),
  showcase: z.boolean().optional(),
  start_date: z.string().nullable().optional(),
  group: z.boolean().optional(),
  only_show_if_degraded: z.boolean().optional(),
  automation_email: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

const componentsResponseSchema = z.array(componentSchema);

const incidentUpdateSchema = z.object({
  id: idString,
  incident_id: idString,
  status: z.string(),
  body: z.string(),
  display_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string().nullable().optional(),
  affected_components: z.unknown().optional(),
});

const incidentSchema = z.object({
  id: idString,
  name: z.string(),
  status: z.string(),
  impact: z.string(),
  page_id: z.string().optional(),
  shortlink: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string().nullable().optional(),
  monitoring_at: z.string().nullable().optional(),
  resolved_at: z.string().nullable().optional(),
  scheduled_for: z.string().nullable().optional(),
  scheduled_until: z.string().nullable().optional(),
  components: z
    .array(
      z.object({
        id: idString,
        name: z.string().optional(),
        status: z.string().optional(),
      }),
    )
    .optional(),
  incident_updates: z.array(incidentUpdateSchema).optional(),
});

const incidentsResponseSchema = z.array(incidentSchema);

// ---------------------------------------------------------------------------
// Resource definitions
// ---------------------------------------------------------------------------

export const statuspageResources = defineResources({
  statuspage_component: {
    shape: 'entity',
    description:
      'Statuspage components (the things on a status page that turn red), with current status, group membership, and whether they are hidden until degraded.',
    endpoint: 'GET /v1/pages/{page_id}/components',
    fields: [
      { name: 'name', description: 'Component display name.' },
      {
        name: 'status',
        description:
          'Current health: operational | under_maintenance | degraded_performance | partial_outage | major_outage.',
      },
      {
        name: 'groupId',
        description:
          'Parent component-group id, or null if the component is top-level.',
      },
      {
        name: 'group',
        description: 'True if this row is itself a component group.',
      },
      {
        name: 'showcase',
        description: 'Whether the component is shown on the public page.',
      },
      {
        name: 'onlyShowIfDegraded',
        description:
          'When true the component is hidden on the public page while operational.',
      },
      {
        name: 'position',
        description: 'Sort position within the page or group.',
      },
    ],
    responses: { components: componentsResponseSchema },
  },
  statuspage_incident: {
    shape: 'entity',
    description:
      'Statuspage incidents (realtime outages plus maintenance windows) with status, impact, affected components, and the created / monitoring / resolved timestamps.',
    endpoint: 'GET /v1/pages/{page_id}/incidents',
    notes:
      'Returned newest-first by updated_at; bounded by the incident lookback window (default 90 days) and tightened to options.since on incremental syncs.',
    fields: [
      { name: 'name', description: 'Incident title.' },
      {
        name: 'status',
        description:
          'Realtime status (investigating | identified | monitoring | resolved | postmortem) or maintenance status (scheduled | in_progress | verifying | completed).',
      },
      {
        name: 'impact',
        description:
          'Reported impact: none | maintenance | minor | major | critical.',
      },
      {
        name: 'componentIds',
        description: 'Ids of components currently attached to the incident.',
      },
      {
        name: 'createdAt',
        description: 'Incident creation timestamp (epoch ms).',
      },
      {
        name: 'resolvedAt',
        description:
          'Resolved timestamp (epoch ms), or null while the incident is open.',
      },
      {
        name: 'shortlink',
        description: 'Public-facing short URL for the incident.',
      },
    ],
    responses: { incidents: incidentsResponseSchema },
  },
  statuspage_incident_update: {
    shape: 'event',
    description:
      'Per-update transitions inside an incident timeline (each comment / status flip). Emitted at display_at (falling back to created_at).',
    endpoint: 'GET /v1/pages/{page_id}/incidents',
    notes:
      'Derived from the inline incident_updates array on each incident; Statuspage does not expose a separate list endpoint.',
    fields: [
      { name: 'updateId', description: 'Incident-update id.' },
      {
        name: 'incidentId',
        description: 'Parent incident id.',
      },
      {
        name: 'status',
        description: 'Status the incident moved to at this update.',
      },
      {
        name: 'body',
        description: 'Free-form message posted on the update.',
      },
    ],
  },
});

// ---------------------------------------------------------------------------
// StatuspageConnector
// ---------------------------------------------------------------------------

const SP_API_HOST = 'api.statuspage.io';
const SP_API_BASE = `https://${SP_API_HOST}`;
const PAGE_SIZE = 100;
const DEFAULT_INCIDENT_LOOKBACK_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const id = 'statuspage';

interface IncidentBatchItem {
  incident: SPIncident;
}

export class StatuspageConnector extends BaseConnector<
  StatuspageSettings,
  StatuspageCredentials
> {
  static readonly id = id;

  static readonly resources = statuspageResources;

  static readonly schemas = schemasFromResources(statuspageResources);

  static create(input: unknown, ctx?: ConnectorContext): StatuspageConnector {
    const parsed = configFields.parse(input);
    return new StatuspageConnector(
      {
        pageId: parsed.pageId,
        resources: parsed.resources,
        incidentLookbackDays: parsed.incidentLookbackDays,
      },
      { apiKey: parsed.apiKey },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = statuspageCredentials;

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `OAuth ${this.creds.apiKey}`,
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('statuspage'),
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

  // -------------------------------------------------------------------------
  // Resource enablement
  // -------------------------------------------------------------------------

  private activePhases(): StatuspagePhase[] {
    return selectActivePhases<StatuspageResource, StatuspagePhase>(
      (r) => {
        switch (r) {
          case 'components':
            return 'components';
          case 'incidents':
          case 'incident_updates':
            return 'incidents';
        }
      },
      PHASE_ORDER,
      this.settings.resources,
    );
  }

  // -------------------------------------------------------------------------
  // URL building + sanitization
  // -------------------------------------------------------------------------

  private allowedPagePath(phase: StatuspagePhase): string {
    switch (phase) {
      case 'components':
        return `/v1/pages/${this.settings.pageId}/components`;
      case 'incidents':
        return `/v1/pages/${this.settings.pageId}/incidents`;
    }
  }

  private sanitizePageUrl(
    phase: StatuspagePhase,
    pageUrl: string | null,
  ): string | null {
    if (pageUrl === null) {
      return null;
    }
    return sanitizeAllowedUrl({
      url: pageUrl,
      host: SP_API_HOST,
      pathname: this.allowedPagePath(phase),
    });
  }

  private resolveCursor(cursor: unknown): StatuspageSyncCursor | undefined {
    if (!isStatuspageSyncCursor(cursor)) {
      return undefined;
    }
    return {
      phase: cursor.phase,
      page: this.sanitizePageUrl(cursor.phase, cursor.page),
    };
  }

  private buildInitialUrl(phase: StatuspagePhase): string {
    const u = new URL(`${SP_API_BASE}${this.allowedPagePath(phase)}`);
    u.searchParams.set('page', '1');
    u.searchParams.set('per_page', String(PAGE_SIZE));
    return u.toString();
  }

  private buildNextPageUrl(
    phase: StatuspagePhase,
    currentUrl: string,
  ): string | null {
    let u: URL;
    try {
      u = new URL(currentUrl);
    } catch {
      return null;
    }
    const pageRaw = u.searchParams.get('page');
    const pageNum = pageRaw === null ? 1 : Number.parseInt(pageRaw, 10);
    if (!Number.isFinite(pageNum) || pageNum < 1) {
      return null;
    }
    u.searchParams.set('page', String(pageNum + 1));
    u.searchParams.set('per_page', String(PAGE_SIZE));
    return this.sanitizePageUrl(phase, u.toString());
  }

  private computeIncidentSinceMs(options: SyncOptions): number {
    if (options.since) {
      const ms = parseEpoch(options.since, 'iso');
      if (ms !== null) {
        return ms;
      }
    }
    const days =
      this.settings.incidentLookbackDays ?? DEFAULT_INCIDENT_LOOKBACK_DAYS;
    return Date.now() - days * MS_PER_DAY;
  }

  // -------------------------------------------------------------------------
  // Fetchers
  // -------------------------------------------------------------------------

  private async fetchComponentsPage(
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<{ items: SPComponent[]; next: string | null }> {
    const url = page ?? this.buildInitialUrl('components');
    const res = await this.fetch<SPComponent[]>(url, 'components', signal);
    const items = res.body;
    const next =
      items.length < PAGE_SIZE
        ? null
        : this.buildNextPageUrl('components', url);
    return { items, next };
  }

  private async fetchIncidentsPage(
    page: string | null,
    sinceMs: number,
    signal: AbortSignal | undefined,
  ): Promise<{ items: IncidentBatchItem[]; next: string | null }> {
    const url = page ?? this.buildInitialUrl('incidents');
    const res = await this.fetch<SPIncident[]>(url, 'incidents', signal);
    const incidents = res.body;

    // Incidents are returned newest-first by updated_at. Short-circuit
    // pagination once a page is entirely older than the sinceMs floor.
    const incidentTimestampMs = (inc: SPIncident): number | null => {
      const stamp = inc.updated_at ?? inc.created_at;
      const ms = stamp ? Date.parse(stamp) : Number.NaN;
      return Number.isFinite(ms) ? ms : null;
    };

    const last = incidents.at(-1);
    const lastMs = last ? incidentTimestampMs(last) : null;
    const cutoffReached = lastMs !== null && lastMs < sinceMs;

    const filtered = incidents.filter((inc) => {
      const ms = incidentTimestampMs(inc);
      return ms === null ? true : ms >= sinceMs;
    });

    const next =
      cutoffReached || incidents.length < PAGE_SIZE
        ? null
        : this.buildNextPageUrl('incidents', url);

    return {
      items: filtered.map((incident) => ({ incident })),
      next,
    };
  }

  // -------------------------------------------------------------------------
  // Writers
  // -------------------------------------------------------------------------

  private parseTimestampMs(stamp: string | null | undefined): number | null {
    if (!stamp) {
      return null;
    }
    const ms = Date.parse(stamp);
    return Number.isFinite(ms) ? ms : null;
  }

  private async writeComponents(
    storage: StorageHandle,
    components: SPComponent[],
  ): Promise<void> {
    for (const c of components) {
      const updatedAt =
        this.parseTimestampMs(c.updated_at) ??
        this.parseTimestampMs(c.created_at) ??
        Date.now();
      await storage.entity({
        type: 'statuspage_component',
        id: c.id,
        attributes: {
          name: c.name,
          description: c.description ?? null,
          status: c.status,
          groupId: c.group_id ?? null,
          group: c.group ?? false,
          showcase: c.showcase ?? false,
          onlyShowIfDegraded: c.only_show_if_degraded ?? false,
          position: c.position ?? null,
          startDate: c.start_date ?? null,
          createdAt: this.parseTimestampMs(c.created_at),
        },
        updated_at: updatedAt,
      });
    }
  }

  private async writeIncidents(
    storage: StorageHandle,
    items: IncidentBatchItem[],
  ): Promise<void> {
    for (const { incident } of items) {
      const createdAtMs = this.parseTimestampMs(incident.created_at);
      const updatedAtMs = this.parseTimestampMs(incident.updated_at);
      const resolvedAtMs = this.parseTimestampMs(incident.resolved_at);
      const monitoringAtMs = this.parseTimestampMs(incident.monitoring_at);
      const componentIds = (incident.components ?? []).map((c) => c.id);
      const componentSummary: Record<string, JSONValue> = {};
      for (const c of incident.components ?? []) {
        componentSummary[c.id] = {
          name: c.name ?? null,
          status: c.status ?? null,
        };
      }
      await storage.entity({
        type: 'statuspage_incident',
        id: incident.id,
        attributes: {
          name: incident.name,
          status: incident.status,
          impact: incident.impact,
          componentIds,
          components: componentSummary,
          createdAt: createdAtMs,
          monitoringAt: monitoringAtMs,
          resolvedAt: resolvedAtMs,
          scheduledFor: this.parseTimestampMs(incident.scheduled_for),
          scheduledUntil: this.parseTimestampMs(incident.scheduled_until),
          shortlink: incident.shortlink ?? null,
        },
        updated_at: updatedAtMs ?? createdAtMs ?? Date.now(),
      });
    }
  }

  private async writeIncidentUpdates(
    storage: StorageHandle,
    items: IncidentBatchItem[],
    sinceMs: number,
  ): Promise<void> {
    for (const { incident } of items) {
      for (const upd of incident.incident_updates ?? []) {
        const tsMs =
          this.parseTimestampMs(upd.display_at) ??
          this.parseTimestampMs(upd.created_at);
        if (tsMs === null || tsMs < sinceMs) {
          continue;
        }
        await storage.event({
          name: 'statuspage_incident_update',
          start_ts: tsMs,
          end_ts: null,
          attributes: {
            updateId: upd.id,
            incidentId: upd.incident_id,
            incidentName: incident.name,
            status: upd.status,
            body: upd.body,
          },
        });
      }
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
    const incidentSinceMs = this.computeIncidentSinceMs(options);

    return paginateChunked<StatuspagePhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'components':
            return this.fetchComponentsPage(page, sig);
          case 'incidents':
            return this.fetchIncidentsPage(page, incidentSinceMs, sig);
        }
      },
      writeBatch: async (phase, items, page) => {
        if (isFull && page === null) {
          switch (phase) {
            case 'components':
              if (this.isResourceEnabled('components')) {
                await storage.entities([], {
                  types: ['statuspage_component'],
                });
              }
              break;
            case 'incidents':
              if (this.isResourceEnabled('incidents')) {
                await storage.entities([], {
                  types: ['statuspage_incident'],
                });
              }
              if (this.isResourceEnabled('incident_updates')) {
                await storage.events([], {
                  names: ['statuspage_incident_update'],
                });
              }
              break;
          }
        }
        switch (phase) {
          case 'components':
            if (!this.isResourceEnabled('components')) {
              return;
            }
            return this.writeComponents(storage, items as SPComponent[]);
          case 'incidents': {
            const batch = items as IncidentBatchItem[];
            if (this.isResourceEnabled('incidents')) {
              await this.writeIncidents(storage, batch);
            }
            if (this.isResourceEnabled('incident_updates')) {
              await this.writeIncidentUpdates(storage, batch, incidentSinceMs);
            }
            return;
          }
        }
      },
    });
  }
}
