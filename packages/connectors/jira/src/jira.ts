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

// ---------------------------------------------------------------------------
// configFields
// ---------------------------------------------------------------------------

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
      label: 'Project keys (optional)',
      description:
        'Restrict the sync to specific Jira project keys (e.g. ENG, OPS). Omit to sync every project the account can see.',
    }),
    resources: z
      .array(z.enum(['projects', 'users', 'sprints', 'issues', 'issue_events']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          "Which Jira resources to sync. Omit to sync all of them. 'issue_events' shares the issues query - enabling it without 'issues' still fetches issues (with changelog) but skips writing issue entities.",
      }),
    storyPointsField: z.string().min(1).optional().meta({
      label: 'Story points field ID',
      description:
        'Custom field ID holding story points (varies per site). Defaults to customfield_10016.',
      placeholder: 'customfield_10016',
    }),
    sprintField: z.string().min(1).optional().meta({
      label: 'Sprint field ID',
      description:
        'Custom field ID holding the sprint association on issues. Defaults to customfield_10020.',
      placeholder: 'customfield_10020',
    }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Jira',
  category: 'product',
  brandColor: '#0052CC',
  tagline:
    'Sync projects, users, sprints, issues, and issue status-change events from a Jira Cloud site.',
  vendor: {
    name: 'Atlassian',
    apiDocs: 'https://developer.atlassian.com/cloud/jira/platform/rest/v3/',
    website: 'https://www.atlassian.com/software/jira',
  },
  auth: {
    summary:
      'Authenticates over HTTP Basic auth using your Atlassian account email and an API token. The token must belong to an account with access to the projects you want to sync.',
    setup: [
      'Open id.atlassian.com -> Security -> Create and manage API tokens.',
      'Create an API token and copy its value.',
      'Store the token as a secret and reference it from the connector config as `apiToken: secret("JIRA_API_TOKEN")`, alongside your account email and site host (e.g. yourorg.atlassian.net).',
      'Story points and the sprint association live on custom fields whose IDs differ per Jira site. Discover them at `https://{host}/rest/api/3/field` and set storyPointsField / sprintField to match.',
    ],
  },
  rateLimit:
    'Jira Cloud uses cost-based rate limiting; 429 responses with Retry-After are honored.',
  limitations: [
    'Sprints are only synced from scrum boards; kanban boards are skipped.',
    'Issue status-change events are derived from each issue changelog; only `status` field transitions are written.',
    'Targets Jira Cloud REST API v3 and the Agile API; Jira Data Center / Server are out of scope.',
  ],
});

export type JiraResource =
  | 'projects'
  | 'users'
  | 'sprints'
  | 'issues'
  | 'issue_events';

export interface JiraSettings {
  host: string;
  projectKeys?: readonly string[];
  resources?: readonly JiraResource[];
  storyPointsField?: string;
  sprintField?: string;
}

const jiraCredentials = {
  email: {
    description: 'Atlassian account email',
    auth: 'required' as const,
  },
  apiToken: {
    description: 'Atlassian API token',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type JiraCredentials = typeof jiraCredentials;

// ---------------------------------------------------------------------------
// Sync phases + cursor
// ---------------------------------------------------------------------------

const PHASE_ORDER = ['projects', 'users', 'sprints', 'issues'] as const;

type JiraPhase = (typeof PHASE_ORDER)[number];

const isJiraSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

// ---------------------------------------------------------------------------
// Jira API types
// ---------------------------------------------------------------------------

interface JiraAccountRef {
  accountId: string;
  displayName?: string | null;
}

interface JiraStatusCategory {
  key: string;
  name?: string | null;
}

interface JiraStatus {
  name: string;
  statusCategory?: JiraStatusCategory | null;
}

interface JiraNamed {
  name: string;
}

interface JiraProjectRef {
  id: string;
  key: string;
}

interface JiraIssueFields {
  summary?: string | null;
  status?: JiraStatus | null;
  priority?: JiraNamed | null;
  issuetype?: JiraNamed | null;
  assignee?: JiraAccountRef | null;
  reporter?: JiraAccountRef | null;
  project?: JiraProjectRef | null;
  created: string;
  updated: string;
  resolutiondate?: string | null;
  [key: string]: unknown;
}

interface JiraChangelogItem {
  field: string;
  fromString?: string | null;
  toString?: string | null;
}

interface JiraChangelogHistory {
  id: string;
  created: string;
  author?: JiraAccountRef | null;
  items: JiraChangelogItem[];
}

interface JiraIssue {
  id: string;
  key: string;
  fields: JiraIssueFields;
  changelog?: { histories: JiraChangelogHistory[] } | null;
}

interface JiraSearchResponse {
  issues: JiraIssue[];
  nextPageToken?: string | null;
  isLast?: boolean;
}

interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey?: string | null;
  lead?: JiraAccountRef | null;
}

interface JiraProjectPage {
  values: JiraProject[];
  isLast: boolean;
  startAt: number;
  maxResults: number;
  total: number;
}

interface JiraUser {
  accountId: string;
  displayName?: string | null;
  emailAddress?: string | null;
  accountType?: string | null;
  active?: boolean | null;
}

interface JiraSprint {
  id: number;
  name: string;
  state: 'active' | 'closed' | 'future';
  startDate?: string | null;
  endDate?: string | null;
  completeDate?: string | null;
  originBoardId?: number | null;
}

interface JiraSprintWithBoard extends JiraSprint {
  boardId: number;
}

interface JiraBoard {
  id: number;
  name: string;
  type: string;
}

interface JiraAgilePage<T> {
  values: T[];
  isLast?: boolean;
  startAt: number;
  maxResults: number;
}

// ---------------------------------------------------------------------------
// Schemas — describe the per-resource API response shape consumed by request()
// ---------------------------------------------------------------------------

const idString = z.string().min(1);
const nonNegInt = z.number().int().nonnegative();

const accountRefSchema = z.object({
  accountId: idString,
  displayName: z.string().nullable().optional(),
});

const projectSchema = z.object({
  id: idString,
  key: z.string().min(1),
  name: z.string(),
  projectTypeKey: z.string().nullable().optional(),
  lead: accountRefSchema.nullable().optional(),
});

const projectsResponseSchema = z.object({
  values: z.array(projectSchema),
  isLast: z.boolean(),
  startAt: nonNegInt,
  maxResults: nonNegInt,
  total: nonNegInt,
});

const usersResponseSchema = z.array(
  z.object({
    accountId: idString,
    displayName: z.string().nullable().optional(),
    emailAddress: z.string().nullable().optional(),
    accountType: z.string().nullable().optional(),
    active: z.boolean().nullable().optional(),
  }),
);

const sprintsResponseSchema = z.array(
  z.object({
    id: nonNegInt,
    name: z.string(),
    state: z.enum(['active', 'closed', 'future']),
    startDate: z.iso.datetime().nullable().optional(),
    endDate: z.iso.datetime().nullable().optional(),
    completeDate: z.iso.datetime().nullable().optional(),
    originBoardId: nonNegInt.nullable().optional(),
  }),
);

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
    project: z.object({ id: idString, key: z.string().min(1) }).nullable(),
    created: z.iso.datetime(),
    updated: z.iso.datetime(),
    resolutiondate: z.iso.datetime().nullable().optional(),
    customfield_10016: z.number().nullable().optional(),
    customfield_10020: z
      .array(z.object({ id: nonNegInt, name: z.string() }))
      .nullable()
      .optional(),
  }),
  changelog: z.object({ histories: z.array(changelogHistorySchema) }),
});

const issuesResponseSchema = z.object({
  issues: z.array(issueSchema),
  nextPageToken: z.string().nullable().optional(),
  isLast: z.boolean().optional(),
});

export const jiraResources = defineResources({
  jira_project: {
    shape: 'entity',
    description:
      'Jira projects with key, name, type, and project lead. Restrict via projectKeys to limit the sync.',
    endpoint: 'GET /rest/api/3/project/search',
    responses: { projects: projectsResponseSchema },
  },
  jira_user: {
    shape: 'entity',
    description:
      'Atlassian accounts visible to the connector, including display name, email, account type, and active state.',
    endpoint: 'GET /rest/api/3/users/search',
    responses: { users: usersResponseSchema },
  },
  jira_sprint: {
    shape: 'entity',
    description:
      'Sprints from scrum boards with state, start/end/complete dates, and owning board.',
    endpoint: 'GET /rest/agile/1.0/board/{boardId}/sprint',
    responses: { sprints: sprintsResponseSchema },
  },
  jira_issue: {
    shape: 'entity',
    description:
      'Issues with status, priority, type, assignee, reporter, project, sprint, story points, and resolution date.',
    endpoint: 'GET /rest/api/3/search/jql',
    notes:
      "sprintId is taken from the most recent sprint on the issue's sprint custom field.",
    responses: { issues: issuesResponseSchema },
  },
  jira_issue_status_change: {
    shape: 'event',
    description:
      'Status transition events derived from issue changelogs, capturing the from/to status, author, and project.',
    endpoint: 'GET /rest/api/3/search/jql (expand=changelog)',
    notes:
      'start_ts is the changelog entry time, end_ts is null. Timestamps are Unix epoch milliseconds.',
  },
});

// ---------------------------------------------------------------------------
// JiraConnector
// ---------------------------------------------------------------------------

const PROJECTS_PAGE_SIZE = 50;
const USERS_PAGE_SIZE = 50;
const BOARDS_PAGE_SIZE = 50;
const SPRINTS_PAGE_SIZE = 50;
const ISSUES_PAGE_SIZE = 100;
const DEFAULT_STORY_POINTS_FIELD = 'customfield_10016';
const DEFAULT_SPRINT_FIELD = 'customfield_10020';

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

function parseOffset(page: string | null): number {
  if (page === null) {
    return 0;
  }
  const n = Number.parseInt(page, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function extractSprintId(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const last = value[value.length - 1];
  if (last !== null && typeof last === 'object' && 'id' in last) {
    const id = (last as { id: unknown }).id;
    return id === null || id === undefined ? null : String(id);
  }
  if (typeof last === 'number' || typeof last === 'string') {
    return String(last);
  }
  return null;
}

function formatJqlDate(iso: string): string | null {
  const ms = parseEpoch(iso, 'iso');
  if (ms === null) {
    return null;
  }
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
}

export const id = 'jira';

export class JiraConnector extends BaseConnector<
  JiraSettings,
  JiraCredentials
> {
  static readonly id = id;

  static readonly resources = jiraResources;

  static readonly schemas = schemasFromResources(jiraResources);

  static create(input: unknown, ctx?: ConnectorContext): JiraConnector {
    const parsed = configFields.parse(input);
    return new JiraConnector(
      {
        host: parsed.host,
        projectKeys: parsed.projectKeys,
        resources: parsed.resources,
        storyPointsField: parsed.storyPointsField,
        sprintField: parsed.sprintField,
      },
      { email: parsed.email, apiToken: parsed.apiToken },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = jiraCredentials;

  private get baseUrl(): string {
    const host = this.settings.host
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');
    return `https://${host}`;
  }

  private get storyPointsField(): string {
    return this.settings.storyPointsField ?? DEFAULT_STORY_POINTS_FIELD;
  }

  private get sprintField(): string {
    return this.settings.sprintField ?? DEFAULT_SPRINT_FIELD;
  }

  private buildHeaders(): Record<string, string> {
    const basic = btoa(`${this.creds.email}:${this.creds.apiToken}`);
    return {
      Authorization: `Basic ${basic}`,
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('jira'),
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

  private activePhases(): JiraPhase[] {
    return selectActivePhases<JiraResource, JiraPhase>(
      (r) => {
        switch (r) {
          case 'projects':
            return 'projects';
          case 'users':
            return 'users';
          case 'sprints':
            return 'sprints';
          case 'issues':
          case 'issue_events':
            return 'issues';
        }
      },
      PHASE_ORDER,
      this.settings.resources,
    );
  }

  // -------------------------------------------------------------------------
  // JQL
  // -------------------------------------------------------------------------

  private buildJql(options: SyncOptions): string {
    const clauses: string[] = [];
    const keys = this.settings.projectKeys;
    if (keys && keys.length > 0) {
      const quoted = keys.map(
        (k) => `"${k.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
      );
      clauses.push(`project in (${quoted.join(',')})`);
    }
    if (options.mode === 'latest' && options.since) {
      const formatted = formatJqlDate(options.since);
      if (formatted !== null) {
        clauses.push(`updated >= "${formatted}"`);
      }
    }
    const where = clauses.join(' AND ');
    return where.length > 0
      ? `${where} ORDER BY updated ASC`
      : 'ORDER BY updated ASC';
  }

  // -------------------------------------------------------------------------
  // Fetchers
  // -------------------------------------------------------------------------

  private async fetchProjectsPage(
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<{ items: JiraProject[]; next: string | null }> {
    const startAt = parseOffset(page);
    const u = new URL(`${this.baseUrl}/rest/api/3/project/search`);
    u.searchParams.set('startAt', String(startAt));
    u.searchParams.set('maxResults', String(PROJECTS_PAGE_SIZE));
    u.searchParams.set('expand', 'lead');
    const res = await this.fetch<JiraProjectPage>(
      u.toString(),
      'projects',
      signal,
    );
    const values = res.body.values;
    const next =
      res.body.isLast || values.length === 0
        ? null
        : String(startAt + values.length);
    return { items: values, next };
  }

  private async fetchUsersPage(
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<{ items: JiraUser[]; next: string | null }> {
    const startAt = parseOffset(page);
    const u = new URL(`${this.baseUrl}/rest/api/3/users/search`);
    u.searchParams.set('startAt', String(startAt));
    u.searchParams.set('maxResults', String(USERS_PAGE_SIZE));
    const res = await this.fetch<JiraUser[]>(u.toString(), 'users', signal);
    const users = res.body;
    const next =
      users.length < USERS_PAGE_SIZE ? null : String(startAt + users.length);
    return { items: users, next };
  }

  private async fetchBoardsPage(
    startAt: number,
    signal: AbortSignal | undefined,
  ): Promise<JiraAgilePage<JiraBoard>> {
    const u = new URL(`${this.baseUrl}/rest/agile/1.0/board`);
    u.searchParams.set('startAt', String(startAt));
    u.searchParams.set('maxResults', String(BOARDS_PAGE_SIZE));
    const res = await this.fetch<JiraAgilePage<JiraBoard>>(
      u.toString(),
      'sprints',
      signal,
    );
    return res.body;
  }

  private async fetchSprintsForBoard(
    boardId: number,
    signal: AbortSignal | undefined,
  ): Promise<JiraSprint[]> {
    const out: JiraSprint[] = [];
    let startAt = 0;
    while (true) {
      signal?.throwIfAborted();
      const u = new URL(
        `${this.baseUrl}/rest/agile/1.0/board/${boardId}/sprint`,
      );
      u.searchParams.set('startAt', String(startAt));
      u.searchParams.set('maxResults', String(SPRINTS_PAGE_SIZE));
      const res = await this.fetch<JiraAgilePage<JiraSprint>>(
        u.toString(),
        'sprints',
        signal,
      );
      const values = res.body.values;
      out.push(...values);
      const isLast = res.body.isLast ?? values.length < SPRINTS_PAGE_SIZE;
      if (isLast || values.length === 0) {
        break;
      }
      startAt += values.length;
    }
    return out;
  }

  private async fetchSprintsPage(
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<{ items: JiraSprintWithBoard[]; next: string | null }> {
    const startAt = parseOffset(page);
    const boardsPage = await this.fetchBoardsPage(startAt, signal);
    const boards = boardsPage.values;
    const sprints: JiraSprintWithBoard[] = [];
    for (const board of boards) {
      if (board.type !== 'scrum') {
        continue;
      }
      const boardSprints = await this.fetchSprintsForBoard(board.id, signal);
      for (const s of boardSprints) {
        sprints.push({ ...s, boardId: board.id });
      }
    }
    const isLast = boardsPage.isLast ?? boards.length < BOARDS_PAGE_SIZE;
    const next = isLast ? null : String(startAt + boards.length);
    return { items: sprints, next };
  }

  private async fetchIssuesPage(
    page: string | null,
    options: SyncOptions,
    signal: AbortSignal | undefined,
  ): Promise<{ items: JiraIssue[]; next: string | null }> {
    const u = new URL(`${this.baseUrl}/rest/api/3/search/jql`);
    u.searchParams.set('jql', this.buildJql(options));
    u.searchParams.set('maxResults', String(ISSUES_PAGE_SIZE));
    u.searchParams.set(
      'fields',
      [...ISSUE_FIELDS, this.storyPointsField, this.sprintField].join(','),
    );
    u.searchParams.set('expand', 'changelog');
    if (page !== null) {
      u.searchParams.set('nextPageToken', page);
    }
    const res = await this.fetch<JiraSearchResponse>(
      u.toString(),
      'issues',
      signal,
    );
    const token = res.body.nextPageToken ?? null;
    const next = res.body.isLast === true || token === null ? null : token;
    return { items: res.body.issues, next };
  }

  // -------------------------------------------------------------------------
  // Writers
  // -------------------------------------------------------------------------

  private async writeProjects(
    storage: StorageHandle,
    projects: JiraProject[],
  ): Promise<void> {
    const now = Date.now();
    for (const p of projects) {
      await storage.entity({
        type: 'jira_project',
        id: p.id,
        attributes: {
          key: p.key,
          name: p.name,
          projectTypeKey: p.projectTypeKey ?? null,
          leadAccountId: p.lead?.accountId ?? null,
          leadDisplayName: p.lead?.displayName ?? null,
        },
        updated_at: now,
      });
    }
  }

  private async writeUsers(
    storage: StorageHandle,
    users: JiraUser[],
  ): Promise<void> {
    const now = Date.now();
    for (const u of users) {
      if (!u.accountId) {
        continue;
      }
      await storage.entity({
        type: 'jira_user',
        id: u.accountId,
        attributes: {
          displayName: u.displayName ?? null,
          emailAddress: u.emailAddress ?? null,
          accountType: u.accountType ?? null,
          active: u.active ?? null,
        },
        updated_at: now,
      });
    }
  }

  private async writeSprints(
    storage: StorageHandle,
    sprints: JiraSprintWithBoard[],
  ): Promise<void> {
    const now = Date.now();
    for (const s of sprints) {
      const startMs = parseEpoch(s.startDate ?? null, 'iso');
      const endMs = parseEpoch(s.endDate ?? null, 'iso');
      const completeMs = parseEpoch(s.completeDate ?? null, 'iso');
      await storage.entity({
        type: 'jira_sprint',
        id: String(s.id),
        attributes: {
          name: s.name,
          state: s.state,
          boardId: s.boardId,
          originBoardId: s.originBoardId ?? null,
          startDate: startMs,
          endDate: endMs,
          completeDate: completeMs,
        },
        updated_at: completeMs ?? endMs ?? startMs ?? now,
      });
    }
  }

  private async writeIssues(
    storage: StorageHandle,
    issues: JiraIssue[],
    sinceMs: number | null,
  ): Promise<void> {
    const writeEntities = this.isResourceEnabled('issues');
    const writeEvents = this.isResourceEnabled('issue_events');

    for (const issue of issues) {
      const f = issue.fields;
      const createdMs = parseEpoch(f.created, 'iso');
      const updatedMs = parseEpoch(f.updated, 'iso');
      if (createdMs === null || updatedMs === null) {
        console.warn(
          `[connector-jira] skipping issue ${issue.key} with unparseable created/updated`,
        );
        continue;
      }
      const projectKey = f.project?.key ?? null;

      if (writeEntities) {
        const rawPoints = f[this.storyPointsField];
        const storyPoints =
          typeof rawPoints === 'number' && Number.isFinite(rawPoints)
            ? rawPoints
            : null;
        await storage.entity({
          type: 'jira_issue',
          id: issue.id,
          attributes: {
            key: issue.key,
            summary: f.summary ?? null,
            statusName: f.status?.name ?? null,
            statusCategory: f.status?.statusCategory?.key ?? null,
            priority: f.priority?.name ?? null,
            issueType: f.issuetype?.name ?? null,
            assigneeId: f.assignee?.accountId ?? null,
            reporterId: f.reporter?.accountId ?? null,
            projectKey,
            sprintId: extractSprintId(f[this.sprintField]),
            storyPoints,
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
          if (ts === null) {
            continue;
          }
          if (sinceMs !== null && ts <= sinceMs) {
            continue;
          }
          for (const item of h.items) {
            if (item.field !== 'status') {
              continue;
            }
            const attributes: Record<string, JSONValue> = {
              historyId: h.id,
              issueId: issue.id,
              issueKey: issue.key,
              projectKey,
              authorId: h.author?.accountId ?? null,
              fromStatus: item.fromString ?? null,
              toStatus: item.toString ?? null,
            };
            await storage.event({
              name: 'jira_issue_status_change',
              start_ts: ts,
              end_ts: null,
              attributes,
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
    const cursor = isJiraSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';
    const sinceMs = options.since ? parseEpoch(options.since, 'iso') : null;
    const phases = this.activePhases();

    return paginateChunked<JiraPhase, string>({
      phases,
      cursor,
      signal,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'projects':
            return this.fetchProjectsPage(page, sig);
          case 'users':
            return this.fetchUsersPage(page, sig);
          case 'sprints':
            return this.fetchSprintsPage(page, sig);
          case 'issues':
            return this.fetchIssuesPage(page, options, sig);
        }
      },
      writeBatch: async (phase, items, page) => {
        if (isFull && page === null) {
          switch (phase) {
            case 'projects':
              await storage.entities([], { types: ['jira_project'] });
              break;
            case 'users':
              await storage.entities([], { types: ['jira_user'] });
              break;
            case 'sprints':
              await storage.entities([], { types: ['jira_sprint'] });
              break;
            case 'issues':
              if (this.isResourceEnabled('issues')) {
                await storage.entities([], { types: ['jira_issue'] });
              }
              if (this.isResourceEnabled('issue_events')) {
                await storage.events([], {
                  names: ['jira_issue_status_change'],
                });
              }
              break;
          }
        }
        switch (phase) {
          case 'projects':
            return this.writeProjects(storage, items as JiraProject[]);
          case 'users':
            return this.writeUsers(storage, items as JiraUser[]);
          case 'sprints':
            return this.writeSprints(storage, items as JiraSprintWithBoard[]);
          case 'issues':
            return this.writeIssues(storage, items as JiraIssue[], sinceMs);
        }
      },
    });
  }
}
