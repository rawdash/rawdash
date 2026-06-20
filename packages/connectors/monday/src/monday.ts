import { connectorUserAgent, parseEpoch } from '@rawdash/connector-shared';
import type { HttpResponse } from '@rawdash/connector-shared';
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
import type { JSONValue } from '@rawdash/core';
import { z } from 'zod';

export const configFields = defineConfigFields(
  z.object({
    apiToken: z.object({ $secret: z.string() }).meta({
      label: 'API Token',
      description:
        'monday.com API token. Create one at monday.com -> Profile (avatar) -> Developers -> My access tokens.',
      placeholder: 'eyJhbGciOi...',
      secret: true,
    }),
    boardIds: z.array(z.string().min(1)).nonempty().optional().meta({
      label: 'Board IDs (optional)',
      description:
        'Restrict the sync to specific board IDs. Omit to discover and sync every board the token can see.',
    }),
    resources: z
      .array(z.enum(['boards', 'items', 'item_events']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which resources to sync. Omit to sync all resources. The `item_events` phase reads each board activity log.',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'monday.com',
  category: 'product',
  brandColor: '#FF3D57',
  tagline:
    'Sync boards, items, and item activity events from a monday.com account.',
  vendor: {
    name: 'monday.com',
    domain: 'monday.com',
    apiDocs: 'https://developer.monday.com/api-reference/',
    website: 'https://monday.com',
  },
  auth: {
    summary:
      'A monday.com API token is required. It authenticates every GraphQL request and scopes the sync to the boards the token can access.',
    setup: [
      'Open monday.com and click your avatar -> Developers.',
      'Go to My access tokens and copy your personal API token.',
      'Store it as a secret and reference it from the connector config as `apiToken: secret("MONDAY_API_TOKEN")`.',
    ],
  },
  rateLimit:
    'monday.com meters requests by a per-minute complexity budget rather than a fixed request count; the connector walks one board at a time and pages items at most 100 at a time to keep each query within budget.',
  limitations: [
    'API token auth only (OAuth not yet supported).',
    'items_page has no server-side updated-at filter, so incremental item syncs page each board and drop unchanged rows client-side; item activity events are filtered server-side by date.',
    'Webhooks, updates/replies, and sub-items are out of scope.',
  ],
});

export interface MondaySettings {
  boardIds?: readonly string[];
  resources?: readonly MondayResource[];
}

const mondayCredentials = {
  apiToken: {
    description: 'monday.com API token',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type MondayCredentials = typeof mondayCredentials;

const PHASE_ORDER = ['boards', 'items', 'item_events'] as const;

type MondayPhase = (typeof PHASE_ORDER)[number];

export type MondayResource = MondayPhase;

const isMondaySyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

interface MondayBoard {
  id: string;
  name: string;
  state: string;
  board_kind: string | null;
  description: string | null;
  workspace_id: string | null;
  items_count: number | null;
  updated_at: string | null;
}

interface MondayColumnValue {
  id: string;
  text: string | null;
  value: string | null;
  type: string | null;
}

interface MondayItem {
  id: string;
  name: string;
  state: string | null;
  created_at: string | null;
  updated_at: string | null;
  group: { id: string; title: string } | null;
  board: { id: string } | null;
  column_values: MondayColumnValue[];
}

interface MondayItemsPage {
  cursor: string | null;
  items: MondayItem[];
}

interface MondayActivityLog {
  id: string;
  event: string;
  entity: string | null;
  data: string | null;
  user_id: string | null;
  account_id: string | null;
  created_at: string;
}

interface EnrichedActivityLog extends MondayActivityLog {
  boardId: string | null;
}

interface GraphQLError {
  message: string;
  extensions?: { code?: string };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

const BOARD_FIELDS =
  'id name state board_kind description workspace_id items_count updated_at';
const ITEM_FIELDS =
  'id name state created_at updated_at group { id title } board { id } column_values { id text value type }';
const ACTIVITY_FIELDS = 'id event entity data user_id account_id created_at';

const BOARDS_QUERY = `
  query Boards($limit: Int!, $page: Int!) {
    boards(limit: $limit, page: $page) { ${BOARD_FIELDS} }
  }
`;

const BOARDS_BY_IDS_QUERY = `
  query BoardsByIds($ids: [ID!], $limit: Int!) {
    boards(ids: $ids, limit: $limit) { ${BOARD_FIELDS} }
  }
`;

const DISCOVER_BOARD_ITEMS_QUERY = `
  query BoardItemsByPage($page: Int!, $itemLimit: Int!) {
    boards(limit: 1, page: $page) {
      id
      items_page(limit: $itemLimit) { cursor items { ${ITEM_FIELDS} } }
    }
  }
`;

const SCOPED_BOARD_ITEMS_QUERY = `
  query BoardItemsById($ids: [ID!], $itemLimit: Int!) {
    boards(ids: $ids) {
      id
      items_page(limit: $itemLimit) { cursor items { ${ITEM_FIELDS} } }
    }
  }
`;

const NEXT_ITEMS_QUERY = `
  query NextItems($cursor: String!, $itemLimit: Int!) {
    next_items_page(cursor: $cursor, limit: $itemLimit) {
      cursor
      items { ${ITEM_FIELDS} }
    }
  }
`;

const DISCOVER_BOARD_LOGS_QUERY = `
  query BoardLogsByPage(
    $page: Int!
    $logLimit: Int!
    $logPage: Int!
    $from: ISO8601DateTime
  ) {
    boards(limit: 1, page: $page) {
      id
      activity_logs(limit: $logLimit, page: $logPage, from: $from) { ${ACTIVITY_FIELDS} }
    }
  }
`;

const SCOPED_BOARD_LOGS_QUERY = `
  query BoardLogsById(
    $ids: [ID!]
    $logLimit: Int!
    $logPage: Int!
    $from: ISO8601DateTime
  ) {
    boards(ids: $ids) {
      id
      activity_logs(limit: $logLimit, page: $logPage, from: $from) { ${ACTIVITY_FIELDS} }
    }
  }
`;

const DEFAULT_BOARD_PAGE_SIZE = 50;
const MAX_BOARD_PAGE_SIZE = 500;
const DEFAULT_ITEM_PAGE_SIZE = 100;
const MAX_ITEM_PAGE_SIZE = 500;
const DEFAULT_LOG_PAGE_SIZE = 100;
const MAX_LOG_PAGE_SIZE = 10_000;
const CHUNK_BUDGET_MS = 25_000;
const ENDPOINT = 'https://api.monday.com/v2';
const API_VERSION = '2024-10';

function clampPageSize(
  requested: number | undefined,
  fallback: number,
  max: number,
): number {
  const n = requested ?? fallback;
  if (!Number.isFinite(n) || n < 1) {
    return 1;
  }
  return Math.min(Math.floor(n), max);
}

interface ItemsPageCursor {
  b: number;
  c: string | null;
}

function encodeItemsPage(b: number, c: string | null): string {
  return JSON.stringify({ b, c });
}

function decodeItemsPage(page: string | null): ItemsPageCursor {
  if (!page) {
    return { b: 0, c: null };
  }
  try {
    const v = JSON.parse(page) as { b?: unknown; c?: unknown };
    if (typeof v.b === 'number' && v.b >= 0) {
      return { b: v.b, c: typeof v.c === 'string' ? v.c : null };
    }
  } catch (err) {
    console.warn(`monday: failed to decode items cursor: ${String(err)}`);
  }
  return { b: 0, c: null };
}

interface LogsPageCursor {
  b: number;
  p: number;
}

function encodeLogsPage(b: number, p: number): string {
  return JSON.stringify({ b, p });
}

function decodeLogsPage(page: string | null): LogsPageCursor {
  if (!page) {
    return { b: 0, p: 1 };
  }
  try {
    const v = JSON.parse(page) as { b?: unknown; p?: unknown };
    if (typeof v.b === 'number' && v.b >= 0 && typeof v.p === 'number') {
      return { b: v.b, p: Math.max(1, v.p) };
    }
  } catch (err) {
    console.warn(`monday: failed to decode logs cursor: ${String(err)}`);
  }
  return { b: 0, p: 1 };
}

function parseActivityTs(raw: string): number | null {
  const digits = raw.trim();
  if (/^\d+$/.test(digits)) {
    const ms = Number(digits.slice(0, 13));
    return Number.isFinite(ms) ? ms : null;
  }
  return parseEpoch(raw, 'iso');
}

function extractItemId(data: string | null): string | null {
  if (!data) {
    return null;
  }
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    const candidate = parsed.pulse_id ?? parsed.item_id ?? parsed.pulseId;
    if (typeof candidate === 'number' || typeof candidate === 'string') {
      return String(candidate);
    }
  } catch (err) {
    console.warn(
      `monday: failed to parse activity data payload: ${String(err)}`,
    );
  }
  return null;
}

const idString = z.string().min(1);

const boardSchema = z.object({
  id: idString,
  name: z.string(),
  state: z.string(),
  board_kind: z.string().nullable(),
  description: z.string().nullable(),
  workspace_id: z.string().nullable(),
  items_count: z.number().nullable(),
  updated_at: z.string().nullable(),
});

const columnValueSchema = z.object({
  id: z.string(),
  text: z.string().nullable(),
  value: z.string().nullable(),
  type: z.string().nullable(),
});

const itemSchema = z.object({
  id: idString,
  name: z.string(),
  state: z.string().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
  group: z.object({ id: z.string(), title: z.string() }).nullable(),
  board: z.object({ id: idString }).nullable(),
  column_values: z.array(columnValueSchema),
});

const activityLogSchema = z.object({
  id: idString,
  event: z.string(),
  entity: z.string().nullable(),
  data: z.string().nullable(),
  user_id: z.string().nullable(),
  account_id: z.string().nullable(),
  created_at: z.string(),
});

export const mondayResources = defineResources({
  monday_board: {
    shape: 'entity',
    filterable: [],
    description:
      'Boards with their name, state, kind, workspace, and item count.',
    endpoint: 'GraphQL query: boards { ... }',
    responses: { boards: z.array(boardSchema) },
  },
  monday_item: {
    shape: 'entity',
    filterable: [],
    description:
      'Board items with their name, state, group, board, column values, and lifecycle timestamps.',
    endpoint: 'GraphQL query: boards { items_page { items { ... } } }',
    responses: { items: z.array(itemSchema) },
  },
  monday_item_activity: {
    shape: 'event',
    filterable: [],
    description:
      'Item activity events derived from each board activity log (creates, updates, status changes), keyed by the originating user.',
    endpoint: 'GraphQL query: boards { activity_logs { ... } }',
    notes:
      'Derived from each board activity log. Activity logs are filtered server-side by date in incremental mode (the from argument) and these append-only events accumulate across syncs. A full sync clears and rewrites the event stream.',
    responses: { activity_logs: z.array(activityLogSchema) },
  },
});

export const id = 'monday';

export class MondayConnector extends BaseConnector<
  MondaySettings,
  MondayCredentials
> {
  static readonly id = id;

  static readonly resources = mondayResources;

  static readonly schemas = schemasFromResources(mondayResources);

  static create(input: unknown, ctx?: ConnectorContext): MondayConnector {
    const parsed = configFields.parse(input);
    return new MondayConnector(
      {
        boardIds: parsed.boardIds,
        resources: parsed.resources,
      },
      { apiToken: parsed.apiToken },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = mondayCredentials;

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: this.creds.apiToken,
      'Content-Type': 'application/json',
      'API-Version': API_VERSION,
      'User-Agent': connectorUserAgent('monday'),
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
    });
    if (res.body.errors && res.body.errors.length > 0) {
      const messages = res.body.errors.map((e) => e.message).join('; ');
      throw new Error(`monday.com GraphQL error: ${messages}`);
    }
    if (!res.body.data) {
      throw new Error(
        `monday.com GraphQL response missing data for resource '${resource}'`,
      );
    }
    return res;
  }

  private fromFilter(options: SyncOptions): string | null {
    return options.mode === 'latest' && options.since ? options.since : null;
  }

  private advanceBoard(b: number): string | null {
    const ids = this.settings.boardIds;
    if (ids && ids.length > 0) {
      return b + 1 < ids.length ? encodeItemsPage(b + 1, null) : null;
    }
    return encodeItemsPage(b + 1, null);
  }

  private advanceBoardLogs(b: number): string | null {
    const ids = this.settings.boardIds;
    if (ids && ids.length > 0) {
      return b + 1 < ids.length ? encodeLogsPage(b + 1, 1) : null;
    }
    return encodeLogsPage(b + 1, 1);
  }

  private async fetchBoardsPage(
    page: string | null,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<{ items: MondayBoard[]; next: string | null }> {
    const ids = this.settings.boardIds;
    if (ids && ids.length > 0) {
      const res = await this.graphql<{ boards: MondayBoard[] }>(
        BOARDS_BY_IDS_QUERY,
        { ids: [...ids], limit: ids.length },
        'boards',
        signal,
      );
      return { items: res.body.data!.boards, next: null };
    }
    const p = page ? Number(page) : 1;
    const limit = clampPageSize(
      options.pageSize,
      DEFAULT_BOARD_PAGE_SIZE,
      MAX_BOARD_PAGE_SIZE,
    );
    const res = await this.graphql<{ boards: MondayBoard[] }>(
      BOARDS_QUERY,
      { limit, page: p },
      'boards',
      signal,
    );
    const boards = res.body.data!.boards;
    return {
      items: boards,
      next: boards.length === limit ? String(p + 1) : null,
    };
  }

  private async fetchItemsPage(
    page: string | null,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<{ items: MondayItem[]; next: string | null }> {
    const { b, c } = decodeItemsPage(page);
    const itemLimit = clampPageSize(
      options.pageSize,
      DEFAULT_ITEM_PAGE_SIZE,
      MAX_ITEM_PAGE_SIZE,
    );

    if (c !== null) {
      const res = await this.graphql<{ next_items_page: MondayItemsPage }>(
        NEXT_ITEMS_QUERY,
        { cursor: c, itemLimit },
        'items',
        signal,
      );
      const pageData = res.body.data!.next_items_page;
      return {
        items: pageData.items,
        next: pageData.cursor
          ? encodeItemsPage(b, pageData.cursor)
          : this.advanceBoard(b),
      };
    }

    const ids = this.settings.boardIds;
    let boards: Array<{ id: string; items_page: MondayItemsPage }>;
    if (ids && ids.length > 0) {
      if (b >= ids.length) {
        return { items: [], next: null };
      }
      const res = await this.graphql<{
        boards: Array<{ id: string; items_page: MondayItemsPage }>;
      }>(
        SCOPED_BOARD_ITEMS_QUERY,
        { ids: [ids[b]], itemLimit },
        'items',
        signal,
      );
      boards = res.body.data!.boards;
    } else {
      const res = await this.graphql<{
        boards: Array<{ id: string; items_page: MondayItemsPage }>;
      }>(
        DISCOVER_BOARD_ITEMS_QUERY,
        { page: b + 1, itemLimit },
        'items',
        signal,
      );
      boards = res.body.data!.boards;
    }

    if (boards.length === 0) {
      return {
        items: [],
        next: ids && ids.length > 0 ? this.advanceBoard(b) : null,
      };
    }
    const itemsPage = boards[0]!.items_page;
    return {
      items: itemsPage.items,
      next: itemsPage.cursor
        ? encodeItemsPage(b, itemsPage.cursor)
        : this.advanceBoard(b),
    };
  }

  private async fetchItemEventsPage(
    page: string | null,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<{ items: EnrichedActivityLog[]; next: string | null }> {
    const { b, p } = decodeLogsPage(page);
    const logLimit = clampPageSize(
      options.pageSize,
      DEFAULT_LOG_PAGE_SIZE,
      MAX_LOG_PAGE_SIZE,
    );
    const from = this.fromFilter(options);
    const ids = this.settings.boardIds;

    let boards: Array<{ id: string; activity_logs: MondayActivityLog[] }>;
    if (ids && ids.length > 0) {
      if (b >= ids.length) {
        return { items: [], next: null };
      }
      const res = await this.graphql<{
        boards: Array<{ id: string; activity_logs: MondayActivityLog[] }>;
      }>(
        SCOPED_BOARD_LOGS_QUERY,
        { ids: [ids[b]], logLimit, logPage: p, from },
        'activity_logs',
        signal,
      );
      boards = res.body.data!.boards;
    } else {
      const res = await this.graphql<{
        boards: Array<{ id: string; activity_logs: MondayActivityLog[] }>;
      }>(
        DISCOVER_BOARD_LOGS_QUERY,
        { page: b + 1, logLimit, logPage: p, from },
        'activity_logs',
        signal,
      );
      boards = res.body.data!.boards;
    }

    if (boards.length === 0) {
      return {
        items: [],
        next: ids && ids.length > 0 ? this.advanceBoardLogs(b) : null,
      };
    }
    const board = boards[0]!;
    const logs = board.activity_logs ?? [];
    const enriched: EnrichedActivityLog[] = logs.map((log) => ({
      ...log,
      boardId: board.id,
    }));
    return {
      items: enriched,
      next:
        logs.length === logLimit
          ? encodeLogsPage(b, p + 1)
          : this.advanceBoardLogs(b),
    };
  }

  private async writeBoards(
    storage: StorageHandle,
    boards: MondayBoard[],
  ): Promise<void> {
    for (const board of boards) {
      const updatedMs = board.updated_at
        ? parseEpoch(board.updated_at, 'iso')
        : null;
      await storage.entity({
        type: 'monday_board',
        id: board.id,
        attributes: {
          name: board.name,
          state: board.state,
          boardKind: board.board_kind,
          description: board.description,
          workspaceId: board.workspace_id,
          itemsCount: board.items_count,
        },
        updated_at: updatedMs ?? 0,
      });
    }
  }

  private async writeItems(
    storage: StorageHandle,
    items: MondayItem[],
    sinceMs: number | null,
  ): Promise<void> {
    for (const item of items) {
      const createdMs = item.created_at
        ? parseEpoch(item.created_at, 'iso')
        : null;
      const updatedMs = item.updated_at
        ? parseEpoch(item.updated_at, 'iso')
        : null;
      if (sinceMs !== null && updatedMs !== null && updatedMs <= sinceMs) {
        continue;
      }
      const columnValues: JSONValue = item.column_values.map((cv) => ({
        id: cv.id,
        text: cv.text,
        value: cv.value,
        type: cv.type,
      }));
      await storage.entity({
        type: 'monday_item',
        id: item.id,
        attributes: {
          name: item.name,
          state: item.state,
          boardId: item.board?.id ?? null,
          groupId: item.group?.id ?? null,
          groupTitle: item.group?.title ?? null,
          columnValues,
          createdAt: createdMs,
        },
        updated_at: updatedMs ?? createdMs ?? 0,
      });
    }
  }

  private async writeItemEvents(
    storage: StorageHandle,
    logs: EnrichedActivityLog[],
    sinceMs: number | null,
  ): Promise<void> {
    for (const log of logs) {
      const ts = parseActivityTs(log.created_at);
      if (ts === null) {
        continue;
      }
      if (sinceMs !== null && ts <= sinceMs) {
        continue;
      }
      await storage.event({
        name: 'monday_item_activity',
        start_ts: ts,
        end_ts: null,
        attributes: {
          activityId: log.id,
          event: log.event,
          entity: log.entity,
          boardId: log.boardId,
          itemId: extractItemId(log.data),
          userId: log.user_id,
          accountId: log.account_id,
        },
      });
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = isMondaySyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';
    const sinceMs =
      options.mode === 'latest' && options.since
        ? new Date(options.since).getTime()
        : null;

    const phases = selectActivePhases<MondayResource, MondayPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<MondayPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      pipeline: true,
      maxChunkMs: CHUNK_BUDGET_MS,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'boards':
            return this.fetchBoardsPage(page, options, sig);
          case 'items':
            return this.fetchItemsPage(page, options, sig);
          case 'item_events':
            return this.fetchItemEventsPage(page, options, sig);
        }
      },
      writeBatch: async (phase, items, page) => {
        if (isFull && page === null) {
          switch (phase) {
            case 'boards':
              await storage.entities([], { types: ['monday_board'] });
              break;
            case 'items':
              await storage.entities([], { types: ['monday_item'] });
              break;
            case 'item_events':
              await storage.events([], { names: ['monday_item_activity'] });
              break;
          }
        }
        switch (phase) {
          case 'boards':
            return this.writeBoards(storage, items as MondayBoard[]);
          case 'items':
            return this.writeItems(storage, items as MondayItem[], sinceMs);
          case 'item_events':
            return this.writeItemEvents(
              storage,
              items as EnrichedActivityLog[],
              sinceMs,
            );
        }
      },
    });
  }
}
