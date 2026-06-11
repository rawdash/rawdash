import {
  type HttpResponse,
  connectorUserAgent,
  parseEpoch,
  parseLinkHeader,
  standardRateLimitPolicy,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ChunkedSyncCursor,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
  type Event,
  type FetchPageResult,
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

// ---------------------------------------------------------------------------
// configFields
// ---------------------------------------------------------------------------

export const configFields = defineConfigFields(
  z.object({
    apiToken: z.object({ $secret: z.string() }).meta({
      label: 'API Token',
      description:
        'Netlify personal access token. Create one at Netlify -> User Settings -> Applications -> Personal access tokens.',
      placeholder: 'nfp_...',
      secret: true,
    }),
    siteIds: z.array(z.string().min(1)).nonempty().optional().meta({
      label: 'Site IDs (optional)',
      description:
        'Restrict the sync to specific Netlify site IDs (the UUID-style id from the site Admin panel). Omit to sync every site the token can see.',
    }),
    resources: z
      .array(z.enum(['sites', 'deploys', 'deploy_events']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          "Which Netlify resources to sync. Omit to sync all of them. 'deploy_events' rides the 'deploys' phase - enabling it without 'deploys' still fetches deploys but skips writing deploy entities.",
      }),
    deploysLookbackDays: z.number().int().positive().max(365).optional().meta({
      label: 'Deploys lookback (days)',
      description:
        'Cap the deploy backfill window to this many days. If unset, the connector fetches every deploy the API returns (newest-first). Netlify has no server-side date filter on the deploys endpoint, so the cutoff is applied client-side and short-circuits pagination once a page is entirely older than the cutoff.',
      placeholder: '30',
    }),
  }),
);

export type NetlifyResource = 'sites' | 'deploys' | 'deploy_events';

export interface NetlifySettings {
  siteIds?: readonly string[];
  resources?: readonly NetlifyResource[];
  deploysLookbackDays?: number;
}

const netlifyCredentials = {
  apiToken: {
    description: 'Netlify personal access token',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type NetlifyCredentials = typeof netlifyCredentials;

// ---------------------------------------------------------------------------
// Connector documentation metadata
// ---------------------------------------------------------------------------

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Netlify',
  category: 'infrastructure',
  brandColor: '#00C7B7',
  tagline:
    'Sync Netlify sites and deploys - including build state, branch, commit ref, and deploy duration - across your team.',
  vendor: {
    name: 'Netlify',
    domain: 'netlify.com',
    apiDocs: 'https://open-api.netlify.com/',
    website: 'https://www.netlify.com',
  },
  auth: {
    summary:
      'A Netlify personal access token is required. The token must belong to an account with read access to the sites you want to sync.',
    setup: [
      'Open Netlify -> User Settings -> Applications -> Personal access tokens.',
      'Click "New access token", give it a name, and copy the token value.',
      'Store it as a secret and reference it from the connector config as `apiToken: secret("NETLIFY_API_TOKEN")`.',
      'Optionally set `siteIds` to a list of site IDs to limit the sync scope.',
    ],
  },
  rateLimit:
    'Netlify returns standard `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers (reset is a Unix timestamp in seconds); list pagination uses the Link header (page size 100).',
  limitations: [
    'Netlify has no server-side date filter on the deploys endpoint - the connector paginates newest-first and applies `deploysLookbackDays` (if set) as a client-side cutoff that short-circuits pagination once a full page is older than the cutoff.',
    'Enabling `deploy_events` without `deploys` still runs the deploys query but skips writing deploy entities.',
    'Netlify Analytics (paid add-on), function invocation logs, and DNS/domain APIs are out of scope.',
  ],
});

// ---------------------------------------------------------------------------
// Rate-limit policy
// ---------------------------------------------------------------------------

const netlifyRateLimit = standardRateLimitPolicy({
  remainingHeader: 'x-ratelimit-remaining',
  resetHeader: 'x-ratelimit-reset',
  resetUnit: 's',
});

// ---------------------------------------------------------------------------
// Sync phases + cursor
// ---------------------------------------------------------------------------

const PHASE_ORDER = ['sites', 'deploys'] as const;

type NetlifyPhase = (typeof PHASE_ORDER)[number];

type NetlifySyncCursor = ChunkedSyncCursor<NetlifyPhase, string>;

const isNetlifySyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

// Deploys page cursor encoding: `<siteIdx>|<pageUrl?>`.
// - null page          -> start at siteIdx=0 with no URL yet
// - "<idx>|"           -> start of site at idx, build initial URL
// - "<idx>|<url>"      -> continuing pagination for site at idx
function decodeDeploysPage(page: string | null): {
  idx: number;
  url: string | null;
} {
  if (page === null) {
    return { idx: 0, url: null };
  }
  const sep = page.indexOf('|');
  if (sep === -1) {
    return { idx: 0, url: null };
  }
  const idxRaw = Number.parseInt(page.slice(0, sep), 10);
  const url = page.slice(sep + 1);
  return {
    idx: Number.isFinite(idxRaw) && idxRaw >= 0 ? idxRaw : 0,
    url: url === '' ? null : url,
  };
}

function encodeDeploysPage(idx: number, url: string | null): string {
  return `${idx}|${url ?? ''}`;
}

// ---------------------------------------------------------------------------
// Netlify API types
// ---------------------------------------------------------------------------

interface NetlifySite {
  id: string;
  site_id?: string;
  name: string;
  url: string;
  admin_url?: string | null;
  account_id?: string | null;
  account_name?: string | null;
  build_settings?: {
    repo_url?: string | null;
    repo_branch?: string | null;
    cmd?: string | null;
  } | null;
  created_at: string;
  updated_at: string;
  published_deploy?: { id: string; state: string } | null;
}

interface NetlifyDeploy {
  id: string;
  site_id: string;
  name?: string | null;
  url?: string | null;
  deploy_url?: string | null;
  state: string;
  branch?: string | null;
  context?: string | null;
  commit_ref?: string | null;
  commit_url?: string | null;
  title?: string | null;
  committer?: string | null;
  created_at: string;
  updated_at?: string | null;
  published_at?: string | null;
  deploy_time?: number | null;
  error_message?: string | null;
}

// ---------------------------------------------------------------------------
// Zod response schemas
// ---------------------------------------------------------------------------

const siteSchema = z.object({
  id: z.string().min(1),
  site_id: z.string().min(1).optional(),
  name: z.string().min(1),
  url: z.string(),
  admin_url: z.string().nullable().optional(),
  account_id: z.string().nullable().optional(),
  account_name: z.string().nullable().optional(),
  build_settings: z
    .object({
      repo_url: z.string().nullable().optional(),
      repo_branch: z.string().nullable().optional(),
      cmd: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  published_deploy: z
    .object({ id: z.string().min(1), state: z.string().min(1) })
    .nullable()
    .optional(),
});

const sitesResponseSchema = z.array(siteSchema);

const deploySchema = z.object({
  id: z.string().min(1),
  site_id: z.string().min(1),
  name: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  deploy_url: z.string().nullable().optional(),
  state: z.string().min(1),
  branch: z.string().nullable().optional(),
  context: z.string().nullable().optional(),
  commit_ref: z.string().nullable().optional(),
  commit_url: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  committer: z.string().nullable().optional(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime().nullable().optional(),
  published_at: z.iso.datetime().nullable().optional(),
  deploy_time: z.number().nullable().optional(),
  error_message: z.string().nullable().optional(),
});

const deploysResponseSchema = z.array(deploySchema);

export const netlifyResources = defineResources({
  netlify_site: {
    shape: 'entity',
    description:
      'Netlify sites with name, primary URL, owning account, linked git repo, and create/update timestamps.',
    endpoint: 'GET /api/v1/sites',
    filterable: [],
    responses: { sites: sitesResponseSchema },
  },
  netlify_deploy: {
    shape: 'entity',
    description:
      'Deploys with build state, branch, commit ref, deploy context (production/branch-deploy/deploy-preview), and build duration.',
    endpoint: 'GET /api/v1/sites/{site_id}/deploys',
    notes:
      'deployTimeMs comes from the API `deploy_time` field (seconds) when present, otherwise null. gitRef prefers `commit_ref`, falling back to `branch`.',
    filterable: [
      {
        field: 'state',
        ops: ['eq'],
        values: ['new', 'building', 'ready', 'error', 'processing', 'enqueued'],
      },
    ],
    responses: { deploys: deploysResponseSchema },
  },
  netlify_deploy_event: {
    shape: 'event',
    description:
      'Each deploy emitted as a time-bounded event spanning creation to publish, carrying the same attributes as the deploy entity.',
    endpoint: 'GET /api/v1/sites/{site_id}/deploys',
    filterable: [],
  },
});

// ---------------------------------------------------------------------------
// NetlifyConnector
// ---------------------------------------------------------------------------

const NETLIFY_API_HOST = 'api.netlify.com';
const NETLIFY_API_BASE = `https://${NETLIFY_API_HOST}/api/v1`;
const PAGE_SIZE = 100;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const id = 'netlify';

interface SiteDeploysBatch {
  siteId: string;
  items: NetlifyDeploy[];
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
      typeof clause.value === 'string'
    ) {
      return clause.value;
    }
  }
  return null;
}

export class NetlifyConnector extends BaseConnector<
  NetlifySettings,
  NetlifyCredentials
> {
  static readonly id = id;

  static readonly resources = netlifyResources;

  static readonly schemas = schemasFromResources(netlifyResources);

  static create(input: unknown, ctx?: ConnectorContext): NetlifyConnector {
    const parsed = configFields.parse(input);
    return new NetlifyConnector(
      {
        siteIds: parsed.siteIds,
        resources: parsed.resources,
        deploysLookbackDays: parsed.deploysLookbackDays,
      },
      { apiToken: parsed.apiToken },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = netlifyCredentials;

  private discoveredSiteIds: string[] | null = null;

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.creds.apiToken}`,
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('netlify'),
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
      rateLimit: netlifyRateLimit,
    });
  }

  // -------------------------------------------------------------------------
  // Resource enablement
  // -------------------------------------------------------------------------

  private activePhases(): NetlifyPhase[] {
    return selectActivePhases<NetlifyResource, NetlifyPhase>(
      (r) => (r === 'sites' ? 'sites' : 'deploys'),
      PHASE_ORDER,
      this.settings.resources,
    );
  }

  // -------------------------------------------------------------------------
  // URL sanitization
  // -------------------------------------------------------------------------

  private sanitizeUrl(url: string | null, expectedPath: string): string | null {
    if (!url) {
      return null;
    }
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' || u.host !== NETLIFY_API_HOST) {
        return null;
      }
      if (u.pathname !== expectedPath) {
        return null;
      }
      return u.toString();
    } catch {
      return null;
    }
  }

  private resolveCursor(cursor: unknown): NetlifySyncCursor | undefined {
    if (!isNetlifySyncCursor(cursor)) {
      return undefined;
    }
    return { phase: cursor.phase, page: cursor.page };
  }

  // -------------------------------------------------------------------------
  // Sites: discovery + paginated fetch
  // -------------------------------------------------------------------------

  private buildInitialSitesUrl(): string {
    const u = new URL(`${NETLIFY_API_BASE}/sites`);
    u.searchParams.set('per_page', String(PAGE_SIZE));
    return u.toString();
  }

  private async fetchSitesPage(
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<FetchPageResult<string>> {
    const url =
      this.sanitizeUrl(page, '/api/v1/sites') ?? this.buildInitialSitesUrl();
    const res = await this.fetch<NetlifySite[]>(url, 'sites', signal);
    const rawNext = parseLinkHeader(res.headers.get('link'))['next'] ?? null;
    const next = this.sanitizeUrl(rawNext, '/api/v1/sites');
    return { items: res.body, next };
  }

  // -------------------------------------------------------------------------
  // Site ID resolution for the deploys phase. If the user supplied siteIds,
  // use those directly; otherwise discover sites from the sites endpoint.
  // -------------------------------------------------------------------------

  private async resolveSiteIds(
    signal: AbortSignal | undefined,
  ): Promise<string[]> {
    if (this.settings.siteIds && this.settings.siteIds.length > 0) {
      return [...new Set(this.settings.siteIds)];
    }
    if (this.discoveredSiteIds !== null) {
      return this.discoveredSiteIds;
    }
    const out = new Set<string>();
    let url: string | null = this.buildInitialSitesUrl();
    while (url !== null) {
      const res = await this.fetch<NetlifySite[]>(
        url,
        'sites_discovery',
        signal,
      );
      for (const site of res.body) {
        out.add(site.id);
      }
      const rawNext = parseLinkHeader(res.headers.get('link'))['next'] ?? null;
      url = this.sanitizeUrl(rawNext, '/api/v1/sites');
    }
    this.discoveredSiteIds = [...out];
    return this.discoveredSiteIds;
  }

  // -------------------------------------------------------------------------
  // Deploys: paginated per-site fetch
  // -------------------------------------------------------------------------

  private singleSpec(
    options: SyncOptions,
    resource: string,
  ): FetchSpec | undefined {
    const specs = options.fetchSpecs?.[resource];
    return specs && specs.length === 1 ? specs[0] : undefined;
  }

  private buildInitialDeploysUrl(siteId: string, options: SyncOptions): string {
    const u = new URL(`${NETLIFY_API_BASE}/sites/${siteId}/deploys`);
    u.searchParams.set('per_page', String(PAGE_SIZE));
    const state = pushableEq(
      this.singleSpec(options, 'netlify_deploy')?.filter,
      'state',
    );
    if (state !== null) {
      u.searchParams.set('state', state);
    }
    return u.toString();
  }

  private deployUpdatedMs(deploy: NetlifyDeploy): number {
    const ms = parseEpoch(
      deploy.published_at ?? deploy.updated_at ?? deploy.created_at,
      'iso',
    );
    if (ms !== null) {
      return ms;
    }
    return parseEpoch(deploy.created_at, 'iso') ?? 0;
  }

  private computeDeploysCutoffMs(options: SyncOptions): number | null {
    if (options.since) {
      const ms = parseEpoch(options.since, 'iso');
      if (ms !== null) {
        return ms;
      }
    }
    if (
      options.mode === 'full' &&
      this.settings.deploysLookbackDays !== undefined
    ) {
      return Date.now() - this.settings.deploysLookbackDays * MS_PER_DAY;
    }
    return null;
  }

  private async fetchDeploysPage(
    options: SyncOptions,
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<FetchPageResult<string>> {
    const siteIds = await this.resolveSiteIds(signal);
    if (siteIds.length === 0) {
      return { items: [], next: null };
    }
    const { idx, url: rawPageUrl } = decodeDeploysPage(page);
    if (idx >= siteIds.length) {
      return { items: [], next: null };
    }
    const siteId = siteIds[idx]!;
    const expectedPath = `/api/v1/sites/${siteId}/deploys`;
    const fetchUrl =
      this.sanitizeUrl(rawPageUrl, expectedPath) ??
      this.buildInitialDeploysUrl(siteId, options);
    const res = await this.fetch<NetlifyDeploy[]>(fetchUrl, 'deploys', signal);
    const rawNext = parseLinkHeader(res.headers.get('link'))['next'] ?? null;
    const safeNext = this.sanitizeUrl(rawNext, expectedPath);
    const rows = res.body;

    const cutoff = this.computeDeploysCutoffMs(options);
    let filtered: NetlifyDeploy[];
    let cutoffReached: boolean;
    if (cutoff !== null) {
      filtered = rows.filter((row) => this.deployUpdatedMs(row) >= cutoff);
      const last = rows.at(-1);
      cutoffReached = last !== undefined && this.deployUpdatedMs(last) < cutoff;
    } else {
      filtered = rows;
      cutoffReached = false;
    }

    const nextWithinSite = cutoffReached ? null : safeNext;
    const batch: SiteDeploysBatch = { siteId, items: filtered };
    if (nextWithinSite !== null) {
      return { items: [batch], next: encodeDeploysPage(idx, nextWithinSite) };
    }
    const nextIdx = idx + 1;
    const next =
      nextIdx < siteIds.length ? encodeDeploysPage(nextIdx, null) : null;
    return { items: [batch], next };
  }

  // -------------------------------------------------------------------------
  // Writers
  // -------------------------------------------------------------------------

  private async writeSites(
    storage: StorageHandle,
    items: unknown[],
  ): Promise<void> {
    const sites = items as NetlifySite[];
    const allowedSiteIds =
      this.settings.siteIds && this.settings.siteIds.length > 0
        ? new Set(this.settings.siteIds)
        : null;
    for (const s of sites) {
      if (allowedSiteIds && !allowedSiteIds.has(s.id)) {
        continue;
      }
      const createdMs = parseEpoch(s.created_at, 'iso');
      const updatedMs = parseEpoch(s.updated_at, 'iso');
      if (createdMs === null || updatedMs === null) {
        this.logger?.warn?.('skipping site with unparseable timestamps', {
          resource: 'sites',
          id: s.id,
        });
        continue;
      }
      await storage.entity({
        type: 'netlify_site',
        id: s.id,
        attributes: {
          name: s.name,
          url: s.url,
          adminUrl: s.admin_url ?? null,
          accountId: s.account_id ?? null,
          accountName: s.account_name ?? null,
          repoUrl: s.build_settings?.repo_url ?? null,
          repoBranch: s.build_settings?.repo_branch ?? null,
          publishedDeployId: s.published_deploy?.id ?? null,
          publishedDeployState: s.published_deploy?.state ?? null,
          createdAt: createdMs,
          updatedAt: updatedMs,
        },
        updated_at: updatedMs,
      });
    }
  }

  private async writeDeploysBatch(
    storage: StorageHandle,
    items: unknown[],
  ): Promise<void> {
    const writeEntities = this.isResourceEnabled('deploys');
    const writeEvents = this.isResourceEnabled('deploy_events');
    if (!writeEntities && !writeEvents) {
      return;
    }
    const batches = items as SiteDeploysBatch[];
    const eventsById = new Map<string, Event>();
    for (const batch of batches) {
      for (const d of batch.items) {
        const createdMs = parseEpoch(d.created_at, 'iso');
        if (createdMs === null) {
          this.logger?.warn?.(
            'skipping deploy with unparseable created timestamp',
            {
              resource: 'deploys',
              id: d.id,
            },
          );
          continue;
        }
        const updatedMs = parseEpoch(d.updated_at, 'iso');
        const publishedMs = parseEpoch(d.published_at, 'iso');
        const deployTimeMs =
          d.deploy_time !== null && d.deploy_time !== undefined
            ? Math.round(d.deploy_time * 1000)
            : null;
        const gitRef = d.commit_ref ?? d.branch ?? null;
        const baseAttributes: Record<string, JSONValue> = {
          deployId: d.id,
          siteId: batch.siteId,
          name: d.name ?? null,
          url: d.url ?? d.deploy_url ?? null,
          state: d.state,
          branch: d.branch ?? null,
          context: d.context ?? null,
          gitRef,
          commitUrl: d.commit_url ?? null,
          title: d.title ?? null,
          committer: d.committer ?? null,
          errorMessage: d.error_message ?? null,
          createdAt: createdMs,
          updatedAt: updatedMs,
          publishedAt: publishedMs,
          deployTimeMs,
        };

        if (writeEntities) {
          await storage.entity({
            type: 'netlify_deploy',
            id: d.id,
            attributes: baseAttributes,
            updated_at: publishedMs ?? updatedMs ?? createdMs,
          });
        }
        if (writeEvents) {
          eventsById.set(`${batch.siteId}:${d.id}`, {
            name: 'netlify_deploy_event',
            start_ts: createdMs,
            end_ts: publishedMs,
            attributes: baseAttributes,
          });
        }
      }
    }
    for (const event of eventsById.values()) {
      await storage.event(event);
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
    this.discoveredSiteIds = null;
    const cursor = this.resolveCursor(options.cursor);
    const isFull = options.mode === 'full';
    const phases = this.activePhases();

    return paginateChunked<NetlifyPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'sites':
            return this.fetchSitesPage(page, sig);
          case 'deploys':
            return this.fetchDeploysPage(options, page, sig);
        }
      },
      writeBatch: async (phase, items, page) => {
        if (isFull && page === null) {
          switch (phase) {
            case 'sites':
              if (this.isResourceEnabled('sites')) {
                await storage.entities([], { types: ['netlify_site'] });
              }
              break;
            case 'deploys':
              if (this.isResourceEnabled('deploys')) {
                await storage.entities([], { types: ['netlify_deploy'] });
              }
              if (this.isResourceEnabled('deploy_events')) {
                await storage.events([], { names: ['netlify_deploy_event'] });
              }
              break;
          }
        }
        switch (phase) {
          case 'sites':
            if (!this.isResourceEnabled('sites')) {
              return;
            }
            return this.writeSites(storage, items);
          case 'deploys':
            return this.writeDeploysBatch(storage, items);
        }
      },
    });
  }
}
