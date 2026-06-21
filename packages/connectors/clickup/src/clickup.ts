import {
  type HttpResponse,
  connectorUserAgent,
  parseEpoch,
  standardRateLimitPolicy,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
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

export const configFields = defineConfigFields(
  z.object({
    apiToken: z.object({ $secret: z.string() }).meta({
      label: 'API Token',
      description:
        'ClickUp personal API token. Create one at ClickUp -> Settings -> Apps -> API Token.',
      placeholder: 'pk_...',
      secret: true,
    }),
    teamId: z.string().min(1).meta({
      label: 'Workspace ID',
      description:
        'ClickUp Workspace (team) ID to sync. Find it in the URL: app.clickup.com/<workspace_id>/home.',
      placeholder: '9000000000',
    }),
    resources: z
      .array(z.enum(['spaces', 'folders', 'lists', 'tasks', 'task_events']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          "Which ClickUp resources to sync. Omit to sync all of them. 'task_events' derives created / closed lifecycle events from each task's timestamps and shares the task query with 'tasks'.",
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'ClickUp',
  category: 'product',
  brandColor: '#7B68EE',
  tagline:
    'Sync spaces, folders, lists, tasks, and task lifecycle events from a ClickUp workspace for throughput, open-work, and status-distribution analytics.',
  vendor: {
    name: 'ClickUp',
    domain: 'clickup.com',
    apiDocs: 'https://clickup.com/api',
    website: 'https://clickup.com',
  },
  auth: {
    summary:
      'Authenticates with a ClickUp personal API token sent in the Authorization header. The token scopes the sync to the workspaces, spaces, and tasks the issuing user can access.',
    setup: [
      'Open ClickUp -> Settings -> Apps.',
      'Under API Token, click Generate (or copy the existing personal token). It starts with pk_.',
      'Store it as a secret and reference it from the connector config as `apiToken: secret("CLICKUP_API_TOKEN")`, alongside your Workspace ID.',
    ],
  },
  rateLimit:
    'ClickUp rate-limits per token (100 requests/minute on the Free Forever / Unlimited plans, higher on Business+) and exposes X-RateLimit-Remaining / X-RateLimit-Reset headers; the shared HTTP client backs off on 429.',
  limitations: [
    'Personal API token auth only (OAuth app installs are out of scope).',
    "Task lifecycle events (created / closed) are derived from each task's own date_created / date_closed fields rather than the per-task activity feed, which avoids an N+1 sync; the event scope is cleared and rewritten from a full task scan on every sync.",
    'Custom fields, comments, time tracking, and goals are out of scope.',
  ],
});

export interface ClickUpSettings {
  teamId: string;
  resources?: readonly ClickUpResource[];
}

const clickupCredentials = {
  apiToken: {
    description: 'ClickUp personal API token',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type ClickUpCredentials = typeof clickupCredentials;

const clickupRateLimit = standardRateLimitPolicy({
  remainingHeader: 'x-ratelimit-remaining',
  resetHeader: 'x-ratelimit-reset',
  resetUnit: 's',
  resetFallbackMs: 60_000,
});

const PHASE_ORDER = [
  'spaces',
  'folders',
  'lists',
  'tasks',
  'task_events',
] as const;

type ClickUpPhase = (typeof PHASE_ORDER)[number];

export type ClickUpResource = ClickUpPhase;

const isClickUpSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const SPACE_ENTITY = 'clickup_space';
const FOLDER_ENTITY = 'clickup_folder';
const LIST_ENTITY = 'clickup_list';
const TASK_ENTITY = 'clickup_task';
const TASK_EVENT = 'clickup_task_event';

const API_BASE = 'https://api.clickup.com/api/v2';
const TASKS_PER_PAGE = 100;

const idString = z.string().min(1);

const spaceSchema = z.object({
  id: idString,
  name: z.string(),
  private: z.boolean().nullish(),
  archived: z.boolean().nullish(),
});

const spacesResponseSchema = z.object({
  spaces: z.array(spaceSchema).nullish(),
});

const folderSchema = z.object({
  id: idString,
  name: z.string(),
  hidden: z.boolean().nullish(),
  archived: z.boolean().nullish(),
  task_count: z.union([z.string(), z.number()]).nullish(),
  space: z.object({ id: idString, name: z.string().nullish() }).nullish(),
});

const foldersResponseSchema = z.object({
  folders: z.array(folderSchema).nullish(),
});

const listSchema = z.object({
  id: idString,
  name: z.string(),
  archived: z.boolean().nullish(),
  task_count: z.number().nullish(),
  status: z.object({ status: z.string().nullish() }).nullish(),
  folder: z.object({ id: idString, name: z.string().nullish() }).nullish(),
  space: z.object({ id: idString, name: z.string().nullish() }).nullish(),
});

const listsResponseSchema = z.object({
  lists: z.array(listSchema).nullish(),
});

const taskSchema = z.object({
  id: idString,
  name: z.string(),
  status: z
    .object({ status: z.string().nullish(), type: z.string().nullish() })
    .nullish(),
  priority: z.object({ priority: z.string().nullish() }).nullish(),
  date_created: z.string().nullish(),
  date_updated: z.string().nullish(),
  date_closed: z.string().nullish(),
  date_done: z.string().nullish(),
  due_date: z.string().nullish(),
  time_estimate: z.number().nullish(),
  creator: z.object({ id: z.union([z.string(), z.number()]) }).nullish(),
  assignees: z
    .array(z.object({ id: z.union([z.string(), z.number()]) }))
    .nullish(),
  tags: z.array(z.object({ name: z.string() })).nullish(),
  url: z.string().nullish(),
  list: z.object({ id: idString, name: z.string().nullish() }).nullish(),
  folder: z.object({ id: idString, name: z.string().nullish() }).nullish(),
  space: z.object({ id: idString }).nullish(),
});

const tasksResponseSchema = z.object({
  tasks: z.array(taskSchema).nullish(),
  last_page: z.boolean().nullish(),
});

type SpaceRecord = z.infer<typeof spaceSchema>;
type FolderRecord = z.infer<typeof folderSchema>;
type ListRecord = z.infer<typeof listSchema>;
type TaskRecord = z.infer<typeof taskSchema>;

interface SpacesResponse {
  spaces?: SpaceRecord[] | null;
}
interface FoldersResponse {
  folders?: FolderRecord[] | null;
}
interface ListsResponse {
  lists?: ListRecord[] | null;
}
interface TasksResponse {
  tasks?: TaskRecord[] | null;
  last_page?: boolean | null;
}

export const clickupResources = defineResources({
  [SPACE_ENTITY]: {
    shape: 'entity',
    filterable: [],
    description: 'Workspace spaces with their name and privacy flag.',
    endpoint: 'GET /team/{team_id}/space',
    fields: [
      { name: 'name', description: 'Space name.' },
      { name: 'private', description: 'Whether the space is private.' },
      { name: 'archived', description: 'Whether the space is archived.' },
    ],
    responses: { spaces: spacesResponseSchema },
  },
  [FOLDER_ENTITY]: {
    shape: 'entity',
    filterable: [{ field: 'spaceId', ops: ['eq'] }],
    description: 'Folders within each space, with their parent space.',
    endpoint: 'GET /space/{space_id}/folder',
    fields: [
      { name: 'name', description: 'Folder name.' },
      { name: 'spaceId', description: 'Parent space id.' },
      {
        name: 'taskCount',
        description: 'Number of tasks across the folder at sync time.',
      },
      { name: 'archived', description: 'Whether the folder is archived.' },
    ],
    responses: { folders: foldersResponseSchema },
  },
  [LIST_ENTITY]: {
    shape: 'entity',
    filterable: [{ field: 'spaceId', ops: ['eq'] }],
    description:
      'Lists (folder-scoped and folderless) with their parent folder and space.',
    endpoint: 'GET /space/{space_id}/list and GET /folder/{folder_id}/list',
    fields: [
      { name: 'name', description: 'List name.' },
      {
        name: 'folderId',
        description: 'Parent folder id (null if folderless).',
      },
      { name: 'spaceId', description: 'Parent space id.' },
      {
        name: 'taskCount',
        description: 'Number of tasks in the list at sync time.',
      },
      { name: 'archived', description: 'Whether the list is archived.' },
    ],
    responses: { lists: listsResponseSchema },
  },
  [TASK_ENTITY]: {
    shape: 'entity',
    filterable: [
      {
        field: 'statusType',
        ops: ['eq'],
        values: ['open', 'custom', 'closed', 'done'],
      },
      { field: 'status', ops: ['eq'] },
      { field: 'listId', ops: ['eq'] },
    ],
    description:
      'Tasks with their status, priority, assignees, parent list / folder / space, tags, and lifecycle timestamps.',
    endpoint: 'GET /team/{team_id}/task',
    fields: [
      { name: 'name', description: 'Task name.' },
      {
        name: 'status',
        description: 'Current status name (e.g. "in progress").',
      },
      {
        name: 'statusType',
        description: 'Status category: open, custom, closed, or done.',
      },
      {
        name: 'priority',
        description: 'Priority label (urgent / high / normal / low), or null.',
      },
      { name: 'listId', description: 'Parent list id.' },
      { name: 'folderId', description: 'Parent folder id.' },
      { name: 'spaceId', description: 'Parent space id.' },
      { name: 'assignees', description: 'Assignee user ids.' },
      { name: 'assigneeCount', description: 'Number of assignees.' },
      { name: 'tags', description: 'Tag names on the task.' },
      {
        name: 'createdAt',
        description: 'When the task was created (Unix ms).',
      },
      {
        name: 'closedAt',
        description: 'When the task was closed (Unix ms; null if open).',
      },
      {
        name: 'dueDate',
        description: 'Task due date (Unix ms; null if unset).',
      },
    ],
    responses: { tasks: tasksResponseSchema },
  },
  [TASK_EVENT]: {
    shape: 'event',
    filterable: [
      { field: 'kind', ops: ['eq'], values: ['created', 'closed'] },
      { field: 'listId', ops: ['eq'] },
    ],
    description:
      "Task lifecycle events (created / closed) derived from each task's date_created and date_closed. The scope is cleared and rewritten from a full task scan on every sync (including incremental runs).",
    endpoint: 'GET /team/{team_id}/task',
    notes:
      "Derived from each task's own date_created / date_closed timestamps, not from a separate per-task activity call. Drives created-per-day and closed-per-day throughput timeseries.",
    fields: [
      { name: 'kind', description: '"created" or "closed".' },
      { name: 'taskId', description: 'Task the event belongs to.' },
      { name: 'listId', description: 'Parent list id, denormalised.' },
      { name: 'spaceId', description: 'Parent space id, denormalised.' },
      { name: 'status', description: 'Task status name at sync time.' },
    ],
    responses: { task_events: tasksResponseSchema },
  },
});

export const id = 'clickup';

function epochMs(value: string | null | undefined): number | null {
  return parseEpoch(value ?? null, 'ms');
}

function tagNames(tags: Array<{ name: string }> | null | undefined): string[] {
  if (!tags) {
    return [];
  }
  return tags
    .map((t) => t.name)
    .filter((n) => typeof n === 'string' && n !== '');
}

function assigneeIds(
  assignees: Array<{ id: string | number }> | null | undefined,
): string[] {
  if (!assignees) {
    return [];
  }
  return assignees.map((a) => String(a.id));
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

export class ClickUpConnector extends BaseConnector<
  ClickUpSettings,
  ClickUpCredentials
> {
  static readonly id = id;

  static readonly resources = clickupResources;

  static readonly schemas = schemasFromResources(clickupResources);

  static create(input: unknown, ctx?: ConnectorContext): ClickUpConnector {
    const parsed = configFields.parse(input);
    return new ClickUpConnector(
      { teamId: parsed.teamId, resources: parsed.resources },
      { apiToken: parsed.apiToken },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = clickupCredentials;

  private spacesCache: SpaceRecord[] | undefined;

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: this.creds.apiToken,
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('clickup'),
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
      rateLimit: clickupRateLimit,
    });
  }

  private get teamPath(): string {
    return `/team/${encodeURIComponent(this.settings.teamId)}`;
  }

  private async getSpaces(signal?: AbortSignal): Promise<SpaceRecord[]> {
    if (this.spacesCache) {
      return this.spacesCache;
    }
    const res = await this.apiGet<SpacesResponse>(
      `${API_BASE}${this.teamPath}/space?archived=false`,
      'spaces',
      signal,
    );
    this.spacesCache = res.body.spaces ?? [];
    return this.spacesCache;
  }

  private async getFolders(
    spaceId: string,
    signal?: AbortSignal,
  ): Promise<FolderRecord[]> {
    const res = await this.apiGet<FoldersResponse>(
      `${API_BASE}/space/${encodeURIComponent(spaceId)}/folder?archived=false`,
      'folders',
      signal,
    );
    return res.body.folders ?? [];
  }

  private async getFolderlessLists(
    spaceId: string,
    signal?: AbortSignal,
  ): Promise<ListRecord[]> {
    const res = await this.apiGet<ListsResponse>(
      `${API_BASE}/space/${encodeURIComponent(spaceId)}/list?archived=false`,
      'lists',
      signal,
    );
    return res.body.lists ?? [];
  }

  private async getFolderLists(
    folderId: string,
    signal?: AbortSignal,
  ): Promise<ListRecord[]> {
    const res = await this.apiGet<ListsResponse>(
      `${API_BASE}/folder/${encodeURIComponent(folderId)}/list?archived=false`,
      'lists',
      signal,
    );
    return res.body.lists ?? [];
  }

  private buildTasksUrl(
    page: number,
    options: SyncOptions,
    applySince: boolean,
  ): string {
    const url = new URL(`${API_BASE}${this.teamPath}/task`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('include_closed', 'true');
    url.searchParams.set('subtasks', 'true');
    url.searchParams.set('order_by', 'updated');
    const listId = pushableEq(
      this.singleSpec(options, TASK_ENTITY)?.filter,
      'listId',
    );
    if (listId !== null) {
      url.searchParams.append('list_ids[]', listId);
    }
    if (applySince && options.since) {
      const sinceMs = parseEpoch(options.since, 'iso');
      if (sinceMs !== null) {
        url.searchParams.set('date_updated_gt', String(sinceMs));
      }
    }
    return url.toString();
  }

  private singleSpec(
    options: SyncOptions,
    resource: string,
  ): FetchSpec | undefined {
    const specs = options.fetchSpecs?.[resource];
    return specs && specs.length === 1 ? specs[0] : undefined;
  }

  private async fetchSpacesPage(
    signal?: AbortSignal,
  ): Promise<FetchPageResult<string>> {
    const spaces = await this.getSpaces(signal);
    return { items: spaces, next: null };
  }

  private async fetchFoldersPage(
    signal?: AbortSignal,
  ): Promise<FetchPageResult<string>> {
    const spaces = await this.getSpaces(signal);
    const folders: FolderRecord[] = [];
    for (const space of spaces) {
      const spaceFolders = await this.getFolders(space.id, signal);
      for (const folder of spaceFolders) {
        folders.push({ ...folder, space: folder.space ?? { id: space.id } });
      }
    }
    return { items: folders, next: null };
  }

  private async fetchListsPage(
    signal?: AbortSignal,
  ): Promise<FetchPageResult<string>> {
    const spaces = await this.getSpaces(signal);
    const lists: ListRecord[] = [];
    for (const space of spaces) {
      const folderless = await this.getFolderlessLists(space.id, signal);
      for (const list of folderless) {
        lists.push({ ...list, space: list.space ?? { id: space.id } });
      }
      const folders = await this.getFolders(space.id, signal);
      for (const folder of folders) {
        const folderLists = await this.getFolderLists(folder.id, signal);
        for (const list of folderLists) {
          lists.push({
            ...list,
            folder: list.folder ?? { id: folder.id, name: folder.name },
            space: list.space ?? { id: space.id },
          });
        }
      }
    }
    return { items: lists, next: null };
  }

  private async fetchTasksPage(
    phase: 'tasks' | 'task_events',
    page: string | null,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<FetchPageResult<string>> {
    const pageNum = page === null ? 0 : Number(page);
    const safePage = Number.isFinite(pageNum) && pageNum >= 0 ? pageNum : 0;
    const url = this.buildTasksUrl(safePage, options, phase === 'tasks');
    const res = await this.apiGet<TasksResponse>(url, phase, signal);
    const tasks = res.body.tasks ?? [];
    const lastPage = res.body.last_page;
    const exhausted =
      tasks.length === 0 ||
      (typeof lastPage === 'boolean'
        ? lastPage
        : tasks.length < TASKS_PER_PAGE);
    return { items: tasks, next: exhausted ? null : String(safePage + 1) };
  }

  private async writeSpaces(
    storage: StorageHandle,
    spaces: SpaceRecord[],
  ): Promise<void> {
    for (const space of spaces) {
      await storage.entity({
        type: SPACE_ENTITY,
        id: space.id,
        attributes: {
          name: space.name,
          private: space.private ?? null,
          archived: space.archived ?? null,
        },
        updated_at: 0,
      });
    }
  }

  private async writeFolders(
    storage: StorageHandle,
    folders: FolderRecord[],
  ): Promise<void> {
    for (const folder of folders) {
      await storage.entity({
        type: FOLDER_ENTITY,
        id: folder.id,
        attributes: {
          name: folder.name,
          spaceId: folder.space?.id ?? null,
          taskCount:
            folder.task_count === null || folder.task_count === undefined
              ? null
              : Number(folder.task_count),
          archived: folder.archived ?? null,
        },
        updated_at: 0,
      });
    }
  }

  private async writeLists(
    storage: StorageHandle,
    lists: ListRecord[],
  ): Promise<void> {
    for (const list of lists) {
      await storage.entity({
        type: LIST_ENTITY,
        id: list.id,
        attributes: {
          name: list.name,
          folderId: list.folder?.id ?? null,
          spaceId: list.space?.id ?? null,
          taskCount: list.task_count ?? null,
          archived: list.archived ?? null,
        },
        updated_at: 0,
      });
    }
  }

  private async writeTasks(
    storage: StorageHandle,
    tasks: TaskRecord[],
  ): Promise<void> {
    for (const task of tasks) {
      const attributes: Record<string, JSONValue> = {
        name: task.name,
        status: task.status?.status ?? null,
        statusType: task.status?.type ?? null,
        priority: task.priority?.priority ?? null,
        listId: task.list?.id ?? null,
        folderId: task.folder?.id ?? null,
        spaceId: task.space?.id ?? null,
        assignees: assigneeIds(task.assignees),
        assigneeCount: task.assignees?.length ?? 0,
        tags: tagNames(task.tags),
        creatorId:
          task.creator?.id === null || task.creator?.id === undefined
            ? null
            : String(task.creator.id),
        url: task.url ?? null,
        timeEstimate: task.time_estimate ?? null,
        dueDate: epochMs(task.due_date),
        createdAt: epochMs(task.date_created),
        closedAt: epochMs(task.date_closed),
        doneAt: epochMs(task.date_done),
      };
      await storage.entity({
        type: TASK_ENTITY,
        id: task.id,
        attributes,
        updated_at:
          epochMs(task.date_updated) ?? epochMs(task.date_created) ?? 0,
      });
    }
  }

  private async writeTaskEvents(
    storage: StorageHandle,
    tasks: TaskRecord[],
  ): Promise<void> {
    for (const task of tasks) {
      const base: Record<string, JSONValue> = {
        taskId: task.id,
        listId: task.list?.id ?? null,
        spaceId: task.space?.id ?? null,
        status: task.status?.status ?? null,
      };

      const createdMs = epochMs(task.date_created);
      if (createdMs !== null) {
        await storage.event({
          name: TASK_EVENT,
          start_ts: createdMs,
          end_ts: null,
          attributes: { ...base, kind: 'created' },
        });
      }

      const closedMs = epochMs(task.date_closed);
      if (closedMs !== null) {
        await storage.event({
          name: TASK_EVENT,
          start_ts: closedMs,
          end_ts: null,
          attributes: { ...base, kind: 'closed' },
        });
      }
    }
  }

  private async clearScopeOnFirstPage(
    storage: StorageHandle,
    phase: ClickUpPhase,
    isFull: boolean,
  ): Promise<void> {
    if (phase === 'task_events') {
      await storage.events([], { names: [TASK_EVENT] });
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
    phase: ClickUpPhase,
    items: unknown[],
  ): Promise<void> {
    switch (phase) {
      case 'spaces':
        return this.writeSpaces(storage, items as SpaceRecord[]);
      case 'folders':
        return this.writeFolders(storage, items as FolderRecord[]);
      case 'lists':
        return this.writeLists(storage, items as ListRecord[]);
      case 'tasks':
        return this.writeTasks(storage, items as TaskRecord[]);
      case 'task_events':
        return this.writeTaskEvents(storage, items as TaskRecord[]);
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    this.spacesCache = undefined;
    const cursor = isClickUpSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';

    const phases = selectActivePhases<ClickUpResource, ClickUpPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<ClickUpPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'spaces':
            return this.fetchSpacesPage(sig);
          case 'folders':
            return this.fetchFoldersPage(sig);
          case 'lists':
            return this.fetchListsPage(sig);
          case 'tasks':
          case 'task_events':
            return this.fetchTasksPage(phase, page, options, sig);
        }
      },
      writeBatch: async (phase, items, page) => {
        if (page === null) {
          await this.clearScopeOnFirstPage(storage, phase, isFull);
        }
        await this.writePhase(storage, phase, items);
      },
    });
  }
}

const ENTITY_TYPE_BY_PHASE: Partial<Record<ClickUpPhase, string>> = {
  spaces: SPACE_ENTITY,
  folders: FOLDER_ENTITY,
  lists: LIST_ENTITY,
  tasks: TASK_ENTITY,
};
