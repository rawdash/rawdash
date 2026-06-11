import {
  type HttpResponse,
  connectorUserAgent,
  standardRateLimitPolicy,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
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
    apiKey: z.object({ $secret: z.string() }).meta({
      label: 'API Key',
      description:
        'Linear Personal API Key. Create one at Linear → Settings → API → Personal API keys.',
      placeholder: 'lin_api_...',
      secret: true,
    }),
    teamIds: z.array(z.string().min(1)).nonempty().optional().meta({
      label: 'Team IDs (optional)',
      description:
        'Restrict the sync to specific Linear team IDs. Omit to sync all teams the API key can see.',
    }),
    resources: z
      .array(z.enum(['teams', 'users', 'cycles', 'issues']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          "Which Linear resources to sync. Omit to sync all resources. The `issues` phase also emits state-transition events derived from each issue's history.",
      }),
    historyPerIssue: z.number().int().positive().max(50).optional().meta({
      label: 'History entries per issue',
      description:
        'How many history entries to pull per issue (newest first). State transitions inside this window become events. Defaults to 8. Higher values pull deeper history but lower the effective issues-per-page, since Linear scores the combined query complexity.',
      placeholder: '8',
    }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Linear',
  category: 'product',
  brandColor: '#5E6AD2',
  tagline:
    'Sync teams, members, cycles, issues, and issue state-transition events from a Linear workspace.',
  vendor: {
    name: 'Linear',
    domain: 'linear.app',
    apiDocs: 'https://developers.linear.app/docs',
    website: 'https://linear.app',
  },
  auth: {
    summary:
      'A Linear Personal API Key is required. It authenticates all GraphQL requests and scopes the sync to the workspaces and teams the key can access.',
    setup: [
      'Open Linear → Settings → API → Personal API keys.',
      'Create a new personal API key.',
      'Store it as a secret and reference it from the connector config as `apiKey: secret("LINEAR_API_KEY")`.',
    ],
  },
  rateLimit:
    'Linear returns X-RateLimit-Requests-Remaining / X-RateLimit-Requests-Reset headers (reset in ms); flat resources are paged 250 at a time, issues up to 150 (capped by GraphQL query complexity against the nested history depth).',
  limitations: [
    'API key auth only (OAuth not yet supported).',
    'Webhooks and roadmap/initiative resources are out of scope.',
  ],
});

export interface LinearSettings {
  teamIds?: readonly string[];
  resources?: readonly LinearResource[];
  historyPerIssue?: number;
}

const linearCredentials = {
  apiKey: {
    description: 'Linear Personal API Key',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type LinearCredentials = typeof linearCredentials;

const linearRateLimit = standardRateLimitPolicy({
  remainingHeader: 'x-ratelimit-requests-remaining',
  resetHeader: 'x-ratelimit-requests-reset',
  resetUnit: 'ms',
  resetFallbackMs: 60_000,
});

const PHASE_ORDER = ['teams', 'users', 'cycles', 'issues'] as const;

type LinearPhase = (typeof PHASE_ORDER)[number];

export type LinearResource = LinearPhase;

const isLinearSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface Connection<T> {
  nodes: T[];
  pageInfo: PageInfo;
}

interface LinearTeam {
  id: string;
  name: string;
  key: string;
  createdAt: string;
  updatedAt: string;
}

interface LinearUser {
  id: string;
  name: string;
  email: string | null;
  displayName: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface LinearCycle {
  id: string;
  number: number;
  name: string | null;
  startsAt: string;
  endsAt: string;
  completedAt: string | null;
  progress: number | null;
  scopeHistory: number[] | null;
  completedScopeHistory: number[] | null;
  team: { id: string } | null;
  createdAt: string;
  updatedAt: string;
}

interface LinearIssueHistory {
  id: string;
  createdAt: string;
  actor: { id: string } | null;
  fromState: { id: string; name: string } | null;
  toState: { id: string; name: string } | null;
  fromAssignee: { id: string } | null;
  toAssignee: { id: string } | null;
}

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  estimate: number | null;
  state: { id: string; name: string; type: string } | null;
  assignee: { id: string } | null;
  team: { id: string } | null;
  project: { id: string } | null;
  cycle: { id: string } | null;
  labels: { nodes: Array<{ id: string; name: string }> };
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  canceledAt: string | null;
  startedAt: string | null;
  history: Connection<LinearIssueHistory>;
}

interface GraphQLError {
  message: string;
  extensions?: { code?: string; type?: string };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

const TEAMS_QUERY = `
  query Teams($after: String, $first: Int!, $filter: TeamFilter) {
    teams(after: $after, first: $first, filter: $filter, orderBy: updatedAt) {
      nodes { id name key createdAt updatedAt }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const USERS_QUERY = `
  query Users($after: String, $first: Int!, $filter: UserFilter) {
    users(after: $after, first: $first, filter: $filter, orderBy: updatedAt) {
      nodes { id name email displayName active createdAt updatedAt }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const CYCLES_QUERY = `
  query Cycles($after: String, $first: Int!, $filter: CycleFilter) {
    cycles(after: $after, first: $first, filter: $filter, orderBy: updatedAt) {
      nodes {
        id number name startsAt endsAt completedAt progress
        scopeHistory completedScopeHistory
        team { id }
        createdAt updatedAt
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const ISSUES_QUERY = `
  query Issues(
    $after: String
    $first: Int!
    $filter: IssueFilter
    $historyFirst: Int!
  ) {
    issues(after: $after, first: $first, filter: $filter, orderBy: updatedAt) {
      nodes {
        id identifier title priority estimate
        state { id name type }
        assignee { id }
        team { id }
        project { id }
        cycle { id }
        labels { nodes { id name } }
        createdAt updatedAt completedAt canceledAt startedAt
        history(first: $historyFirst) {
          nodes {
            id createdAt
            actor { id }
            fromState { id name }
            toState { id name }
            fromAssignee { id }
            toAssignee { id }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const MAX_PAGE_SIZE = 250;
const DEFAULT_LIST_PAGE_SIZE = 250;
const DEFAULT_ISSUE_PAGE_SIZE = 150;
const DEFAULT_HISTORY_PER_ISSUE = 8;
const ISSUE_COMPLEXITY_BUDGET = 1500;
const CHUNK_BUDGET_MS = 25_000;
const ENDPOINT = 'https://api.linear.app/graphql';

function clampPageSize(
  requested: number | undefined,
  fallback: number,
): number {
  const n = requested ?? fallback;
  if (!Number.isFinite(n) || n < 1) {
    return 1;
  }
  return Math.min(Math.floor(n), MAX_PAGE_SIZE);
}

function issuePageSize(
  requested: number | undefined,
  historyFirst: number,
): number {
  const base = clampPageSize(requested, DEFAULT_ISSUE_PAGE_SIZE);
  const complexityCap = Math.max(
    1,
    Math.floor(ISSUE_COMPLEXITY_BUDGET / Math.max(1, historyFirst)),
  );
  return Math.min(base, complexityCap);
}

const idString = z.string().min(1);

const teamSchema = z.object({
  id: idString,
  name: z.string(),
  key: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const userSchema = z.object({
  id: idString,
  name: z.string(),
  email: z.string().nullable(),
  displayName: z.string(),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const cycleSchema = z.object({
  id: idString,
  number: z.number().int(),
  name: z.string().nullable(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  progress: z.number().nullable(),
  scopeHistory: z.array(z.number()).nullable(),
  completedScopeHistory: z.array(z.number()).nullable(),
  team: z.object({ id: idString }).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const issueSchema = z.object({
  id: idString,
  identifier: z.string(),
  title: z.string(),
  priority: z.number().int(),
  estimate: z.number().nullable(),
  state: z
    .object({ id: idString, name: z.string(), type: z.string() })
    .nullable(),
  assignee: z.object({ id: idString }).nullable(),
  team: z.object({ id: idString }).nullable(),
  project: z.object({ id: idString }).nullable(),
  cycle: z.object({ id: idString }).nullable(),
  labels: z.object({
    nodes: z.array(z.object({ id: idString, name: z.string() })),
  }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  canceledAt: z.iso.datetime().nullable(),
  startedAt: z.iso.datetime().nullable(),
  history: z.object({
    nodes: z.array(
      z.object({
        id: idString,
        createdAt: z.iso.datetime(),
        actor: z.object({ id: idString }).nullable(),
        fromState: z.object({ id: idString, name: z.string() }).nullable(),
        toState: z.object({ id: idString, name: z.string() }).nullable(),
        fromAssignee: z.object({ id: idString }).nullable(),
        toAssignee: z.object({ id: idString }).nullable(),
      }),
    ),
    pageInfo: z.object({
      hasNextPage: z.boolean(),
      endCursor: z.string().nullable(),
    }),
  }),
});

export const linearResources = defineResources({
  linear_team: {
    shape: 'entity',
    filterable: [],
    description: 'Workspace teams with their name and key.',
    endpoint: 'GraphQL query: teams { nodes { ... } }',
    responses: { teams: z.array(teamSchema) },
  },
  linear_user: {
    shape: 'entity',
    filterable: [],
    description:
      'Workspace members, including name, email, display name, and active state.',
    endpoint: 'GraphQL query: users { nodes { ... } }',
    responses: { users: z.array(userSchema) },
  },
  linear_cycle: {
    shape: 'entity',
    filterable: [],
    description:
      'Team cycles with their number, dates, progress, and final scope / completed-scope figures.',
    endpoint: 'GraphQL query: cycles { nodes { ... } }',
    responses: { cycles: z.array(cycleSchema) },
  },
  linear_issue: {
    shape: 'entity',
    filterable: [],
    description:
      'Issues with their state, priority, assignee, team, project, cycle, labels, estimate, and lifecycle timestamps.',
    endpoint: 'GraphQL query: issues { nodes { ... } }',
    responses: { issues: z.array(issueSchema) },
  },
  linear_issue_state_change: {
    shape: 'event',
    filterable: [],
    description:
      'State-transition events derived from each issue’s history (from-state to to-state), keyed by the originating actor.',
    endpoint: 'GraphQL query: issues { nodes { history { nodes { ... } } } }',
    notes:
      'Only history entries with a non-null fromState and toState (where they differ) become events; these append-only events accumulate across incremental syncs.',
  },
});

export const id = 'linear';

export class LinearConnector extends BaseConnector<
  LinearSettings,
  LinearCredentials
> {
  static readonly id = id;

  static readonly resources = linearResources;

  static readonly schemas = schemasFromResources(linearResources);

  static create(input: unknown, ctx?: ConnectorContext): LinearConnector {
    const parsed = configFields.parse(input);
    return new LinearConnector(
      {
        teamIds: parsed.teamIds,
        resources: parsed.resources,
        historyPerIssue: parsed.historyPerIssue,
      },
      { apiKey: parsed.apiKey },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = linearCredentials;

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: this.creds.apiKey,
      'Content-Type': 'application/json',
      'User-Agent': connectorUserAgent('linear'),
    };
  }

  private async graphql<T>(
    query: string,
    variables: Record<string, unknown>,
    resource: string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<GraphQLResponse<T>>> {
    const res = await this.post<GraphQLResponse<T>>(ENDPOINT, {
      resource,
      headers: this.buildHeaders(),
      body: JSON.stringify({ query, variables }),
      signal,
      rateLimit: linearRateLimit,
    });
    if (res.body.errors && res.body.errors.length > 0) {
      const messages = res.body.errors.map((e) => e.message).join('; ');
      throw new Error(`Linear GraphQL error: ${messages}`);
    }
    if (!res.body.data) {
      throw new Error(
        `Linear GraphQL response missing data for resource '${resource}'`,
      );
    }
    return res;
  }

  private sinceFilter(
    options: SyncOptions,
  ): Record<string, unknown> | undefined {
    if (!options.since) {
      return undefined;
    }
    if (options.mode === 'latest') {
      return { updatedAt: { gt: options.since } };
    }
    return undefined;
  }

  private issueSinceFilter(
    options: SyncOptions,
  ): Record<string, unknown> | undefined {
    if (!options.since) {
      return undefined;
    }
    return { updatedAt: { gt: options.since } };
  }

  private teamFilter(): Record<string, unknown> | undefined {
    const ids = this.settings.teamIds;
    if (!ids || ids.length === 0) {
      return undefined;
    }
    return { id: { in: [...ids] } };
  }

  private issueTeamFilter(): Record<string, unknown> | undefined {
    const ids = this.settings.teamIds;
    if (!ids || ids.length === 0) {
      return undefined;
    }
    return { team: { id: { in: [...ids] } } };
  }

  private mergeFilters(
    ...filters: Array<Record<string, unknown> | undefined>
  ): Record<string, unknown> | undefined {
    const merged: Record<string, unknown> = {};
    let any = false;
    for (const f of filters) {
      if (f) {
        Object.assign(merged, f);
        any = true;
      }
    }
    return any ? merged : undefined;
  }

  private async fetchTeamsPage(
    page: string | null,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<{ items: LinearTeam[]; next: string | null }> {
    const filter = this.mergeFilters(
      this.teamFilter(),
      this.sinceFilter(options),
    );
    const res = await this.graphql<{ teams: Connection<LinearTeam> }>(
      TEAMS_QUERY,
      {
        after: page ?? null,
        first: clampPageSize(options.pageSize, DEFAULT_LIST_PAGE_SIZE),
        filter,
      },
      'teams',
      signal,
    );
    const conn = res.body.data!.teams;
    return {
      items: conn.nodes,
      next: conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null,
    };
  }

  private async fetchUsersPage(
    page: string | null,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<{ items: LinearUser[]; next: string | null }> {
    const res = await this.graphql<{ users: Connection<LinearUser> }>(
      USERS_QUERY,
      {
        after: page ?? null,
        first: clampPageSize(options.pageSize, DEFAULT_LIST_PAGE_SIZE),
        filter: this.sinceFilter(options),
      },
      'users',
      signal,
    );
    const conn = res.body.data!.users;
    return {
      items: conn.nodes,
      next: conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null,
    };
  }

  private async fetchCyclesPage(
    page: string | null,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<{ items: LinearCycle[]; next: string | null }> {
    const teamIds = this.settings.teamIds;
    const teamFilter =
      teamIds && teamIds.length > 0
        ? { team: { id: { in: [...teamIds] } } }
        : undefined;
    const filter = this.mergeFilters(teamFilter, this.sinceFilter(options));
    const res = await this.graphql<{ cycles: Connection<LinearCycle> }>(
      CYCLES_QUERY,
      {
        after: page ?? null,
        first: clampPageSize(options.pageSize, DEFAULT_LIST_PAGE_SIZE),
        filter,
      },
      'cycles',
      signal,
    );
    const conn = res.body.data!.cycles;
    return {
      items: conn.nodes,
      next: conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null,
    };
  }

  private async fetchIssuesPage(
    page: string | null,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<{ items: LinearIssue[]; next: string | null }> {
    const filter = this.mergeFilters(
      this.issueTeamFilter(),
      this.issueSinceFilter(options),
    );
    const historyFirst =
      this.settings.historyPerIssue ?? DEFAULT_HISTORY_PER_ISSUE;
    const res = await this.graphql<{ issues: Connection<LinearIssue> }>(
      ISSUES_QUERY,
      {
        after: page ?? null,
        first: issuePageSize(options.pageSize, historyFirst),
        filter,
        historyFirst,
      },
      'issues',
      signal,
    );
    const conn = res.body.data!.issues;
    return {
      items: conn.nodes,
      next: conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null,
    };
  }

  private async writeTeams(
    storage: StorageHandle,
    teams: LinearTeam[],
  ): Promise<void> {
    for (const t of teams) {
      await storage.entity({
        type: 'linear_team',
        id: t.id,
        attributes: {
          name: t.name,
          key: t.key,
          createdAt: new Date(t.createdAt).getTime(),
        },
        updated_at: new Date(t.updatedAt).getTime(),
      });
    }
  }

  private async writeUsers(
    storage: StorageHandle,
    users: LinearUser[],
  ): Promise<void> {
    for (const u of users) {
      await storage.entity({
        type: 'linear_user',
        id: u.id,
        attributes: {
          name: u.name,
          email: u.email,
          displayName: u.displayName,
          active: u.active,
          createdAt: new Date(u.createdAt).getTime(),
        },
        updated_at: new Date(u.updatedAt).getTime(),
      });
    }
  }

  private async writeCycles(
    storage: StorageHandle,
    cycles: LinearCycle[],
  ): Promise<void> {
    for (const c of cycles) {
      const startsMs = new Date(c.startsAt).getTime();
      const endsMs = new Date(c.endsAt).getTime();
      const scopeFinal =
        c.scopeHistory && c.scopeHistory.length > 0
          ? (c.scopeHistory.at(-1) ?? null)
          : null;
      const completedFinal =
        c.completedScopeHistory && c.completedScopeHistory.length > 0
          ? (c.completedScopeHistory.at(-1) ?? null)
          : null;
      await storage.entity({
        type: 'linear_cycle',
        id: c.id,
        attributes: {
          number: c.number,
          name: c.name,
          teamId: c.team?.id ?? null,
          startsAt: startsMs,
          endsAt: endsMs,
          completedAt: c.completedAt ? new Date(c.completedAt).getTime() : null,
          progress: c.progress,
          scope: scopeFinal,
          completedScope: completedFinal,
        },
        updated_at: new Date(c.updatedAt).getTime(),
      });
    }
  }

  private async writeIssues(
    storage: StorageHandle,
    issues: LinearIssue[],
    historySinceMs: number | null,
  ): Promise<void> {
    for (const i of issues) {
      await storage.entity({
        type: 'linear_issue',
        id: i.id,
        attributes: {
          identifier: i.identifier,
          title: i.title,
          stateId: i.state?.id ?? null,
          stateName: i.state?.name ?? null,
          stateType: i.state?.type ?? null,
          priority: i.priority,
          assigneeId: i.assignee?.id ?? null,
          teamId: i.team?.id ?? null,
          projectId: i.project?.id ?? null,
          cycleId: i.cycle?.id ?? null,
          labels: i.labels.nodes.map((l) => l.name),
          estimate: i.estimate,
          createdAt: new Date(i.createdAt).getTime(),
          completedAt: i.completedAt ? new Date(i.completedAt).getTime() : null,
          canceledAt: i.canceledAt ? new Date(i.canceledAt).getTime() : null,
          startedAt: i.startedAt ? new Date(i.startedAt).getTime() : null,
        },
        updated_at: new Date(i.updatedAt).getTime(),
      });

      for (const h of i.history.nodes) {
        if (!h.toState || !h.fromState) {
          continue;
        }
        if (h.toState.id === h.fromState.id) {
          continue;
        }
        const eventTs = new Date(h.createdAt).getTime();
        if (historySinceMs !== null && eventTs <= historySinceMs) {
          continue;
        }
        await storage.event({
          name: 'linear_issue_state_change',
          start_ts: eventTs,
          end_ts: null,
          attributes: {
            historyId: h.id,
            issueId: i.id,
            issueIdentifier: i.identifier,
            teamId: i.team?.id ?? null,
            actorId: h.actor?.id ?? null,
            fromStateId: h.fromState.id,
            fromStateName: h.fromState.name,
            toStateId: h.toState.id,
            toStateName: h.toState.name,
          },
        });
      }
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = isLinearSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';
    const historySinceMs = options.since
      ? new Date(options.since).getTime()
      : null;

    const phases = selectActivePhases<LinearResource, LinearPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<LinearPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      pipeline: true,
      maxChunkMs: CHUNK_BUDGET_MS,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'teams':
            return this.fetchTeamsPage(page, options, sig);
          case 'users':
            return this.fetchUsersPage(page, options, sig);
          case 'cycles':
            return this.fetchCyclesPage(page, options, sig);
          case 'issues':
            return this.fetchIssuesPage(page, options, sig);
        }
      },
      writeBatch: async (phase, items, page) => {
        if (isFull && page === null) {
          switch (phase) {
            case 'teams':
              await storage.entities([], { types: ['linear_team'] });
              break;
            case 'users':
              await storage.entities([], { types: ['linear_user'] });
              break;
            case 'cycles':
              await storage.entities([], { types: ['linear_cycle'] });
              break;
            case 'issues':
              await storage.entities([], { types: ['linear_issue'] });
              await storage.events([], {
                names: ['linear_issue_state_change'],
              });
              break;
          }
        }
        switch (phase) {
          case 'teams':
            return this.writeTeams(storage, items as LinearTeam[]);
          case 'users':
            return this.writeUsers(storage, items as LinearUser[]);
          case 'cycles':
            return this.writeCycles(storage, items as LinearCycle[]);
          case 'issues':
            return this.writeIssues(
              storage,
              items as LinearIssue[],
              historySinceMs,
            );
        }
      },
    });
  }
}
