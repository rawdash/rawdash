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
    apiToken: z.object({ $secret: z.string() }).meta({
      label: 'API Token',
      description:
        'LaunchDarkly API access token with read access. Create one at LaunchDarkly -> Account settings -> Authorization -> Access tokens.',
      placeholder: 'api-...',
      secret: true,
    }),
    projects: z.array(z.string().min(1)).nonempty().optional().meta({
      label: 'Projects (optional)',
      description:
        'Restrict the sync to specific LaunchDarkly project keys. Omit to sync every project the token can see.',
    }),
    resources: z
      .array(z.enum(['projects', 'feature_flags', 'flag_events']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which LaunchDarkly resources to sync. Omit to sync all of them. feature_flags depends on projects being fetched - enabling it without projects still runs the projects query, but skips writing project entities.',
      }),
    auditLogLookbackDays: z.number().int().positive().max(90).optional().meta({
      label: 'Audit log lookback (days)',
      description:
        'How many days back to fetch audit-log events on a full sync. Defaults to 30. LaunchDarkly returns audit events newest-first; this caps the backfill window.',
      placeholder: '30',
    }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'LaunchDarkly',
  category: 'engineering',
  brandColor: '#FFC110',
  tagline:
    'Sync LaunchDarkly projects, feature flags, and audit-log events - including flag state per environment, kind, and recent rollout changes.',
  vendor: {
    name: 'LaunchDarkly',
    apiDocs: 'https://apidocs.launchdarkly.com/',
    website: 'https://launchdarkly.com',
  },
  auth: {
    summary:
      'A LaunchDarkly API access token with read access is required. Personal or service tokens both work; a reader-role service token is the recommended minimum.',
    setup: [
      'Open LaunchDarkly -> Account settings -> Authorization -> Access tokens.',
      'Create an access token with the Reader role (or a custom role that grants read access to projects, flags, and the audit log).',
      'Copy the generated token and store it as a secret, referencing it from the connector config as `apiToken: secret("LD_API_TOKEN")`.',
    ],
  },
  rateLimit:
    'LaunchDarkly defaults to 5 requests/second per token; X-Ratelimit-Global-Remaining and X-Ratelimit-Reset (Unix ms) headers are honored. Retry-After is honored on 429.',
  limitations: [
    'Flag-level served counts (Data Export) and the Experimentation API are out of scope.',
    'Feature flags are fetched per project; the audit log is a single global stream filtered by created-after timestamp.',
    'Custom hosts / federal instances are out of scope (pagination URLs are pinned to app.launchdarkly.com).',
  ],
});

export type LaunchDarklyResource = 'projects' | 'feature_flags' | 'flag_events';

export interface LaunchDarklySettings {
  projects?: readonly string[];
  resources?: readonly LaunchDarklyResource[];
  auditLogLookbackDays?: number;
}

const launchDarklyCredentials = {
  apiToken: {
    description: 'LaunchDarkly API access token',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type LaunchDarklyCredentials = typeof launchDarklyCredentials;

const launchDarklyRateLimit = standardRateLimitPolicy({
  remainingHeader: 'x-ratelimit-global-remaining',
  resetHeader: 'x-ratelimit-reset',
  resetUnit: 'ms',
});

const PHASE_ORDER = ['projects', 'feature_flags', 'audit_log'] as const;

type LaunchDarklyPhase = (typeof PHASE_ORDER)[number];

type LaunchDarklySyncCursor = ChunkedSyncCursor<LaunchDarklyPhase, string>;

const isLaunchDarklySyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

interface LDLink {
  href: string;
  type?: string;
}

interface LDLinks {
  next?: LDLink;
  self?: LDLink;
}

interface LDProject {
  _id: string;
  key: string;
  name: string;
  tags?: string[];
}

interface LDProjectsResponse {
  items: LDProject[];
  _links?: LDLinks;
  totalCount?: number;
}

interface LDFlagEnvironment {
  on?: boolean;
  archived?: boolean;
  salt?: string;
  lastModified?: number;
}

interface LDFlag {
  _id?: string;
  key: string;
  name: string;
  description?: string;
  kind: 'boolean' | 'multivariate' | string;
  archived?: boolean;
  tags?: string[];
  creationDate?: number;
  variations?: Array<{ _id?: string; name?: string | null; value?: unknown }>;
  environments?: Record<string, LDFlagEnvironment>;
}

interface LDFlagsResponse {
  items: LDFlag[];
  _links?: LDLinks;
  totalCount?: number;
}

interface LDMember {
  _id?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

interface LDAuditEntry {
  _id: string;
  kind?: string;
  name?: string;
  description?: string;
  shortDescription?: string;
  comment?: string;
  date: number;
  member?: LDMember;
  target?: {
    name?: string;
    resources?: string[];
  };
  titleVerb?: string;
  title?: string;
}

interface LDAuditLogResponse {
  items: LDAuditEntry[];
  _links?: LDLinks;
  totalCount?: number;
}

const idString = z.string().min(1);

const linksSchema = z
  .object({
    next: z
      .object({ href: z.string(), type: z.string().optional() })
      .optional(),
    self: z
      .object({ href: z.string(), type: z.string().optional() })
      .optional(),
  })
  .optional();

const projectSchema = z.object({
  _id: idString,
  key: z.string().min(1),
  name: z.string(),
  tags: z.array(z.string()).optional(),
});

const projectsResponseSchema = z.object({
  items: z.array(projectSchema),
  _links: linksSchema,
  totalCount: z.number().int().nonnegative().optional(),
});

const flagEnvironmentSchema = z.object({
  on: z.boolean().optional(),
  archived: z.boolean().optional(),
  salt: z.string().optional(),
  lastModified: z.number().int().nonnegative().optional(),
});

const flagSchema = z.object({
  _id: z.string().optional(),
  key: z.string().min(1),
  name: z.string(),
  description: z.string().optional(),
  kind: z.string(),
  archived: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  creationDate: z.number().int().nonnegative().optional(),
  variations: z
    .array(
      z.object({
        _id: z.string().optional(),
        name: z.string().nullable().optional(),
        value: z.unknown(),
      }),
    )
    .optional(),
  environments: z.record(z.string(), flagEnvironmentSchema).optional(),
});

const flagsResponseSchema = z.object({
  items: z.array(flagSchema),
  _links: linksSchema,
  totalCount: z.number().int().nonnegative().optional(),
});

const auditEntrySchema = z.object({
  _id: idString,
  kind: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  shortDescription: z.string().optional(),
  comment: z.string().optional(),
  date: z.number().int().nonnegative(),
  member: z
    .object({
      _id: z.string().optional(),
      email: z.string().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
    })
    .optional(),
  target: z
    .object({
      name: z.string().optional(),
      resources: z.array(z.string()).optional(),
    })
    .optional(),
  titleVerb: z.string().optional(),
  title: z.string().optional(),
});

const auditLogResponseSchema = z.object({
  items: z.array(auditEntrySchema),
  _links: linksSchema,
  totalCount: z.number().int().nonnegative().optional(),
});

export const launchdarklyResources = defineResources({
  launchdarkly_project: {
    shape: 'entity',
    description:
      'LaunchDarkly projects, with their key, display name, and tags.',
    endpoint: 'GET /api/v2/projects',
    fields: [
      { name: 'key', description: 'Project key (stable identifier).' },
      { name: 'name', description: 'Project display name.' },
      { name: 'tags', description: 'Project tags.' },
    ],
    responses: { projects: projectsResponseSchema },
  },
  launchdarkly_feature_flag: {
    shape: 'entity',
    description:
      'Feature flags across one or more projects, including kind (boolean | multivariate | other), archived state, tags, variations, and per-environment on/off + last-modified.',
    endpoint: 'GET /api/v2/flags/{projectKey}',
    fields: [
      { name: 'key', description: 'Flag key (stable identifier).' },
      { name: 'name', description: 'Flag display name.' },
      {
        name: 'kind',
        description: 'Flag kind: boolean | multivariate | other.',
      },
      {
        name: 'projectKey',
        description: 'Project key the flag belongs to.',
      },
      { name: 'archived', description: 'Whether the flag is archived.' },
      { name: 'tags', description: 'Flag tags.' },
      {
        name: 'variationCount',
        description: 'Number of variations on the flag.',
      },
      {
        name: 'environments',
        description:
          'Map of envKey -> { on, archived, lastModified } summarizing flag state per environment.',
      },
      {
        name: 'creationDate',
        description: 'Flag creation timestamp (epoch ms).',
      },
    ],
    responses: { feature_flags: flagsResponseSchema },
  },
  launchdarkly_flag_event: {
    shape: 'event',
    description:
      'Audit-log entries for flag-related changes (flag created / modified / toggled / archived), with the acting member and target resources.',
    endpoint: 'GET /api/v2/auditlog',
    notes:
      'Filtered to entries newer than the lookback window (default 30 days) and incrementally bounded by options.since on subsequent syncs. LaunchDarkly returns events newest-first.',
    fields: [
      { name: 'auditId', description: 'LaunchDarkly audit-log entry id.' },
      {
        name: 'kind',
        description: 'Audit entry kind (e.g. flag, project, environment).',
      },
      {
        name: 'titleVerb',
        description: 'Verb describing the action (e.g. "updated", "created").',
      },
      {
        name: 'memberEmail',
        description: 'Email of the member who performed the action.',
      },
      {
        name: 'targetName',
        description: 'Name of the target resource (e.g. flag key).',
      },
      {
        name: 'targetResources',
        description:
          'Resource paths the action touched (e.g. proj/<key>:env/<env>:flag/<key>).',
      },
    ],
    responses: { audit_log: auditLogResponseSchema },
  },
});

const LD_API_HOST = 'app.launchdarkly.com';
const LD_API_BASE = `https://${LD_API_HOST}`;
const PROJECTS_PAGE_SIZE = 100;
const FLAGS_PAGE_SIZE = 100;
const AUDIT_LOG_PAGE_SIZE = 50;
const DEFAULT_AUDIT_LOOKBACK_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const id = 'launchdarkly';

interface FlagsPageItem {
  projectKey: string;
  flags: LDFlag[];
}

export class LaunchDarklyConnector extends BaseConnector<
  LaunchDarklySettings,
  LaunchDarklyCredentials
> {
  static readonly id = id;

  static readonly resources = launchdarklyResources;

  static readonly schemas = schemasFromResources(launchdarklyResources);

  static create(input: unknown, ctx?: ConnectorContext): LaunchDarklyConnector {
    const parsed = configFields.parse(input);
    return new LaunchDarklyConnector(
      {
        projects: parsed.projects,
        resources: parsed.resources,
        auditLogLookbackDays: parsed.auditLogLookbackDays,
      },
      { apiToken: parsed.apiToken },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = launchDarklyCredentials;

  private discoveredProjectKeys: string[] | null = null;
  private discoveredProjectKeysComplete = false;

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: this.creds.apiToken,
      'User-Agent': connectorUserAgent('launchdarkly'),
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
      rateLimit: launchDarklyRateLimit,
    });
  }

  private activePhases(): LaunchDarklyPhase[] {
    return selectActivePhases<LaunchDarklyResource, LaunchDarklyPhase>(
      (r) => {
        switch (r) {
          case 'projects':
            return 'projects';
          case 'feature_flags':
            return 'feature_flags';
          case 'flag_events':
            return 'audit_log';
        }
      },
      PHASE_ORDER,
      this.settings.resources,
    );
  }

  private allowedPagePath(
    phase: LaunchDarklyPhase,
    page: string,
  ): string | null {
    switch (phase) {
      case 'projects':
        return '/api/v2/projects';
      case 'audit_log':
        return '/api/v2/auditlog';
      case 'feature_flags': {
        try {
          const u = new URL(page);
          if (u.pathname.startsWith('/api/v2/flags/')) {
            return u.pathname;
          }
        } catch {
          return null;
        }
        return null;
      }
    }
  }

  private sanitizePageUrl(
    phase: LaunchDarklyPhase,
    pageUrl: string | null,
  ): string | null {
    if (pageUrl === null) {
      return null;
    }
    const allowedPath = this.allowedPagePath(phase, pageUrl);
    if (allowedPath === null) {
      return null;
    }
    return sanitizeAllowedUrl({
      url: pageUrl,
      host: LD_API_HOST,
      pathname: allowedPath,
    });
  }

  private resolveCursor(cursor: unknown): LaunchDarklySyncCursor | undefined {
    if (!isLaunchDarklySyncCursor(cursor)) {
      return undefined;
    }
    return {
      phase: cursor.phase,
      page: this.sanitizePageUrl(cursor.phase, cursor.page),
    };
  }

  private resolveNextHref(
    phase: LaunchDarklyPhase,
    href: string | undefined,
  ): string | null {
    if (!href) {
      return null;
    }
    let abs: string;
    try {
      abs = new URL(href, LD_API_BASE).toString();
    } catch {
      return null;
    }
    return this.sanitizePageUrl(phase, abs);
  }

  private buildInitialProjectsUrl(): string {
    const u = new URL(`${LD_API_BASE}/api/v2/projects`);
    u.searchParams.set('limit', String(PROJECTS_PAGE_SIZE));
    return u.toString();
  }

  private buildInitialFlagsUrl(projectKey: string): string {
    const u = new URL(`${LD_API_BASE}/api/v2/flags/${projectKey}`);
    u.searchParams.set('limit', String(FLAGS_PAGE_SIZE));
    u.searchParams.set('summary', 'false');
    return u.toString();
  }

  private buildInitialAuditLogUrl(options: SyncOptions): string {
    const u = new URL(`${LD_API_BASE}/api/v2/auditlog`);
    u.searchParams.set('limit', String(AUDIT_LOG_PAGE_SIZE));
    const sinceMs = this.computeAuditSinceMs(options);
    u.searchParams.set('after', String(sinceMs));
    return u.toString();
  }

  private computeAuditSinceMs(options: SyncOptions): number {
    if (options.since) {
      const ms = parseEpoch(options.since, 'iso');
      if (ms !== null) {
        return ms;
      }
    }
    const days =
      this.settings.auditLogLookbackDays ?? DEFAULT_AUDIT_LOOKBACK_DAYS;
    return Date.now() - days * MS_PER_DAY;
  }

  private async resolveProjectKeysForFlags(
    signal: AbortSignal | undefined,
  ): Promise<string[]> {
    if (this.settings.projects && this.settings.projects.length > 0) {
      return [...this.settings.projects];
    }
    if (
      this.discoveredProjectKeysComplete &&
      this.discoveredProjectKeys !== null
    ) {
      return this.discoveredProjectKeys;
    }
    const keys: string[] = [];
    let nextUrl: string | null = this.buildInitialProjectsUrl();
    while (nextUrl) {
      signal?.throwIfAborted();
      const res = await this.fetch<LDProjectsResponse>(
        nextUrl,
        'projects',
        signal,
      );
      for (const p of res.body.items) {
        keys.push(p.key);
      }
      nextUrl = this.resolveNextHref('projects', res.body._links?.next?.href);
    }
    this.discoveredProjectKeys = keys;
    this.discoveredProjectKeysComplete = true;
    return keys;
  }

  private async fetchProjectsPage(
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<{ items: LDProject[]; next: string | null }> {
    const url = page ?? this.buildInitialProjectsUrl();
    const res = await this.fetch<LDProjectsResponse>(url, 'projects', signal);
    if (page === null) {
      this.discoveredProjectKeys = [];
      this.discoveredProjectKeysComplete = false;
    }
    if (this.discoveredProjectKeys === null) {
      this.discoveredProjectKeys = [];
    }
    for (const p of res.body.items) {
      if (!this.discoveredProjectKeys.includes(p.key)) {
        this.discoveredProjectKeys.push(p.key);
      }
    }
    const next = this.resolveNextHref('projects', res.body._links?.next?.href);
    if (next === null) {
      this.discoveredProjectKeysComplete = true;
    }
    return {
      items: res.body.items,
      next,
    };
  }

  private async fetchFlagsPage(
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<{ items: FlagsPageItem[]; next: string | null }> {
    if (page === null) {
      const projectKeys = await this.resolveProjectKeysForFlags(signal);
      if (projectKeys.length === 0) {
        return { items: [], next: null };
      }
      const firstKey = projectKeys[0]!;
      return this.fetchFlagsPageInProject(firstKey, null, projectKeys, signal);
    }
    let projectKey: string | null = null;
    try {
      const u = new URL(page);
      const m = u.pathname.match(/^\/api\/v2\/flags\/([^/]+)/);
      if (m) {
        projectKey = decodeURIComponent(m[1]!);
      }
    } catch {
      // fall through
    }
    if (projectKey === null) {
      return { items: [], next: null };
    }
    const projectKeys = await this.resolveProjectKeysForFlags(signal);
    return this.fetchFlagsPageInProject(projectKey, page, projectKeys, signal);
  }

  private async fetchFlagsPageInProject(
    projectKey: string,
    page: string | null,
    projectKeys: string[],
    signal: AbortSignal | undefined,
  ): Promise<{ items: FlagsPageItem[]; next: string | null }> {
    const url = page ?? this.buildInitialFlagsUrl(projectKey);
    const res = await this.fetch<LDFlagsResponse>(url, 'feature_flags', signal);
    const nextInProject = this.resolveNextHref(
      'feature_flags',
      res.body._links?.next?.href,
    );
    if (nextInProject !== null) {
      return {
        items: [{ projectKey, flags: res.body.items }],
        next: nextInProject,
      };
    }
    const idx = projectKeys.indexOf(projectKey);
    const nextProject = idx >= 0 ? projectKeys[idx + 1] : undefined;
    const next =
      nextProject !== undefined
        ? this.sanitizePageUrl(
            'feature_flags',
            this.buildInitialFlagsUrl(nextProject),
          )
        : null;
    return {
      items: [{ projectKey, flags: res.body.items }],
      next,
    };
  }

  private async fetchAuditLogPage(
    page: string | null,
    options: SyncOptions,
    signal: AbortSignal | undefined,
  ): Promise<{ items: LDAuditEntry[]; next: string | null }> {
    const url = page ?? this.buildInitialAuditLogUrl(options);
    const res = await this.fetch<LDAuditLogResponse>(url, 'audit_log', signal);
    const items = res.body.items;
    const sinceMs = this.computeAuditSinceMs(options);
    const lastDate = items.at(-1)?.date;
    const cutoffReached =
      lastDate !== undefined && Number.isFinite(lastDate) && lastDate < sinceMs;
    const next = cutoffReached
      ? null
      : this.resolveNextHref('audit_log', res.body._links?.next?.href);
    const filtered = items.filter((e) =>
      Number.isFinite(e.date) ? e.date >= sinceMs : true,
    );
    return { items: filtered, next };
  }

  private async writeProjects(
    storage: StorageHandle,
    projects: LDProject[],
  ): Promise<void> {
    for (const p of projects) {
      await storage.entity({
        type: 'launchdarkly_project',
        id: p.key,
        attributes: {
          key: p.key,
          name: p.name,
          tags: p.tags ?? [],
        },
        updated_at: Date.now(),
      });
    }
  }

  private async writeFlags(
    storage: StorageHandle,
    items: FlagsPageItem[],
  ): Promise<void> {
    for (const { projectKey, flags } of items) {
      for (const flag of flags) {
        const creationMs =
          flag.creationDate !== undefined && Number.isFinite(flag.creationDate)
            ? flag.creationDate
            : null;
        const envSummary: Record<string, JSONValue> = {};
        let lastModifiedMax: number | null = null;
        if (flag.environments) {
          for (const [envKey, env] of Object.entries(flag.environments)) {
            envSummary[envKey] = {
              on: env.on ?? false,
              archived: env.archived ?? false,
              lastModified: env.lastModified ?? null,
            };
            if (
              env.lastModified !== undefined &&
              Number.isFinite(env.lastModified) &&
              (lastModifiedMax === null || env.lastModified > lastModifiedMax)
            ) {
              lastModifiedMax = env.lastModified;
            }
          }
        }
        const updatedAt = lastModifiedMax ?? creationMs ?? Date.now();
        await storage.entity({
          type: 'launchdarkly_feature_flag',
          id: `${projectKey}:${flag.key}`,
          attributes: {
            projectKey,
            key: flag.key,
            name: flag.name,
            description: flag.description ?? null,
            kind: flag.kind,
            archived: flag.archived ?? false,
            tags: flag.tags ?? [],
            variationCount: flag.variations?.length ?? 0,
            environments: envSummary,
            creationDate: creationMs,
          },
          updated_at: updatedAt,
        });
      }
    }
  }

  private async writeAuditEntries(
    storage: StorageHandle,
    entries: LDAuditEntry[],
  ): Promise<void> {
    for (const e of entries) {
      if (!Number.isFinite(e.date)) {
        continue;
      }
      const attributes: Record<string, JSONValue> = {
        auditId: e._id,
        kind: e.kind ?? null,
        titleVerb: e.titleVerb ?? null,
        title: e.title ?? null,
        description: e.description ?? e.shortDescription ?? null,
        comment: e.comment ?? null,
        memberEmail: e.member?.email ?? null,
        memberName:
          e.member?.firstName || e.member?.lastName
            ? `${e.member?.firstName ?? ''} ${e.member?.lastName ?? ''}`.trim()
            : null,
        targetName: e.target?.name ?? null,
        targetResources: e.target?.resources ?? [],
      };
      await storage.event({
        name: 'launchdarkly_flag_event',
        start_ts: e.date,
        end_ts: null,
        attributes,
      });
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    this.discoveredProjectKeys = null;
    this.discoveredProjectKeysComplete = false;
    const cursor = this.resolveCursor(options.cursor);
    const isFull = options.mode === 'full';
    const phases = this.activePhases();

    return paginateChunked<LaunchDarklyPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'projects':
            return this.fetchProjectsPage(page, sig);
          case 'feature_flags':
            return this.fetchFlagsPage(page, sig);
          case 'audit_log':
            return this.fetchAuditLogPage(page, options, sig);
        }
      },
      writeBatch: async (phase, items, page) => {
        if (isFull && page === null) {
          switch (phase) {
            case 'projects':
              if (this.isResourceEnabled('projects')) {
                await storage.entities([], {
                  types: ['launchdarkly_project'],
                });
              }
              break;
            case 'feature_flags':
              if (this.isResourceEnabled('feature_flags')) {
                await storage.entities([], {
                  types: ['launchdarkly_feature_flag'],
                });
              }
              break;
            case 'audit_log':
              if (this.isResourceEnabled('flag_events')) {
                await storage.events([], {
                  names: ['launchdarkly_flag_event'],
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
            return this.writeProjects(storage, items as LDProject[]);
          case 'feature_flags':
            if (!this.isResourceEnabled('feature_flags')) {
              return;
            }
            return this.writeFlags(storage, items as FlagsPageItem[]);
          case 'audit_log':
            if (!this.isResourceEnabled('flag_events')) {
              return;
            }
            return this.writeAuditEntries(storage, items as LDAuditEntry[]);
        }
      },
    });
  }
}
