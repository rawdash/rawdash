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

// ---------------------------------------------------------------------------
// configFields
// ---------------------------------------------------------------------------

export const configFields = defineConfigFields(
  z.object({
    apiToken: z.object({ $secret: z.string() }).meta({
      label: 'API Token',
      description:
        'CircleCI personal API token (read-only is sufficient). Create one at CircleCI -> User Settings -> Personal API Tokens.',
      placeholder: 'circleci_token',
      secret: true,
    }),
    projectSlugs: z
      .array(z.string().min(1))
      .nonempty()
      .refine((slugs) => new Set(slugs).size === slugs.length, {
        error: 'Project slugs must be unique.',
      })
      .meta({
        label: 'Project slugs',
        description:
          "CircleCI project slugs to sync, e.g. 'gh/my-org/my-repo' or 'circleci/<orgId>/<projectId>'.",
      }),
    branch: z.string().min(1).optional().meta({
      label: 'Branch (optional)',
      description:
        'Restrict pipeline sync to a single branch. Omit to sync all branches.',
      placeholder: 'main',
    }),
    resources: z
      .array(z.enum(['pipelines', 'workflows', 'jobs', 'pipeline_events']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which CircleCI resources to sync. Omit to sync pipelines, workflows, and pipeline_events (jobs are off by default because they add a per-workflow API call). Workflows must be fetched whenever workflows, jobs, or pipeline_events are enabled.',
      }),
    pipelinesLookbackDays: z
      .number()
      .int()
      .positive()
      .max(365)
      .optional()
      .meta({
        label: 'Pipelines lookback (days)',
        description:
          'How many days back to fetch pipelines on a full sync. Defaults to 30. CircleCI does not expose a server-side since filter, so the connector paginates newest-first and stops once it crosses this window.',
        placeholder: '30',
      }),
  }),
);

export type CircleCIResource =
  | 'pipelines'
  | 'workflows'
  | 'jobs'
  | 'pipeline_events';

export interface CircleCISettings {
  projectSlugs: readonly string[];
  branch?: string;
  resources?: readonly CircleCIResource[];
  pipelinesLookbackDays?: number;
}

const circleciCredentials = {
  apiToken: {
    description: 'CircleCI personal API token',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type CircleCICredentials = typeof circleciCredentials;

// ---------------------------------------------------------------------------
// Connector documentation metadata
// ---------------------------------------------------------------------------

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'CircleCI',
  category: 'engineering',
  brandColor: '#161616',
  tagline:
    'Sync CircleCI pipelines, workflows, jobs, and workflow state-transition events so build success rate and duration land on dashboards.',
  vendor: {
    name: 'CircleCI',
    apiDocs: 'https://circleci.com/docs/api/v2/',
    website: 'https://circleci.com',
  },
  auth: {
    summary:
      'A CircleCI personal API token is required. Tokens authenticate against the v2 REST API and inherit the creating user permissions on the configured projects.',
    setup: [
      'Open CircleCI -> User Settings -> Personal API Tokens (https://app.circleci.com/settings/user/tokens).',
      'Create a token with a descriptive name (e.g. "rawdash sync") and copy the value.',
      'Store it as a secret and reference it from the connector config as `apiToken: secret("CIRCLECI_API_TOKEN")`.',
      "Set `projectSlugs` to the projects you want to sync, e.g. ['gh/my-org/my-repo'].",
    ],
  },
  rateLimit:
    'CircleCI enforces a per-token rate limit of roughly 3,500 requests per hour. The connector paginates pipelines newest-first and fans out one extra request per pipeline for workflows (and one more per workflow for jobs when enabled), so cap `projectSlugs` and `pipelinesLookbackDays` accordingly.',
  limitations: [
    'CircleCI v2 has no server-side since filter for pipelines, so the connector paginates newest-first and stops once it crosses `pipelinesLookbackDays` (default 30).',
    'The `jobs` resource is off by default because it adds an extra API call per workflow. Enable it explicitly in `resources` if you need per-job entities.',
    'Insights API (pre-aggregated workflow stats) and the self-hosted CircleCI Server are out of scope for v1.',
  ],
});

// ---------------------------------------------------------------------------
// Sync phases + cursor
// ---------------------------------------------------------------------------

const PHASE_ORDER = ['pipelines'] as const;

type CircleCIPhase = (typeof PHASE_ORDER)[number];

type CircleCISyncCursor = ChunkedSyncCursor<CircleCIPhase, string>;

const isCircleCISyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

// page-cursor encoding: a JSON object {slug, token} stringified to fit the
// string-typed `page` slot. `slug` is one of the configured projectSlugs;
// `token` is the CircleCI next_page_token (or null when starting that slug).
const pageCursorSchema = z.object({
  slug: z.string().min(1),
  token: z.string().nullable(),
});

interface CirclePageCursor {
  slug: string;
  token: string | null;
}

// ---------------------------------------------------------------------------
// CircleCI API types
// ---------------------------------------------------------------------------

interface CircleCIPipeline {
  id: string;
  number: number;
  project_slug: string;
  state: string;
  created_at: string;
  updated_at: string;
  trigger?: {
    type?: string | null;
    actor?: { login?: string | null } | null;
  } | null;
  vcs?: {
    revision?: string | null;
    branch?: string | null;
    tag?: string | null;
    target_repository_url?: string | null;
    origin_repository_url?: string | null;
  } | null;
}

interface CircleCIPipelinesResponse {
  items: CircleCIPipeline[];
  next_page_token: string | null;
}

interface CircleCIWorkflow {
  id: string;
  name: string;
  pipeline_id: string;
  pipeline_number?: number;
  project_slug: string;
  status:
    | 'success'
    | 'running'
    | 'not_run'
    | 'failed'
    | 'error'
    | 'failing'
    | 'on_hold'
    | 'canceled'
    | 'unauthorized'
    | string;
  created_at: string;
  stopped_at?: string | null;
  started_by?: string | null;
  tag?: string | null;
}

interface CircleCIWorkflowsResponse {
  items: CircleCIWorkflow[];
  next_page_token: string | null;
}

interface CircleCIJob {
  id: string;
  name: string;
  status: string;
  type?: string;
  job_number?: number | null;
  started_at?: string | null;
  stopped_at?: string | null;
  project_slug?: string;
  dependencies?: string[];
}

interface CircleCIJobsResponse {
  items: CircleCIJob[];
  next_page_token: string | null;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const idString = z.string().min(1);
const isoString = z.string().min(1);

const pipelineSchema = z.object({
  id: idString,
  number: z.number().int().nonnegative(),
  project_slug: idString,
  state: z.string().min(1),
  created_at: isoString,
  updated_at: isoString,
  trigger: z
    .object({
      type: z.string().nullable().optional(),
      actor: z
        .object({ login: z.string().nullable().optional() })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  vcs: z
    .object({
      revision: z.string().nullable().optional(),
      branch: z.string().nullable().optional(),
      tag: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

const pipelinesResponseSchema = z.object({
  items: z.array(pipelineSchema),
  next_page_token: z.string().nullable(),
});

const workflowSchema = z.object({
  id: idString,
  name: z.string().min(1),
  pipeline_id: idString,
  project_slug: idString,
  status: z.string().min(1),
  created_at: isoString,
  stopped_at: z.string().nullable().optional(),
  started_by: z.string().nullable().optional(),
});

const workflowsResponseSchema = z.object({
  items: z.array(workflowSchema),
  next_page_token: z.string().nullable(),
});

const jobSchema = z.object({
  id: idString,
  name: z.string().min(1),
  status: z.string().min(1),
  type: z.string().optional(),
  job_number: z.number().int().nullable().optional(),
  started_at: z.string().nullable().optional(),
  stopped_at: z.string().nullable().optional(),
  project_slug: z.string().optional(),
});

const jobsResponseSchema = z.object({
  items: z.array(jobSchema),
  next_page_token: z.string().nullable(),
});

export const circleciResources = defineResources({
  circleci_pipeline: {
    shape: 'entity',
    description:
      'CircleCI pipelines with state, trigger, git ref, project slug, and create/update timestamps.',
    endpoint: 'GET /api/v2/project/{project_slug}/pipeline',
    notes:
      'Pipelines are paginated newest-first; the connector stops once it crosses `pipelinesLookbackDays`.',
    responses: { pipelines: pipelinesResponseSchema },
  },
  circleci_workflow: {
    shape: 'entity',
    description:
      'Workflows belonging to each pipeline, including status, name, and start/stop timestamps. Fetched per pipeline with one extra API call.',
    endpoint: 'GET /api/v2/pipeline/{pipeline_id}/workflow',
    responses: { workflows: workflowsResponseSchema },
  },
  circleci_job: {
    shape: 'entity',
    description:
      'Jobs belonging to each workflow, including status, type, and start/stop timestamps. Off by default; enable via `resources` because it adds an API call per workflow.',
    endpoint: 'GET /api/v2/workflow/{workflow_id}/job',
    responses: { jobs: jobsResponseSchema },
  },
  circleci_pipeline_event: {
    shape: 'event',
    description:
      'Each workflow emitted as a time-bounded event spanning its created_at to stopped_at, carrying the same status, project, and pipeline attributes.',
    endpoint: 'GET /api/v2/pipeline/{pipeline_id}/workflow',
  },
});

// ---------------------------------------------------------------------------
// CircleCIConnector
// ---------------------------------------------------------------------------

const CIRCLECI_API_BASE = 'https://circleci.com/api/v2';
const DEFAULT_RESOURCES: readonly CircleCIResource[] = [
  'pipelines',
  'workflows',
  'pipeline_events',
];
const DEFAULT_LOOKBACK_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const id = 'circleci';

export class CircleCIConnector extends BaseConnector<
  CircleCISettings,
  CircleCICredentials
> {
  static readonly id = id;

  static readonly resources = circleciResources;

  static readonly schemas = schemasFromResources(circleciResources);

  static create(input: unknown, ctx?: ConnectorContext): CircleCIConnector {
    const parsed = configFields.parse(input);
    return new CircleCIConnector(
      {
        projectSlugs: parsed.projectSlugs,
        branch: parsed.branch,
        resources: parsed.resources ?? DEFAULT_RESOURCES,
        pipelinesLookbackDays: parsed.pipelinesLookbackDays,
      },
      { apiToken: parsed.apiToken },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = circleciCredentials;

  private buildHeaders(): Record<string, string> {
    return {
      'Circle-Token': this.creds.apiToken,
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('circleci'),
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

  private activePhases(): CircleCIPhase[] {
    return selectActivePhases<CircleCIResource, CircleCIPhase>(
      () => 'pipelines',
      PHASE_ORDER,
      this.settings.resources,
    );
  }

  private workflowsNeeded(): boolean {
    return (
      this.isResourceEnabled('workflows') ||
      this.isResourceEnabled('pipeline_events') ||
      this.isResourceEnabled('jobs')
    );
  }

  // -------------------------------------------------------------------------
  // Cursor + URL building
  // -------------------------------------------------------------------------

  private slugSet(): Set<string> {
    return new Set(this.settings.projectSlugs);
  }

  private decodePageCursor(page: string | null): CirclePageCursor | null {
    if (page === null) {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(page);
    } catch {
      return null;
    }
    const res = pageCursorSchema.safeParse(parsed);
    if (!res.success) {
      return null;
    }
    if (!this.slugSet().has(res.data.slug)) {
      return null;
    }
    return res.data;
  }

  private encodePageCursor(cursor: CirclePageCursor): string {
    return JSON.stringify(cursor);
  }

  private resolveCursor(cursor: unknown): CircleCISyncCursor | undefined {
    if (!isCircleCISyncCursor(cursor)) {
      return undefined;
    }
    if (cursor.page === null) {
      return { phase: cursor.phase, page: null };
    }
    const decoded = this.decodePageCursor(cursor.page);
    if (!decoded) {
      return { phase: cursor.phase, page: null };
    }
    return { phase: cursor.phase, page: this.encodePageCursor(decoded) };
  }

  private buildPipelinesUrl(slug: string, token: string | null): string {
    const u = new URL(
      `${CIRCLECI_API_BASE}/project/${encodeURI(slug)}/pipeline`,
    );
    if (this.settings.branch !== undefined) {
      u.searchParams.set('branch', this.settings.branch);
    }
    if (token !== null) {
      u.searchParams.set('page-token', token);
    }
    return u.toString();
  }

  private buildWorkflowsUrl(pipelineId: string, token: string | null): string {
    const u = new URL(
      `${CIRCLECI_API_BASE}/pipeline/${encodeURIComponent(pipelineId)}/workflow`,
    );
    if (token !== null) {
      u.searchParams.set('page-token', token);
    }
    return u.toString();
  }

  private buildJobsUrl(workflowId: string, token: string | null): string {
    const u = new URL(
      `${CIRCLECI_API_BASE}/workflow/${encodeURIComponent(workflowId)}/job`,
    );
    if (token !== null) {
      u.searchParams.set('page-token', token);
    }
    return u.toString();
  }

  private nextSlug(currentSlug: string): string | null {
    const slugs = this.settings.projectSlugs;
    const idx = slugs.indexOf(currentSlug);
    if (idx < 0 || idx >= slugs.length - 1) {
      return null;
    }
    return slugs[idx + 1] ?? null;
  }

  private cutoffMs(options: SyncOptions): number | null {
    if (options.since) {
      const ms = parseEpoch(options.since, 'iso');
      if (ms !== null) {
        return ms;
      }
    }
    const days = this.settings.pipelinesLookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    return Date.now() - days * MS_PER_DAY;
  }

  // -------------------------------------------------------------------------
  // Fetchers
  // -------------------------------------------------------------------------

  private async fetchAllWorkflowsForPipeline(
    pipelineId: string,
    signal: AbortSignal | undefined,
  ): Promise<CircleCIWorkflow[]> {
    const out: CircleCIWorkflow[] = [];
    let token: string | null = null;
    do {
      const url = this.buildWorkflowsUrl(pipelineId, token);
      const res = await this.fetch<CircleCIWorkflowsResponse>(
        url,
        'workflows',
        signal,
      );
      out.push(...res.body.items);
      token = res.body.next_page_token ?? null;
    } while (token !== null);
    return out;
  }

  private async fetchAllJobsForWorkflow(
    workflowId: string,
    signal: AbortSignal | undefined,
  ): Promise<CircleCIJob[]> {
    const out: CircleCIJob[] = [];
    let token: string | null = null;
    do {
      const url = this.buildJobsUrl(workflowId, token);
      const res = await this.fetch<CircleCIJobsResponse>(url, 'jobs', signal);
      out.push(...res.body.items);
      token = res.body.next_page_token ?? null;
    } while (token !== null);
    return out;
  }

  private async fetchPipelinesPage(
    page: string | null,
    options: SyncOptions,
    signal: AbortSignal | undefined,
  ): Promise<{ items: PipelinePageBatch[]; next: string | null }> {
    const decoded = page !== null ? this.decodePageCursor(page) : null;
    const slug = decoded?.slug ?? this.settings.projectSlugs[0]!;
    const token = decoded?.token ?? null;
    const url = this.buildPipelinesUrl(slug, token);
    const res = await this.fetch<CircleCIPipelinesResponse>(
      url,
      'pipelines',
      signal,
    );

    const cutoff = this.cutoffMs(options);
    const pipelines = res.body.items;

    const inWindow: CircleCIPipeline[] = [];
    let crossedCutoff = false;
    for (const p of pipelines) {
      const updatedMs = parseEpoch(p.updated_at, 'iso');
      if (cutoff !== null && updatedMs !== null && updatedMs < cutoff) {
        crossedCutoff = true;
        continue;
      }
      inWindow.push(p);
    }

    const workflowsBySlug = new Map<string, CircleCIWorkflow[]>();
    const jobsByWorkflow = new Map<string, CircleCIJob[]>();
    if (this.workflowsNeeded()) {
      for (const p of inWindow) {
        signal?.throwIfAborted();
        const wfs = await this.fetchAllWorkflowsForPipeline(p.id, signal);
        workflowsBySlug.set(p.id, wfs);
        if (this.isResourceEnabled('jobs')) {
          for (const wf of wfs) {
            signal?.throwIfAborted();
            const jobs = await this.fetchAllJobsForWorkflow(wf.id, signal);
            jobsByWorkflow.set(wf.id, jobs);
          }
        }
      }
    }

    const batch: PipelinePageBatch = {
      slug,
      pipelines: inWindow,
      workflowsByPipeline: workflowsBySlug,
      jobsByWorkflow,
    };

    let next: string | null;
    const nextToken = res.body.next_page_token ?? null;
    if (nextToken !== null && !crossedCutoff) {
      next = this.encodePageCursor({ slug, token: nextToken });
    } else {
      const nextSlug = this.nextSlug(slug);
      next =
        nextSlug !== null
          ? this.encodePageCursor({ slug: nextSlug, token: null })
          : null;
    }

    return { items: [batch], next };
  }

  // -------------------------------------------------------------------------
  // Writers
  // -------------------------------------------------------------------------

  private async writeBatch(
    storage: StorageHandle,
    batch: PipelinePageBatch,
  ): Promise<void> {
    const writePipelines = this.isResourceEnabled('pipelines');
    const writeWorkflows = this.isResourceEnabled('workflows');
    const writeJobs = this.isResourceEnabled('jobs');
    const writeEvents = this.isResourceEnabled('pipeline_events');

    for (const p of batch.pipelines) {
      const createdMs = parseEpoch(p.created_at, 'iso');
      const updatedMs = parseEpoch(p.updated_at, 'iso');
      if (createdMs === null || updatedMs === null) {
        console.warn(
          `[connector-circleci] skipping pipeline ${p.id} with unparseable timestamps`,
        );
        continue;
      }

      if (writePipelines) {
        await storage.entity({
          type: 'circleci_pipeline',
          id: p.id,
          attributes: {
            pipelineId: p.id,
            number: p.number,
            projectSlug: p.project_slug,
            state: p.state,
            branch: p.vcs?.branch ?? null,
            revision: p.vcs?.revision ?? null,
            tag: p.vcs?.tag ?? null,
            triggerType: p.trigger?.type ?? null,
            triggerActor: p.trigger?.actor?.login ?? null,
            createdAt: createdMs,
            updatedAt: updatedMs,
          },
          updated_at: updatedMs,
        });
      }

      const workflows = batch.workflowsByPipeline.get(p.id) ?? [];
      for (const wf of workflows) {
        const wfCreatedMs = parseEpoch(wf.created_at, 'iso');
        const wfStoppedMs = parseEpoch(wf.stopped_at ?? null, 'iso');
        if (wfCreatedMs === null) {
          console.warn(
            `[connector-circleci] skipping workflow ${wf.id} with unparseable created_at`,
          );
          continue;
        }
        const durationMs =
          wfStoppedMs !== null && wfStoppedMs >= wfCreatedMs
            ? wfStoppedMs - wfCreatedMs
            : null;
        const wfAttrs: Record<string, JSONValue> = {
          workflowId: wf.id,
          pipelineId: wf.pipeline_id,
          projectSlug: wf.project_slug,
          name: wf.name,
          status: wf.status,
          startedBy: wf.started_by ?? null,
          createdAt: wfCreatedMs,
          stoppedAt: wfStoppedMs,
          durationMs,
        };

        if (writeWorkflows) {
          await storage.entity({
            type: 'circleci_workflow',
            id: wf.id,
            attributes: wfAttrs,
            updated_at: wfStoppedMs ?? wfCreatedMs,
          });
        }

        if (writeEvents) {
          await storage.event({
            name: 'circleci_pipeline_event',
            start_ts: wfCreatedMs,
            end_ts: wfStoppedMs,
            attributes: wfAttrs,
          });
        }

        if (writeJobs) {
          const jobs = batch.jobsByWorkflow.get(wf.id) ?? [];
          for (const job of jobs) {
            const startedMs = parseEpoch(job.started_at ?? null, 'iso');
            const stoppedMs = parseEpoch(job.stopped_at ?? null, 'iso');
            const jobDurationMs =
              startedMs !== null && stoppedMs !== null && stoppedMs >= startedMs
                ? stoppedMs - startedMs
                : null;
            await storage.entity({
              type: 'circleci_job',
              id: job.id,
              attributes: {
                jobId: job.id,
                workflowId: wf.id,
                pipelineId: wf.pipeline_id,
                projectSlug: job.project_slug ?? wf.project_slug,
                name: job.name,
                status: job.status,
                type: job.type ?? null,
                jobNumber: job.job_number ?? null,
                startedAt: startedMs,
                stoppedAt: stoppedMs,
                durationMs: jobDurationMs,
              },
              updated_at: stoppedMs ?? startedMs ?? wfCreatedMs,
            });
          }
        }
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

    return paginateChunked<CircleCIPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (_phase, page, sig) =>
        this.fetchPipelinesPage(page, options, sig),
      writeBatch: async (_phase, items, page) => {
        if (isFull && page === null) {
          if (this.isResourceEnabled('pipelines')) {
            await storage.entities([], { types: ['circleci_pipeline'] });
          }
          if (this.isResourceEnabled('workflows')) {
            await storage.entities([], { types: ['circleci_workflow'] });
          }
          if (this.isResourceEnabled('jobs')) {
            await storage.entities([], { types: ['circleci_job'] });
          }
          if (this.isResourceEnabled('pipeline_events')) {
            await storage.events([], { names: ['circleci_pipeline_event'] });
          }
        }
        for (const batch of items as PipelinePageBatch[]) {
          await this.writeBatch(storage, batch);
        }
      },
    });
  }
}

interface PipelinePageBatch {
  slug: string;
  pipelines: CircleCIPipeline[];
  workflowsByPipeline: Map<string, CircleCIWorkflow[]>;
  jobsByWorkflow: Map<string, CircleCIJob[]>;
}
