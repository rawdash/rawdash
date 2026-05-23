import {
  type HttpResponse,
  type RateLimitPolicy,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ChunkedSyncCursor,
  type ConnectorContext,
  type CredentialsSchema,
  type JSONValue,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
  paginateChunked,
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
        'Vercel access token (Personal or Team). Create one at Vercel → Account Settings → Tokens.',
      placeholder: 'vercel_token',
      secret: true,
    }),
    teamId: z.string().min(1).optional().meta({
      label: 'Team ID (optional)',
      description:
        'Vercel team ID (slug or `team_...`). Omit to use the token owner scope. Required if the token is a team token.',
      placeholder: 'team_abc123',
    }),
    projects: z.array(z.string().min(1)).nonempty().optional().meta({
      label: 'Projects (optional)',
      description:
        'Restrict deployment sync to specific Vercel project IDs (e.g. `prj_...`). Omit to sync every project the token can see.',
    }),
    resources: z
      .array(z.enum(['projects', 'deployments', 'deployment_events']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          "Which Vercel resources to sync. Omit to sync all of them. 'deployment_events' depends on 'deployments' being fetched — enabling it without 'deployments' still runs the deployments query, but skips writing deployment entities.",
      }),
    deploymentsLookbackDays: z
      .number()
      .int()
      .positive()
      .max(365)
      .optional()
      .meta({
        label: 'Deployments lookback (days)',
        description:
          'How many days back to fetch deployments on a full sync. Defaults to 30. Vercel returns deployments newest-first; this caps the backfill window.',
        placeholder: '30',
      }),
  }),
);

export type VercelResource = 'projects' | 'deployments' | 'deployment_events';

export interface VercelSettings {
  teamId?: string;
  projects?: readonly string[];
  resources?: readonly VercelResource[];
  deploymentsLookbackDays?: number;
}

const vercelCredentials = {
  apiToken: {
    description: 'Vercel access token',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type VercelCredentials = typeof vercelCredentials;

// ---------------------------------------------------------------------------
// Rate-limit policy — Vercel sends standard `X-RateLimit-*` headers, reset is
// a Unix timestamp in seconds.
// ---------------------------------------------------------------------------

const vercelRateLimit: RateLimitPolicy = {
  parse(h) {
    const remainingRaw = h.get('x-ratelimit-remaining');
    const resetRaw = h.get('x-ratelimit-reset');
    if (remainingRaw === null || resetRaw === null) {
      return null;
    }
    const remaining = Number(remainingRaw);
    const reset = Number(resetRaw);
    if (!Number.isFinite(remaining) || !Number.isFinite(reset) || reset < 0) {
      return null;
    }
    return { remaining, resetAt: new Date(reset * 1000) };
  },
};

// ---------------------------------------------------------------------------
// Sync phases + cursor
// ---------------------------------------------------------------------------

const PHASE_ORDER = ['projects', 'deployments'] as const;

type VercelPhase = (typeof PHASE_ORDER)[number];

type VercelSyncCursor = ChunkedSyncCursor<VercelPhase, string>;

function isVercelSyncCursor(value: unknown): value is VercelSyncCursor {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as { phase?: unknown; page?: unknown };
  if (typeof v.phase !== 'string') {
    return false;
  }
  if (!(PHASE_ORDER as readonly string[]).includes(v.phase)) {
    return false;
  }
  if (v.page !== null && typeof v.page !== 'string') {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Vercel API types
// ---------------------------------------------------------------------------

interface VercelProject {
  id: string;
  name: string;
  accountId?: string;
  framework: string | null;
  createdAt: number;
  updatedAt: number;
}

interface VercelProjectsResponse {
  projects: VercelProject[];
  pagination: VercelPagination;
}

interface VercelPagination {
  count: number;
  next: number | null;
  prev?: number | null;
}

interface VercelDeploymentCreator {
  uid: string;
  username?: string | null;
  email?: string | null;
}

interface VercelDeploymentMeta {
  githubCommitRef?: string;
  githubCommitSha?: string;
  githubCommitMessage?: string;
  gitlabCommitRef?: string;
  bitbucketCommitRef?: string;
  branch?: string;
}

interface VercelDeployment {
  uid: string;
  name: string;
  url: string;
  created: number;
  createdAt?: number;
  state:
    | 'BUILDING'
    | 'ERROR'
    | 'INITIALIZING'
    | 'QUEUED'
    | 'READY'
    | 'CANCELED';
  target: 'production' | 'staging' | 'preview' | null;
  inspectorUrl?: string | null;
  creator: VercelDeploymentCreator;
  buildingAt?: number | null;
  ready?: number | null;
  source?: 'cli' | 'git' | 'import' | 'api-trigger-git-deploy' | string | null;
  meta?: VercelDeploymentMeta | null;
  projectId?: string;
}

interface VercelDeploymentsResponse {
  deployments: VercelDeployment[];
  pagination: VercelPagination;
}

// ---------------------------------------------------------------------------
// Schemas — describe the per-resource API response shape consumed by request()
// ---------------------------------------------------------------------------

const idString = z.string().min(1);
const nonNegInt = z.number().int().nonnegative();

const paginationSchema = z.object({
  count: nonNegInt,
  next: nonNegInt.nullable(),
});

const projectSchema = z.object({
  id: idString,
  name: z.string().min(1),
  framework: z.string().nullable(),
  createdAt: nonNegInt,
  updatedAt: nonNegInt,
});

const projectsResponseSchema = z.object({
  projects: z.array(projectSchema),
  pagination: paginationSchema,
});

const deploymentStateSchema = z.enum([
  'BUILDING',
  'ERROR',
  'INITIALIZING',
  'QUEUED',
  'READY',
  'CANCELED',
]);

const deploymentTargetSchema = z
  .enum(['production', 'staging', 'preview'])
  .nullable();

const deploymentSchema = z.object({
  uid: idString,
  name: z.string(),
  url: z.string(),
  created: nonNegInt,
  state: deploymentStateSchema,
  target: deploymentTargetSchema,
  creator: z.object({
    uid: idString,
    username: z.string().nullable(),
  }),
  buildingAt: nonNegInt.nullable(),
  ready: nonNegInt.nullable(),
  source: z.string().nullable(),
  meta: z
    .object({
      githubCommitRef: z.string().nullable(),
      githubCommitSha: z.string().nullable(),
    })
    .nullable(),
  projectId: z.string(),
});

const deploymentsResponseSchema = z.object({
  deployments: z.array(deploymentSchema),
  pagination: paginationSchema,
});

// ---------------------------------------------------------------------------
// VercelConnector
// ---------------------------------------------------------------------------

const VERCEL_API_HOST = 'api.vercel.com';
const VERCEL_API_BASE = `https://${VERCEL_API_HOST}`;
const PROJECTS_PAGE_SIZE = 100;
const DEPLOYMENTS_PAGE_SIZE = 100;
const DEFAULT_LOOKBACK_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class VercelConnector extends BaseConnector<
  VercelSettings,
  VercelCredentials
> {
  static readonly id = 'vercel';

  static readonly schemas = {
    projects: projectsResponseSchema,
    deployments: deploymentsResponseSchema,
  } as const;

  static create(input: unknown, ctx?: ConnectorContext): VercelConnector {
    const parsed = configFields.parse(input);
    return new VercelConnector(
      {
        teamId: parsed.teamId,
        projects: parsed.projects,
        resources: parsed.resources,
        deploymentsLookbackDays: parsed.deploymentsLookbackDays,
      },
      { apiToken: parsed.apiToken },
      ctx,
    );
  }

  readonly id = 'vercel';
  override readonly credentials = vercelCredentials;

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.creds.apiToken}`,
      'User-Agent': 'rawdash/connector-vercel (+https://rawdash.dev)',
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
      rateLimit: vercelRateLimit,
    });
  }

  // -------------------------------------------------------------------------
  // Resource enablement
  // -------------------------------------------------------------------------

  private isResourceEnabled(resource: VercelResource): boolean {
    const enabled = this.settings.resources;
    if (!enabled || enabled.length === 0) {
      return true;
    }
    return enabled.includes(resource);
  }

  private activePhases(): VercelPhase[] {
    const phases: VercelPhase[] = [];
    if (this.isResourceEnabled('projects')) {
      phases.push('projects');
    }
    if (
      this.isResourceEnabled('deployments') ||
      this.isResourceEnabled('deployment_events')
    ) {
      phases.push('deployments');
    }
    return phases;
  }

  // -------------------------------------------------------------------------
  // URL building + sanitization
  // -------------------------------------------------------------------------

  private allowedPagePath(phase: VercelPhase): string {
    switch (phase) {
      case 'projects':
        return '/v9/projects';
      case 'deployments':
        return '/v6/deployments';
    }
  }

  private sanitizePageUrl(
    phase: VercelPhase,
    pageUrl: string | null,
  ): string | null {
    if (pageUrl === null) {
      return null;
    }
    const allowedPath = this.allowedPagePath(phase);
    try {
      const u = new URL(pageUrl);
      if (
        u.protocol !== 'https:' ||
        u.host !== VERCEL_API_HOST ||
        u.pathname !== allowedPath
      ) {
        return null;
      }
      return u.toString();
    } catch {
      return null;
    }
  }

  private resolveCursor(cursor: unknown): VercelSyncCursor | undefined {
    if (!isVercelSyncCursor(cursor)) {
      return undefined;
    }
    return {
      phase: cursor.phase,
      page: this.sanitizePageUrl(cursor.phase, cursor.page),
    };
  }

  private withTeamId(u: URL): URL {
    if (this.settings.teamId !== undefined) {
      u.searchParams.set('teamId', this.settings.teamId);
    }
    return u;
  }

  private buildInitialProjectsUrl(): string {
    const u = new URL(`${VERCEL_API_BASE}/v9/projects`);
    u.searchParams.set('limit', String(PROJECTS_PAGE_SIZE));
    this.withTeamId(u);
    return u.toString();
  }

  private buildInitialDeploymentsUrl(options: SyncOptions): string {
    const u = new URL(`${VERCEL_API_BASE}/v6/deployments`);
    u.searchParams.set('limit', String(DEPLOYMENTS_PAGE_SIZE));
    for (const project of this.settings.projects ?? []) {
      u.searchParams.append('projectId', project);
    }
    const sinceMs = this.computeDeploymentsSinceMs(options);
    if (sinceMs !== null) {
      u.searchParams.set('since', String(sinceMs));
    }
    this.withTeamId(u);
    return u.toString();
  }

  private computeDeploymentsSinceMs(options: SyncOptions): number | null {
    if (options.mode === 'latest' && options.since) {
      const ms = new Date(options.since).getTime();
      if (Number.isFinite(ms)) {
        return ms;
      }
    }
    const days = this.settings.deploymentsLookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    return Date.now() - days * MS_PER_DAY;
  }

  // -------------------------------------------------------------------------
  // Fetchers
  // -------------------------------------------------------------------------

  private buildNextPageUrl(
    phase: VercelPhase,
    currentUrl: string,
    until: number,
  ): string {
    const u = new URL(currentUrl);
    u.searchParams.set('until', String(until));
    return u.toString();
  }

  private async fetchProjectsPage(
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<{ items: VercelProject[]; next: string | null }> {
    const url = page ?? this.buildInitialProjectsUrl();
    const res = await this.fetch<VercelProjectsResponse>(
      url,
      'projects',
      signal,
    );
    const next =
      res.body.pagination.next !== null &&
      res.body.pagination.next !== undefined
        ? this.sanitizePageUrl(
            'projects',
            this.buildNextPageUrl('projects', url, res.body.pagination.next),
          )
        : null;
    return { items: res.body.projects, next };
  }

  private async fetchDeploymentsPage(
    page: string | null,
    options: SyncOptions,
    signal: AbortSignal | undefined,
  ): Promise<{ items: VercelDeployment[]; next: string | null }> {
    const url = page ?? this.buildInitialDeploymentsUrl(options);
    const res = await this.fetch<VercelDeploymentsResponse>(
      url,
      'deployments',
      signal,
    );
    const next =
      res.body.pagination.next !== null &&
      res.body.pagination.next !== undefined
        ? this.sanitizePageUrl(
            'deployments',
            this.buildNextPageUrl('deployments', url, res.body.pagination.next),
          )
        : null;
    return { items: res.body.deployments, next };
  }

  // -------------------------------------------------------------------------
  // Writers
  // -------------------------------------------------------------------------

  private async writeProjects(
    storage: StorageHandle,
    projects: VercelProject[],
  ): Promise<void> {
    for (const p of projects) {
      const createdMs = Number.isFinite(p.createdAt) ? p.createdAt : null;
      const updatedMs = Number.isFinite(p.updatedAt) ? p.updatedAt : null;
      if (createdMs === null || updatedMs === null) {
        console.warn(
          `[connector-vercel] skipping project ${p.id} with unparseable timestamps`,
        );
        continue;
      }
      await storage.entity({
        type: 'vercel_project',
        id: p.id,
        attributes: {
          name: p.name,
          framework: p.framework,
          accountId: p.accountId ?? null,
          createdAt: createdMs,
          updatedAt: updatedMs,
        },
        updated_at: updatedMs,
      });
    }
  }

  private async writeDeployments(
    storage: StorageHandle,
    deployments: VercelDeployment[],
  ): Promise<void> {
    const writeEntities = this.isResourceEnabled('deployments');
    const writeEvents = this.isResourceEnabled('deployment_events');

    for (const d of deployments) {
      const createdMs = Number.isFinite(d.created) ? d.created : null;
      if (createdMs === null) {
        console.warn(
          `[connector-vercel] skipping deployment ${d.uid} with unparseable created timestamp`,
        );
        continue;
      }
      const buildingMs =
        d.buildingAt !== null &&
        d.buildingAt !== undefined &&
        Number.isFinite(d.buildingAt)
          ? d.buildingAt
          : null;
      const readyMs =
        d.ready !== null && d.ready !== undefined && Number.isFinite(d.ready)
          ? d.ready
          : null;
      const buildDurationMs =
        readyMs !== null && buildingMs !== null && readyMs >= buildingMs
          ? readyMs - buildingMs
          : null;
      const gitRef =
        d.meta?.githubCommitRef ??
        d.meta?.gitlabCommitRef ??
        d.meta?.bitbucketCommitRef ??
        d.meta?.branch ??
        null;
      const gitSha = d.meta?.githubCommitSha ?? null;
      const projectId = d.projectId ?? null;
      const target = d.target ?? null;
      const creatorUsername = d.creator.username ?? null;
      const baseAttributes: Record<string, JSONValue> = {
        deploymentId: d.uid,
        name: d.name,
        url: d.url,
        state: d.state,
        target,
        projectId,
        creatorUid: d.creator.uid,
        creatorUsername,
        source: d.source ?? null,
        gitRef,
        gitSha,
        createdAt: createdMs,
        buildingAt: buildingMs,
        readyAt: readyMs,
        buildDurationMs,
      };

      if (writeEntities) {
        await storage.entity({
          type: 'vercel_deployment',
          id: d.uid,
          attributes: baseAttributes,
          updated_at: readyMs ?? buildingMs ?? createdMs,
        });
      }

      if (writeEvents) {
        await storage.event({
          name: 'vercel_deployment_event',
          start_ts: createdMs,
          end_ts: readyMs,
          attributes: baseAttributes,
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

    return paginateChunked<VercelPhase, string>({
      phases,
      cursor,
      signal,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'projects':
            return this.fetchProjectsPage(page, sig);
          case 'deployments':
            return this.fetchDeploymentsPage(page, options, sig);
        }
      },
      writeBatch: async (phase, items, page) => {
        if (isFull && page === null) {
          switch (phase) {
            case 'projects':
              if (this.isResourceEnabled('projects')) {
                await storage.entities([], { types: ['vercel_project'] });
              }
              break;
            case 'deployments':
              if (this.isResourceEnabled('deployments')) {
                await storage.entities([], { types: ['vercel_deployment'] });
              }
              if (this.isResourceEnabled('deployment_events')) {
                await storage.events([], {
                  names: ['vercel_deployment_event'],
                });
              }
              break;
          }
        }
        switch (phase) {
          case 'projects':
            if (!this.isResourceEnabled('projects')) {
              return;
            }
            return this.writeProjects(storage, items as VercelProject[]);
          case 'deployments':
            return this.writeDeployments(storage, items as VercelDeployment[]);
        }
      },
    });
  }
}
