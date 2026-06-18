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
    apiToken: z.object({ $secret: z.string() }).meta({
      label: 'Personal access token',
      description:
        'Asana personal access token. Create one at app.asana.com → Settings → Apps → Developer apps → Personal access tokens.',
      placeholder: '2/1201234567890/...',
      secret: true,
    }),
    workspaceGid: z
      .string()
      .min(1)
      .regex(/^\d+$/, 'Workspace GID is the numeric id of the workspace.')
      .meta({
        label: 'Workspace GID',
        description:
          'Numeric GID of the workspace to sync. Find it at app.asana.com/api/1.0/workspaces.',
        placeholder: '1201234567890',
      }),
    projectGids: z.array(z.string().regex(/^\d+$/)).nonempty().optional().meta({
      label: 'Project GIDs (optional)',
      description:
        'Restrict the task sync to specific project GIDs. Omit to sync tasks from every project in the workspace.',
    }),
    resources: z
      .array(z.enum(['projects', 'users', 'tasks', 'task_events']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          "Which Asana resources to sync. Omit to sync all of them. 'task_events' shares the tasks scan - enabling it without 'tasks' still walks tasks (and fetches their stories) but skips writing task entities.",
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Asana',
  category: 'product',
  brandColor: '#F06A6A',
  tagline:
    'Sync projects, users, tasks, and task state-change events from an Asana workspace.',
  vendor: {
    name: 'Asana',
    domain: 'asana.com',
    apiDocs: 'https://developers.asana.com/reference/rest-api-reference',
    website: 'https://asana.com',
  },
  auth: {
    summary:
      'Authenticates with a personal access token sent as a Bearer credential. The token inherits the permissions of the account that created it.',
    setup: [
      'Open app.asana.com -> Settings -> Apps -> Developer apps.',
      'Under Personal access tokens, create a new token and copy its value.',
      'Store the token as a secret and reference it from the connector config as `apiToken: secret("ASANA_API_TOKEN")`, alongside the numeric workspaceGid.',
      'Find your workspace GID at https://app.asana.com/api/1.0/workspaces while authenticated.',
    ],
  },
  rateLimit:
    'Asana enforces per-token rate limits (150 req/min on free plans, 1500 on paid); 429 responses with Retry-After are honored.',
  limitations: [
    'Task state-change events are derived from each task story; only system stories (not comments) are written.',
    'A task in multiple projects is stored once, attributed to the first project it is scanned under.',
    'Workspace-wide task search requires a paid plan, so tasks are walked project-by-project; omit projectGids to scan every project.',
  ],
});

export type AsanaResource = 'projects' | 'users' | 'tasks' | 'task_events';

export interface AsanaSettings {
  workspaceGid: string;
  projectGids?: readonly string[];
  resources?: readonly AsanaResource[];
}

const asanaCredentials = {
  apiToken: {
    description: 'Asana personal access token',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type AsanaCredentials = typeof asanaCredentials;

const PHASE_ORDER = ['projects', 'users', 'tasks'] as const;

type AsanaPhase = (typeof PHASE_ORDER)[number];

const isAsanaSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

interface AsanaGidRef {
  gid: string;
}

interface AsanaProject {
  gid: string;
  name: string;
  archived?: boolean | null;
  created_at?: string | null;
  modified_at?: string | null;
  owner?: AsanaGidRef | null;
  team?: { name?: string | null } | null;
}

interface AsanaUser {
  gid: string;
  name?: string | null;
  email?: string | null;
}

interface AsanaTask {
  gid: string;
  name?: string | null;
  completed?: boolean | null;
  completed_at?: string | null;
  created_at?: string | null;
  modified_at?: string | null;
  due_on?: string | null;
  assignee?: AsanaGidRef | null;
}

interface AsanaStory {
  gid: string;
  type?: string | null;
  resource_subtype?: string | null;
  created_at: string;
  created_by?: AsanaGidRef | null;
  text?: string | null;
}

interface AsanaTaskWithContext {
  task: AsanaTask;
  projectGid: string;
  stories: AsanaStory[];
}

interface AsanaPage<T> {
  data: T[];
  next_page?: { offset: string } | null;
}

const gid = z.string().min(1);

const nextPageSchema = z.object({ offset: z.string() }).nullable().optional();

const projectsResponseSchema = z.object({
  data: z.array(
    z.object({
      gid,
      name: z.string(),
      archived: z.boolean().nullable().optional(),
      created_at: z.iso.datetime().nullable().optional(),
      modified_at: z.iso.datetime().nullable().optional(),
      owner: z.object({ gid }).nullable().optional(),
      team: z
        .object({ name: z.string().nullable().optional() })
        .nullable()
        .optional(),
    }),
  ),
  next_page: nextPageSchema,
});

const usersResponseSchema = z.object({
  data: z.array(
    z.object({
      gid,
      name: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
    }),
  ),
  next_page: nextPageSchema,
});

const tasksResponseSchema = z.object({
  data: z.array(
    z.object({
      gid,
      name: z.string().nullable().optional(),
      completed: z.boolean().nullable().optional(),
      completed_at: z.iso.datetime().nullable().optional(),
      created_at: z.iso.datetime().nullable().optional(),
      modified_at: z.iso.datetime().nullable().optional(),
      due_on: z.string().nullable().optional(),
      assignee: z.object({ gid }).nullable().optional(),
    }),
  ),
  next_page: nextPageSchema,
});

const storiesResponseSchema = z.object({
  data: z.array(
    z.object({
      gid,
      type: z.string().nullable().optional(),
      resource_subtype: z.string().nullable().optional(),
      created_at: z.iso.datetime(),
      created_by: z.object({ gid }).nullable().optional(),
      text: z.string().nullable().optional(),
    }),
  ),
  next_page: nextPageSchema,
});

export const asanaResources = defineResources({
  asana_project: {
    shape: 'entity',
    filterable: [{ field: 'archived', ops: ['eq'] }],
    description:
      'Projects in the workspace with name, archived state, owner, team, and timestamps.',
    endpoint: 'GET /projects',
    responses: { projects: projectsResponseSchema },
  },
  asana_user: {
    shape: 'entity',
    filterable: [],
    description: 'Users in the workspace with display name and email.',
    endpoint: 'GET /users',
    responses: { users: usersResponseSchema },
  },
  asana_task: {
    shape: 'entity',
    filterable: [
      { field: 'completed', ops: ['eq'] },
      { field: 'projectGid', ops: ['eq'] },
      { field: 'assigneeId', ops: ['eq'] },
    ],
    description:
      'Tasks with completion state, assignee, due date, owning project, and timestamps.',
    endpoint: 'GET /tasks?project={projectGid}',
    notes:
      'Tasks are walked project-by-project; a task in multiple projects is attributed to the first project scanned.',
    responses: { tasks: tasksResponseSchema },
  },
  asana_task_event: {
    shape: 'event',
    filterable: [],
    description:
      'Task state-change events derived from system stories (completed, assigned, due-date changes, etc.).',
    endpoint: 'GET /tasks/{taskGid}/stories',
    notes:
      'Only system stories are written; comments are skipped. start_ts is the story time, end_ts is null. Timestamps are Unix epoch milliseconds.',
    responses: { stories: storiesResponseSchema },
  },
});

const API_BASE = 'https://app.asana.com/api/1.0';
const PROJECTS_PAGE_SIZE = 50;
const USERS_PAGE_SIZE = 100;
const TASKS_PAGE_SIZE = 100;
const STORIES_PAGE_SIZE = 100;

const PROJECT_FIELDS =
  'name,archived,created_at,modified_at,owner.gid,team.name';
const USER_FIELDS = 'name,email';
const TASK_FIELDS =
  'name,completed,completed_at,created_at,modified_at,due_on,assignee.gid';
const STORY_FIELDS = 'type,resource_subtype,created_at,created_by.gid,text';

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

export const id = 'asana';

export class AsanaConnector extends BaseConnector<
  AsanaSettings,
  AsanaCredentials
> {
  static readonly id = id;

  static readonly resources = asanaResources;

  static readonly schemas = schemasFromResources(asanaResources);

  static create(input: unknown, ctx?: ConnectorContext): AsanaConnector {
    const parsed = configFields.parse(input);
    return new AsanaConnector(
      {
        workspaceGid: parsed.workspaceGid,
        projectGids: parsed.projectGids,
        resources: parsed.resources,
      },
      { apiToken: parsed.apiToken },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = asanaCredentials;

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.creds.apiToken}`,
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('asana'),
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

  private activePhases(): AsanaPhase[] {
    return selectActivePhases<AsanaResource, AsanaPhase>(
      (r) => {
        switch (r) {
          case 'projects':
            return 'projects';
          case 'users':
            return 'users';
          case 'tasks':
          case 'task_events':
            return 'tasks';
        }
      },
      PHASE_ORDER,
      this.settings.resources,
    );
  }

  private singleSpec(
    options: SyncOptions,
    resource: string,
  ): FetchSpec | undefined {
    const specs = options.fetchSpecs?.[resource];
    return specs && specs.length === 1 ? specs[0] : undefined;
  }

  private async fetchCollection<T>(
    path: string,
    params: Record<string, string>,
    offset: string | null,
    pageSize: number,
    resource: string,
    signal: AbortSignal | undefined,
  ): Promise<{ items: T[]; next: string | null }> {
    const u = new URL(`${API_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) {
      u.searchParams.set(k, v);
    }
    u.searchParams.set('limit', String(pageSize));
    if (offset !== null) {
      u.searchParams.set('offset', offset);
    }
    const res = await this.fetch<AsanaPage<T>>(u.toString(), resource, signal);
    return { items: res.body.data, next: res.body.next_page?.offset ?? null };
  }

  private fetchProjectsPage(
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<{ items: AsanaProject[]; next: string | null }> {
    return this.fetchCollection<AsanaProject>(
      '/projects',
      {
        workspace: this.settings.workspaceGid,
        opt_fields: PROJECT_FIELDS,
        archived: 'false',
      },
      page,
      PROJECTS_PAGE_SIZE,
      'projects',
      signal,
    );
  }

  private fetchUsersPage(
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<{ items: AsanaUser[]; next: string | null }> {
    return this.fetchCollection<AsanaUser>(
      '/users',
      { workspace: this.settings.workspaceGid, opt_fields: USER_FIELDS },
      page,
      USERS_PAGE_SIZE,
      'users',
      signal,
    );
  }

  private async fetchTasksForProject(
    projectGid: string,
    options: SyncOptions,
    signal: AbortSignal | undefined,
  ): Promise<AsanaTask[]> {
    const wantEvents = this.isResourceEnabled('task_events');
    const completed = pushableEq(
      this.singleSpec(options, 'asana_task')?.filter,
      'completed',
    );
    const params: Record<string, string> = {
      project: projectGid,
      opt_fields: TASK_FIELDS,
    };
    if (options.mode === 'latest' && options.since && !wantEvents) {
      params['modified_since'] = options.since;
    }
    if (completed !== null) {
      params['completed_since'] = completed === 'false' ? 'now' : '1970-01-01';
    }
    const out: AsanaTask[] = [];
    let offset: string | null = null;
    do {
      signal?.throwIfAborted();
      const page: { items: AsanaTask[]; next: string | null } =
        await this.fetchCollection<AsanaTask>(
          '/tasks',
          params,
          offset,
          TASKS_PAGE_SIZE,
          'tasks',
          signal,
        );
      out.push(...page.items);
      offset = page.next;
    } while (offset !== null);
    return out;
  }

  private async fetchStoriesForTask(
    taskGid: string,
    signal: AbortSignal | undefined,
  ): Promise<AsanaStory[]> {
    const out: AsanaStory[] = [];
    let offset: string | null = null;
    do {
      signal?.throwIfAborted();
      const page: { items: AsanaStory[]; next: string | null } =
        await this.fetchCollection<AsanaStory>(
          `/tasks/${taskGid}/stories`,
          { opt_fields: STORY_FIELDS },
          offset,
          STORIES_PAGE_SIZE,
          'task_events',
          signal,
        );
      out.push(...page.items);
      offset = page.next;
    } while (offset !== null);
    return out;
  }

  private async fetchTasksPage(
    page: string | null,
    options: SyncOptions,
    signal: AbortSignal | undefined,
  ): Promise<{ items: AsanaTaskWithContext[]; next: string | null }> {
    const wantEvents = this.isResourceEnabled('task_events');
    const fixed = this.settings.projectGids;

    let projectGids: string[];
    let next: string | null;
    if (fixed && fixed.length > 0) {
      projectGids = [...fixed];
      next = null;
    } else {
      const projectsPage = await this.fetchProjectsPage(page, signal);
      projectGids = projectsPage.items.map((p) => p.gid);
      next = projectsPage.next;
    }

    const seen = new Set<string>();
    const items: AsanaTaskWithContext[] = [];
    for (const projectGid of projectGids) {
      const tasks = await this.fetchTasksForProject(
        projectGid,
        options,
        signal,
      );
      for (const task of tasks) {
        if (seen.has(task.gid)) {
          continue;
        }
        seen.add(task.gid);
        const stories = wantEvents
          ? await this.fetchStoriesForTask(task.gid, signal)
          : [];
        items.push({ task, projectGid, stories });
      }
    }
    return { items, next };
  }

  private async writeProjects(
    storage: StorageHandle,
    projects: AsanaProject[],
  ): Promise<void> {
    const now = Date.now();
    for (const p of projects) {
      await storage.entity({
        type: 'asana_project',
        id: p.gid,
        attributes: {
          name: p.name,
          archived: p.archived ?? false,
          ownerId: p.owner?.gid ?? null,
          teamName: p.team?.name ?? null,
          createdAt: parseEpoch(p.created_at ?? null, 'iso'),
        },
        updated_at: parseEpoch(p.modified_at ?? null, 'iso') ?? now,
      });
    }
  }

  private async writeUsers(
    storage: StorageHandle,
    users: AsanaUser[],
  ): Promise<void> {
    const now = Date.now();
    for (const u of users) {
      if (!u.gid) {
        continue;
      }
      await storage.entity({
        type: 'asana_user',
        id: u.gid,
        attributes: {
          name: u.name ?? null,
          email: u.email ?? null,
        },
        updated_at: now,
      });
    }
  }

  private async writeTasks(
    storage: StorageHandle,
    items: AsanaTaskWithContext[],
    sinceMs: number | null,
  ): Promise<void> {
    const writeEntities = this.isResourceEnabled('tasks');
    const writeEvents = this.isResourceEnabled('task_events');
    const now = Date.now();

    for (const { task, projectGid, stories } of items) {
      const createdMs = parseEpoch(task.created_at ?? null, 'iso');
      const modifiedMs = parseEpoch(task.modified_at ?? null, 'iso');

      if (writeEntities) {
        await storage.entity({
          type: 'asana_task',
          id: task.gid,
          attributes: {
            name: task.name ?? null,
            completed: task.completed ?? false,
            assigneeId: task.assignee?.gid ?? null,
            projectGid,
            dueOn: task.due_on ?? null,
            createdAt: createdMs,
            completedAt: parseEpoch(task.completed_at ?? null, 'iso'),
          },
          updated_at: modifiedMs ?? now,
        });
      }

      if (writeEvents) {
        for (const story of stories) {
          if (story.type !== 'system') {
            continue;
          }
          const ts = parseEpoch(story.created_at, 'iso');
          if (ts === null) {
            continue;
          }
          if (sinceMs !== null && ts <= sinceMs) {
            continue;
          }
          const attributes: Record<string, JSONValue> = {
            storyGid: story.gid,
            taskGid: task.gid,
            projectGid,
            resourceSubtype: story.resource_subtype ?? null,
            authorId: story.created_by?.gid ?? null,
            text: story.text ?? null,
          };
          await storage.event({
            name: 'asana_task_event',
            start_ts: ts,
            end_ts: null,
            attributes,
          });
        }
      }
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = isAsanaSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';
    const sinceMs = options.since ? parseEpoch(options.since, 'iso') : null;
    const phases = this.activePhases();

    return paginateChunked<AsanaPhase, string>({
      phases,
      cursor,
      signal,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'projects':
            return this.fetchProjectsPage(page, sig);
          case 'users':
            return this.fetchUsersPage(page, sig);
          case 'tasks':
            return this.fetchTasksPage(page, options, sig);
        }
      },
      writeBatch: async (phase, items, page) => {
        if (isFull && page === null) {
          switch (phase) {
            case 'projects':
              await storage.entities([], { types: ['asana_project'] });
              break;
            case 'users':
              await storage.entities([], { types: ['asana_user'] });
              break;
            case 'tasks':
              if (this.isResourceEnabled('tasks')) {
                await storage.entities([], { types: ['asana_task'] });
              }
              if (this.isResourceEnabled('task_events')) {
                await storage.events([], { names: ['asana_task_event'] });
              }
              break;
          }
        }
        switch (phase) {
          case 'projects':
            return this.writeProjects(storage, items as AsanaProject[]);
          case 'users':
            return this.writeUsers(storage, items as AsanaUser[]);
          case 'tasks':
            return this.writeTasks(
              storage,
              items as AsanaTaskWithContext[],
              sinceMs,
            );
        }
      },
    });
  }
}
