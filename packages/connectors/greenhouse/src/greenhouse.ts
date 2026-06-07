import {
  type HttpResponse,
  connectorUserAgent,
  parseLinkHeader,
  sanitizeAllowedUrl,
  standardRateLimitPolicy,
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
      label: 'Harvest API key',
      description:
        'Greenhouse Harvest API key with read-only access. Create one at Configure -> Dev Center -> API Credential Management.',
      placeholder: 'ghr_...',
      secret: true,
    }),
    resources: z
      .array(
        z.enum([
          'jobs',
          'candidates',
          'applications',
          'application_events',
          'offers',
        ]),
      )
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Greenhouse resources to sync. Omit to sync all resources. The Harvest key only needs Get / List permissions for the resources listed here.',
      }),
  }),
);

// ---------------------------------------------------------------------------
// Connector doc (catalog metadata)
// ---------------------------------------------------------------------------

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Greenhouse',
  category: 'hr',
  brandColor: '#24A47F',
  tagline:
    'Sync jobs, candidates, applications, and offers from the Greenhouse Harvest API for hiring-funnel, time-to-hire, and offer-rate analytics.',
  vendor: {
    name: 'Greenhouse',
    apiDocs: 'https://developers.greenhouse.io/harvest.html',
    website: 'https://www.greenhouse.com',
  },
  auth: {
    summary:
      'A Harvest API key with read-only access to candidates, applications, jobs, and offers. Greenhouse authenticates via HTTP Basic with the key as the username and an empty password.',
    setup: [
      'Open Greenhouse -> Configure -> Dev Center -> API Credential Management.',
      'Create a new Harvest API key with Get / List permissions for the resources you intend to sync (Candidates, Applications, Jobs, Offers).',
      'Copy the key once on creation - Greenhouse never shows it again.',
      'Store the key as a secret and reference it from config as `apiKey: secret("GREENHOUSE_API_KEY")`.',
    ],
  },
  rateLimit:
    'Greenhouse Harvest enforces 50 requests per 10 seconds per key and surfaces remaining quota via the X-RateLimit-* headers; the shared HTTP client backs off on 429, preferring the Retry-After header.',
  limitations: [
    "Application stage-transition history is derived from each application's built-in timestamps (applied_at, hired_at, rejected_at, last_activity_at) rather than the per-application /activity_feed endpoint, which avoids an N+1 sync.",
    'Greenhouse Onboard data and Recruiting custom fields are out of scope.',
  ],
});

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

export const cost: ConnectorCost = {
  recommendedInterval: '1 hour',
  minInterval: '15 minutes',
  warning:
    'Greenhouse Harvest is rate-limited to 50 requests / 10 seconds per key; on large hiring funnels the full backfill spans many pages, so syncing more often than the recommended interval can starve other integrations on the same key.',
};

// ---------------------------------------------------------------------------
// Settings / credentials
// ---------------------------------------------------------------------------

export interface GreenhouseSettings {
  resources?: readonly GreenhouseResource[];
}

const greenhouseCredentials = {
  apiKey: {
    description: 'Greenhouse Harvest API key',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type GreenhouseCredentials = typeof greenhouseCredentials;

// ---------------------------------------------------------------------------
// Sync phases + cursor
// ---------------------------------------------------------------------------

const PHASE_ORDER = [
  'jobs',
  'candidates',
  'applications',
  'application_events',
  'offers',
] as const;

type GreenhousePhase = (typeof PHASE_ORDER)[number];

export type GreenhouseResource = GreenhousePhase;

const isGreenhouseSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

type GreenhouseSyncCursor = ChunkedSyncCursor<GreenhousePhase, string>;

const PER_PAGE = 100;
const API_HOST = 'harvest.greenhouse.io';
const API_BASE = `https://${API_HOST}`;

const JOB_ENTITY = 'greenhouse_job';
const CANDIDATE_ENTITY = 'greenhouse_candidate';
const APPLICATION_ENTITY = 'greenhouse_application';
const OFFER_ENTITY = 'greenhouse_offer';
const APPLICATION_EVENT = 'greenhouse_application_event';

// Greenhouse exposes remaining quota in X-RateLimit-Remaining; reset is in
// X-RateLimit-Reset (Unix seconds).
const greenhouseRateLimit = standardRateLimitPolicy({
  remainingHeader: 'x-ratelimit-remaining',
  resetHeader: 'x-ratelimit-reset',
  resetUnit: 's',
});

// Each user-facing resource maps 1:1 to a sync phase; the type alias keeps the
// two surfaces aligned at compile time.
function resourceToPhase(resource: GreenhouseResource): GreenhousePhase {
  return resource;
}

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

interface JobRecord {
  id: number;
  name: string;
  status?: string | null;
  requisition_id?: string | null;
  notes?: string | null;
  confidential?: boolean | null;
  is_template?: boolean | null;
  copied_from_id?: number | null;
  departments?: Array<{ id?: number | null; name?: string | null }> | null;
  offices?: Array<{ id?: number | null; name?: string | null }> | null;
  opened_at?: string | null;
  closed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface CandidateRecord {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  title?: string | null;
  is_private?: boolean | null;
  application_ids?: number[] | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_activity?: string | null;
}

interface ApplicationStage {
  id?: number | null;
  name?: string | null;
}

interface ApplicationSourceRef {
  id?: number | null;
  public_name?: string | null;
}

interface ApplicationRecord {
  id: number;
  candidate_id: number;
  status?: string | null;
  current_stage?: ApplicationStage | null;
  applied_at?: string | null;
  rejected_at?: string | null;
  last_activity_at?: string | null;
  source?: ApplicationSourceRef | null;
  jobs?: Array<{ id?: number | null; name?: string | null }> | null;
  // Greenhouse omits hired_at; callers infer it from status + last_activity_at.
}

interface OfferRecord {
  id: number;
  application_id?: number | null;
  candidate_id?: number | null;
  job_id?: number | null;
  status?: string | null;
  created_at?: string | null;
  sent_at?: string | null;
  resolved_at?: string | null;
  starts_at?: string | null;
}

// ---------------------------------------------------------------------------
// Schemas — describe the per-resource API response shape consumed by request()
// ---------------------------------------------------------------------------

const jobSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  status: z.string().nullish(),
  requisition_id: z.string().nullish(),
  notes: z.string().nullish(),
  confidential: z.boolean().nullish(),
  is_template: z.boolean().nullish(),
  copied_from_id: z.number().nullish(),
  departments: z
    .array(z.object({ id: z.number().nullish(), name: z.string().nullish() }))
    .nullish(),
  offices: z
    .array(z.object({ id: z.number().nullish(), name: z.string().nullish() }))
    .nullish(),
  opened_at: z.string().nullish(),
  closed_at: z.string().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
});

const candidateSchema = z.object({
  id: z.number().int(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  company: z.string().nullish(),
  title: z.string().nullish(),
  is_private: z.boolean().nullish(),
  application_ids: z.array(z.number()).nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  last_activity: z.string().nullish(),
});

const applicationSchema = z.object({
  id: z.number().int(),
  candidate_id: z.number().int(),
  status: z.string().nullish(),
  current_stage: z
    .object({ id: z.number().nullish(), name: z.string().nullish() })
    .nullish(),
  applied_at: z.string().nullish(),
  rejected_at: z.string().nullish(),
  last_activity_at: z.string().nullish(),
  source: z
    .object({ id: z.number().nullish(), public_name: z.string().nullish() })
    .nullish(),
  jobs: z
    .array(z.object({ id: z.number().nullish(), name: z.string().nullish() }))
    .nullish(),
});

const offerSchema = z.object({
  id: z.number().int(),
  application_id: z.number().nullish(),
  candidate_id: z.number().nullish(),
  job_id: z.number().nullish(),
  status: z.string().nullish(),
  created_at: z.string().nullish(),
  sent_at: z.string().nullish(),
  resolved_at: z.string().nullish(),
  starts_at: z.string().nullish(),
});

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export const greenhouseResources = defineResources({
  [JOB_ENTITY]: {
    shape: 'entity',
    description:
      'Open, draft, and closed requisitions with department, office, and timestamps for opened / closed transitions.',
    endpoint: 'GET /v1/jobs',
    fields: [
      { name: 'name', description: 'Job title.' },
      {
        name: 'status',
        description: 'Greenhouse job status (open / closed / draft).',
      },
      { name: 'requisitionId', description: 'External requisition id.' },
      {
        name: 'departments',
        description: 'Flat list of department names attached to the job.',
      },
      {
        name: 'offices',
        description: 'Flat list of office names attached to the job.',
      },
      { name: 'openedAt', description: 'When the job was opened (Unix ms).' },
      { name: 'closedAt', description: 'When the job was closed (Unix ms).' },
      { name: 'confidential', description: 'Whether the job is confidential.' },
    ],
    responses: { jobs: z.array(jobSchema) },
  },
  [CANDIDATE_ENTITY]: {
    shape: 'entity',
    description:
      'Candidate records with name, title, company, and the count of attached applications.',
    endpoint: 'GET /v1/candidates',
    fields: [
      { name: 'firstName', description: 'Candidate first name.' },
      { name: 'lastName', description: 'Candidate last name.' },
      { name: 'title', description: 'Candidate current job title.' },
      { name: 'company', description: 'Candidate current company.' },
      {
        name: 'applicationCount',
        description:
          'Number of applications attached to the candidate. Useful for spotting repeat applicants.',
      },
      {
        name: 'isPrivate',
        description: 'Whether the candidate is marked private.',
      },
      {
        name: 'createdAt',
        description: 'When the candidate was created (Unix ms).',
      },
      {
        name: 'lastActivityAt',
        description: 'Last activity timestamp on the candidate (Unix ms).',
      },
    ],
    responses: { candidates: z.array(candidateSchema) },
  },
  [APPLICATION_ENTITY]: {
    shape: 'entity',
    description:
      'Applications with status (active / hired / rejected), current stage, source, and the linked candidate / job.',
    endpoint: 'GET /v1/applications',
    fields: [
      {
        name: 'candidateId',
        description: 'Candidate the application belongs to.',
      },
      {
        name: 'jobId',
        description: 'Primary job the application is attached to.',
      },
      { name: 'jobName', description: 'Primary job name at sync time.' },
      {
        name: 'status',
        description: 'Application status (active / hired / rejected).',
      },
      {
        name: 'currentStage',
        description: 'Name of the current stage (e.g. "Phone Screen").',
      },
      {
        name: 'source',
        description:
          'Public source name where the application originated (e.g. "LinkedIn").',
      },
      { name: 'appliedAt', description: 'When the application was submitted.' },
      {
        name: 'rejectedAt',
        description: 'When the application was rejected (null if not).',
      },
      {
        name: 'hiredAt',
        description:
          'When the application was hired (derived from last_activity_at when status=hired).',
      },
      {
        name: 'lastActivityAt',
        description: 'Last activity timestamp on the application (Unix ms).',
      },
    ],
    responses: { applications: z.array(applicationSchema) },
  },
  [APPLICATION_EVENT]: {
    shape: 'event',
    description:
      'Application lifecycle events (applied / hired / rejected) derived from each application timestamps. The scope is cleared and rewritten on every full sync.',
    endpoint: 'GET /v1/applications',
    notes:
      "Derived from each application's applied_at / rejected_at / last_activity_at fields, not from a separate API call.",
    fields: [
      {
        name: 'applicationId',
        description: 'Application the event belongs to.',
      },
      { name: 'candidateId', description: 'Candidate id, denormalised.' },
      { name: 'jobId', description: 'Job id, denormalised.' },
      {
        name: 'transition',
        description: '"applied", "hired", or "rejected".',
      },
      {
        name: 'source',
        description: 'Application source name at the time of the event.',
      },
    ],
    responses: { application_events: z.array(applicationSchema) },
  },
  [OFFER_ENTITY]: {
    shape: 'entity',
    description:
      'Offers with status (pending / accepted / rejected), linked to their application, candidate, and job.',
    endpoint: 'GET /v1/offers',
    fields: [
      { name: 'applicationId', description: 'Linked application.' },
      { name: 'candidateId', description: 'Linked candidate.' },
      { name: 'jobId', description: 'Linked job.' },
      {
        name: 'status',
        description: 'Offer status (pending / accepted / rejected).',
      },
      { name: 'sentAt', description: 'When the offer was sent (Unix ms).' },
      {
        name: 'resolvedAt',
        description:
          'When the offer was accepted or rejected (Unix ms; null while pending).',
      },
      {
        name: 'startsAt',
        description: 'Proposed start date on the offer (Unix ms).',
      },
    ],
    responses: { offers: z.array(offerSchema) },
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoToMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function isoToMsOrZero(value: string | null | undefined): number {
  return isoToMs(value) ?? 0;
}

function listNames(
  items: Array<{ name?: string | null }> | null | undefined,
): string[] {
  if (!items) {
    return [];
  }
  const names: string[] = [];
  for (const item of items) {
    if (item && typeof item.name === 'string' && item.name !== '') {
      names.push(item.name);
    }
  }
  return names;
}

function primaryJobId(app: ApplicationRecord): number | null {
  const first = app.jobs?.[0];
  if (!first || first.id === null || first.id === undefined) {
    return null;
  }
  return first.id;
}

function primaryJobName(app: ApplicationRecord): string | null {
  return app.jobs?.[0]?.name ?? null;
}

function hiredAtMs(app: ApplicationRecord): number | null {
  if (app.status !== 'hired') {
    return null;
  }
  // Greenhouse omits hired_at on /applications; last_activity_at is the
  // canonical proxy for the transition timestamp when status === 'hired'.
  return isoToMs(app.last_activity_at);
}

// ---------------------------------------------------------------------------
// GreenhouseConnector
// ---------------------------------------------------------------------------

export const id = 'greenhouse';

export class GreenhouseConnector extends BaseConnector<
  GreenhouseSettings,
  GreenhouseCredentials
> {
  static readonly id = id;

  static readonly resources = greenhouseResources;

  static readonly schemas = schemasFromResources(greenhouseResources);

  static readonly cost = cost;

  static create(input: unknown, ctx?: ConnectorContext): GreenhouseConnector {
    const parsed = configFields.parse(input);
    return new GreenhouseConnector(
      { resources: parsed.resources },
      { apiKey: parsed.apiKey },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = greenhouseCredentials;

  private buildHeaders(): Record<string, string> {
    // Greenhouse Harvest uses HTTP Basic with the API key as username and an
    // empty password.
    const basic = btoa(`${this.creds.apiKey}:`);
    return {
      Authorization: `Basic ${basic}`,
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('greenhouse'),
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
      rateLimit: greenhouseRateLimit,
    });
  }

  private allowedPagePath(phase: GreenhousePhase): string {
    switch (phase) {
      case 'jobs':
        return '/v1/jobs';
      case 'candidates':
        return '/v1/candidates';
      case 'applications':
      case 'application_events':
        return '/v1/applications';
      case 'offers':
        return '/v1/offers';
    }
  }

  private sanitizePageUrl(
    phase: GreenhousePhase,
    pageUrl: string | null,
  ): string | null {
    return sanitizeAllowedUrl({
      url: pageUrl,
      host: API_HOST,
      pathname: this.allowedPagePath(phase),
    });
  }

  private resolveCursor(cursor: unknown): GreenhouseSyncCursor | undefined {
    if (!isGreenhouseSyncCursor(cursor)) {
      return undefined;
    }
    return {
      phase: cursor.phase,
      page: this.sanitizePageUrl(cursor.phase, cursor.page),
    };
  }

  // Build the initial-page URL for a phase. Subsequent pages come from the
  // Link header, validated through sanitizeAllowedUrl above.
  private buildInitialUrl(
    phase: GreenhousePhase,
    options: SyncOptions,
  ): string {
    const url = new URL(`${API_BASE}${this.allowedPagePath(phase)}`);
    url.searchParams.set('per_page', String(PER_PAGE));
    // application_events derives its rows from /v1/applications without a
    // since filter so the scope-clear + rewrite stays whole on every sync.
    if (phase !== 'application_events' && options.since) {
      // jobs / candidates / applications / offers all support updated_after
      // as the canonical incremental filter on the Harvest API.
      url.searchParams.set('updated_after', options.since);
    }
    return url.toString();
  }

  // -------------------------------------------------------------------------
  // Page fetchers
  // -------------------------------------------------------------------------

  private async fetchPhasePage(
    phase: GreenhousePhase,
    page: string | null,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<FetchPageResult<string>> {
    const resource =
      phase === 'application_events' ? 'application_events' : phase;
    const url = page ?? this.buildInitialUrl(phase, options);
    const res = await this.apiGet<unknown[]>(url, resource, signal);
    const rawNext = parseLinkHeader(res.headers.get('link'))['next'] ?? null;
    // Sanitize the upstream-supplied next URL so a crafted Link header can't
    // exfiltrate the Basic-auth header to an attacker-controlled host on the
    // next page fetch.
    const next = this.sanitizePageUrl(phase, rawNext);
    return { items: res.body ?? [], next };
  }

  // -------------------------------------------------------------------------
  // Writers
  // -------------------------------------------------------------------------

  private async writeJobs(
    storage: StorageHandle,
    items: JobRecord[],
  ): Promise<void> {
    for (const job of items) {
      await storage.entity({
        type: JOB_ENTITY,
        id: String(job.id),
        attributes: {
          name: job.name,
          status: job.status ?? null,
          requisitionId: job.requisition_id ?? null,
          confidential: job.confidential ?? null,
          departments: listNames(job.departments),
          offices: listNames(job.offices),
          openedAt: isoToMs(job.opened_at),
          closedAt: isoToMs(job.closed_at),
          createdAt: isoToMs(job.created_at),
        },
        updated_at: isoToMsOrZero(job.updated_at ?? job.created_at),
      });
    }
  }

  private async writeCandidates(
    storage: StorageHandle,
    items: CandidateRecord[],
  ): Promise<void> {
    for (const cand of items) {
      await storage.entity({
        type: CANDIDATE_ENTITY,
        id: String(cand.id),
        attributes: {
          firstName: cand.first_name ?? null,
          lastName: cand.last_name ?? null,
          title: cand.title ?? null,
          company: cand.company ?? null,
          applicationCount: cand.application_ids?.length ?? 0,
          isPrivate: cand.is_private ?? null,
          createdAt: isoToMs(cand.created_at),
          lastActivityAt: isoToMs(cand.last_activity),
        },
        updated_at: isoToMsOrZero(
          cand.updated_at ?? cand.last_activity ?? cand.created_at,
        ),
      });
    }
  }

  private async writeApplications(
    storage: StorageHandle,
    items: ApplicationRecord[],
  ): Promise<void> {
    for (const app of items) {
      const attributes: Record<string, JSONValue> = {
        candidateId: String(app.candidate_id),
        jobId: primaryJobId(app) === null ? null : String(primaryJobId(app)),
        jobName: primaryJobName(app),
        status: app.status ?? null,
        currentStage: app.current_stage?.name ?? null,
        source: app.source?.public_name ?? null,
        appliedAt: isoToMs(app.applied_at),
        rejectedAt: isoToMs(app.rejected_at),
        hiredAt: hiredAtMs(app),
        lastActivityAt: isoToMs(app.last_activity_at),
      };
      await storage.entity({
        type: APPLICATION_ENTITY,
        id: String(app.id),
        attributes,
        updated_at: isoToMsOrZero(
          app.last_activity_at ?? app.applied_at ?? app.rejected_at,
        ),
      });
    }
  }

  private async writeApplicationEvents(
    storage: StorageHandle,
    items: ApplicationRecord[],
  ): Promise<void> {
    for (const app of items) {
      const base: Record<string, JSONValue> = {
        applicationId: String(app.id),
        candidateId: String(app.candidate_id),
        jobId: primaryJobId(app) === null ? null : String(primaryJobId(app)),
        source: app.source?.public_name ?? null,
      };

      const appliedMs = isoToMs(app.applied_at);
      if (appliedMs !== null) {
        await storage.event({
          name: APPLICATION_EVENT,
          start_ts: appliedMs,
          end_ts: null,
          attributes: { ...base, transition: 'applied' },
        });
      }

      const rejectedMs = isoToMs(app.rejected_at);
      if (rejectedMs !== null) {
        await storage.event({
          name: APPLICATION_EVENT,
          start_ts: rejectedMs,
          end_ts: null,
          attributes: { ...base, transition: 'rejected' },
        });
      }

      const hiredMs = hiredAtMs(app);
      if (hiredMs !== null) {
        await storage.event({
          name: APPLICATION_EVENT,
          start_ts: hiredMs,
          end_ts: null,
          attributes: { ...base, transition: 'hired' },
        });
      }
    }
  }

  private async writeOffers(
    storage: StorageHandle,
    items: OfferRecord[],
  ): Promise<void> {
    for (const offer of items) {
      await storage.entity({
        type: OFFER_ENTITY,
        id: String(offer.id),
        attributes: {
          applicationId:
            offer.application_id === null || offer.application_id === undefined
              ? null
              : String(offer.application_id),
          candidateId:
            offer.candidate_id === null || offer.candidate_id === undefined
              ? null
              : String(offer.candidate_id),
          jobId:
            offer.job_id === null || offer.job_id === undefined
              ? null
              : String(offer.job_id),
          status: offer.status ?? null,
          sentAt: isoToMs(offer.sent_at),
          resolvedAt: isoToMs(offer.resolved_at),
          startsAt: isoToMs(offer.starts_at),
        },
        updated_at: isoToMsOrZero(
          offer.resolved_at ?? offer.sent_at ?? offer.created_at,
        ),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Scope clearing
  // -------------------------------------------------------------------------

  private async clearScopeOnFirstPage(
    storage: StorageHandle,
    phase: GreenhousePhase,
    isFull: boolean,
  ): Promise<void> {
    if (phase === 'application_events') {
      // Events can't be upserted by key, so we wipe and rewrite on every sync.
      await storage.events([], { names: [APPLICATION_EVENT] });
      return;
    }
    if (!isFull) {
      // Entity phases upsert by id, so incremental ticks just overwrite the
      // records they touch.
      return;
    }
    const entityType = ENTITY_TYPE_BY_PHASE[phase];
    if (entityType) {
      await storage.entities([], { types: [entityType] });
    }
  }

  private async writePhase(
    storage: StorageHandle,
    phase: GreenhousePhase,
    items: unknown[],
  ): Promise<void> {
    switch (phase) {
      case 'jobs':
        return this.writeJobs(storage, items as JobRecord[]);
      case 'candidates':
        return this.writeCandidates(storage, items as CandidateRecord[]);
      case 'applications':
        return this.writeApplications(storage, items as ApplicationRecord[]);
      case 'application_events':
        return this.writeApplicationEvents(
          storage,
          items as ApplicationRecord[],
        );
      case 'offers':
        return this.writeOffers(storage, items as OfferRecord[]);
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = this.resolveCursor(options.cursor);
    const isFull = options.mode === 'full';

    const phases = selectActivePhases<GreenhouseResource, GreenhousePhase>(
      resourceToPhase,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<GreenhousePhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) =>
        this.fetchPhasePage(phase, page, options, sig),
      writeBatch: async (phase, items, page) => {
        if (page === null) {
          await this.clearScopeOnFirstPage(storage, phase, isFull);
        }
        await this.writePhase(storage, phase, items);
      },
    });
  }
}

const ENTITY_TYPE_BY_PHASE: Partial<Record<GreenhousePhase, string>> = {
  jobs: JOB_ENTITY,
  candidates: CANDIDATE_ENTITY,
  applications: APPLICATION_ENTITY,
  offers: OFFER_ENTITY,
};
