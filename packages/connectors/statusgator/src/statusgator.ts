import {
  type HttpResponse,
  connectorUserAgent,
  parseEpoch,
  sanitizeAllowedUrl,
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
      label: 'API Token',
      description:
        'StatusGator API token. An organization admin can create one under the API section of the StatusGator dashboard.',
      placeholder: 'sg_...',
      secret: true,
    }),
    boardId: z.string().trim().min(1).optional().meta({
      label: 'Board ID',
      description:
        'Restrict the sync to a single StatusGator board. Omit to sync every board on the account.',
      placeholder: '12345',
    }),
    services: z.array(z.string().trim().min(1)).nonempty().optional().meta({
      label: 'Services',
      description:
        'Only sync the named services. Matches a monitor display name, service name, or service slug (case-insensitive). Omit to sync every watched service.',
    }),
    historyLookbackDays: z.number().int().positive().max(365).optional().meta({
      label: 'History lookback (days)',
      description:
        'How many days of status-change history to fetch on a full sync. Defaults to 90.',
      placeholder: '90',
    }),
    resources: z
      .array(z.enum(['services', 'status_changes']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which StatusGator resources to sync. Omit to sync all of them.',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'StatusGator',
  category: 'infrastructure',
  brandColor: '#5C6BC0',
  tagline:
    "Aggregate the public status pages of every SaaS you depend on into a single 'is anything down?' view - current health per service plus the history of status changes across your dependency set.",
  vendor: {
    name: 'StatusGator',
    domain: 'statusgator.com',
    apiDocs: 'https://statusgator.com/api/v3/docs',
    website: 'https://statusgator.com',
  },
  auth: {
    summary:
      'A StatusGator API token is required. Tokens are org-scoped and inherit read access to your boards, monitors, and history.',
    setup: [
      'Sign in to StatusGator as an organization admin.',
      'Open the API section from the main board menu and create an API token.',
      'Store the token as a secret and reference it as `apiKey: secret("STATUSGATOR_API_KEY")`.',
      'Optionally set `boardId` to a single board; omit it to sync every board.',
    ],
  },
  rateLimit:
    'StatusGator paginates boards and monitors at up to 100 rows per page. This connector paginates sequentially and honors 429 Retry-After.',
  limitations: [
    'Website / ping / custom monitor configuration (check intervals, regions, HTTP settings) is out of scope - only the current status and status-change history are synced.',
    'Incidents, subscribers, users, and regions are not synced.',
    'Status-change transitions are derived from board history; the "from" status of the earliest known change for a service is null.',
  ],
});

export type StatusGatorResource = 'services' | 'status_changes';

export interface StatusGatorSettings {
  boardId?: string;
  services?: readonly string[];
  historyLookbackDays?: number;
  resources?: readonly StatusGatorResource[];
}

const statusGatorCredentials = {
  apiKey: {
    description: 'StatusGator API token',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type StatusGatorCredentials = typeof statusGatorCredentials;

const PHASE_ORDER = ['services', 'history'] as const;

type StatusGatorPhase = (typeof PHASE_ORDER)[number];

const isStatusGatorSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

interface SGService {
  id: string;
  name?: string;
  slug?: string;
  home_page_url?: string | null;
  status_page_url?: string | null;
  icon_url?: string | null;
}

interface SGMonitor {
  id: string;
  display_name: string;
  monitor_type?: string;
  filtered_status: string;
  unfiltered_status?: string;
  last_message?: string | null;
  checked_at?: string | null;
  early_warning_signal?: boolean;
  service?: SGService | null;
  created_at?: string;
  updated_at?: string;
}

interface SGHistoryEvent {
  monitor_id: string;
  name?: string;
  status: string;
  started_at: string;
  ended_at?: string | null;
  duration?: string;
  message?: string;
  details?: string;
  early_warning_signal?: boolean;
}

interface SGBoard {
  id: string;
  name?: string;
}

interface SGBoardsResponse {
  success?: boolean;
  data: SGBoard[];
  pagination?: { next_page?: number | null };
}

const idString = z.string().min(1);

const paginationSchema = z
  .object({
    current_page: z.number().int().optional(),
    per_page: z.number().int().optional(),
    total_pages: z.number().int().optional(),
    total_count: z.number().int().optional(),
    next_page: z.number().int().nullable().optional(),
    prev_page: z.number().int().nullable().optional(),
  })
  .optional();

const serviceSchema = z.object({
  id: idString,
  name: z.string().optional(),
  slug: z.string().optional(),
  home_page_url: z.string().nullable().optional(),
  status_page_url: z.string().nullable().optional(),
  icon_url: z.string().nullable().optional(),
});

const monitorSchema = z.object({
  id: idString,
  display_name: z.string(),
  monitor_type: z.string().optional(),
  filtered_status: z.string(),
  unfiltered_status: z.string().optional(),
  last_message: z.string().nullable().optional(),
  checked_at: z.string().nullable().optional(),
  early_warning_signal: z.boolean().optional(),
  service: serviceSchema.nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

const monitorsResponseSchema = z.object({
  success: z.boolean().optional(),
  data: z.array(monitorSchema),
  pagination: paginationSchema,
});

const historyEventSchema = z.object({
  monitor_id: idString,
  name: z.string().optional(),
  status: z.string(),
  started_at: z.string(),
  ended_at: z.string().nullable().optional(),
  duration: z.string().optional(),
  message: z.string().optional(),
  details: z.string().optional(),
  early_warning_signal: z.boolean().optional(),
});

const historyResponseSchema = z.object({
  success: z.boolean().optional(),
  data: z.array(historyEventSchema),
});

export const statusGatorResources = defineResources({
  statusgator_service: {
    shape: 'entity',
    filterable: [],
    description:
      'A service watched on a StatusGator board (the third-party status pages you subscribe to), with its current aggregated health.',
    endpoint: 'GET /boards/{board_id}/monitors',
    fields: [
      { name: 'name', description: 'Monitor display name.' },
      {
        name: 'currentStatus',
        description:
          'Current aggregated status: up | warn | down | maintenance | unknown.',
      },
      {
        name: 'serviceId',
        description:
          'StatusGator catalog service id, when the monitor tracks a known service.',
      },
      {
        name: 'serviceName',
        description: 'Canonical service name from the StatusGator catalog.',
      },
      {
        name: 'serviceSlug',
        description: 'Canonical service slug from the StatusGator catalog.',
      },
      { name: 'homepageUrl', description: 'Service homepage URL.' },
      {
        name: 'statusPageUrl',
        description: 'Public status page URL for the service.',
      },
      {
        name: 'boardId',
        description: 'Id of the board the service is watched on.',
      },
      {
        name: 'lastChangedAt',
        description:
          'When the monitor was last checked / its status last changed (epoch ms).',
      },
    ],
    responses: { monitors: monitorsResponseSchema },
  },
  statusgator_status_change: {
    shape: 'event',
    filterable: [],
    description:
      'A status transition for a watched service, derived from board history. Emitted at the moment the service entered the new status.',
    endpoint: 'GET /boards/{board_id}/history',
    notes:
      'from is the previous status in the history for that service (null for the earliest known change). Bounded by the history lookback window (default 90 days) and tightened to options.since on incremental syncs.',
    fields: [
      {
        name: 'serviceId',
        description: 'Monitor id the transition belongs to.',
      },
      { name: 'serviceName', description: 'Monitor / service name.' },
      {
        name: 'from',
        description:
          'Status the service was in before the transition, or null.',
      },
      {
        name: 'to',
        description: 'Status the service entered at this transition.',
      },
      {
        name: 'boardId',
        description: 'Id of the board the transition was observed on.',
      },
    ],
    responses: { history: historyResponseSchema },
  },
});

const SG_API_HOST = 'statusgator.com';
const SG_API_BASE = `https://${SG_API_HOST}/api/v3`;
const PAGE_SIZE = 100;
const DEFAULT_HISTORY_LOOKBACK_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_BOARD_PAGES = 100;

export const id = 'statusgator';

interface MonitorBatchItem {
  monitor: SGMonitor;
  boardId: string;
  boardName: string | null;
}

interface HistoryBatchItem {
  event: SGHistoryEvent;
  boardId: string;
}

export class StatusGatorConnector extends BaseConnector<
  StatusGatorSettings,
  StatusGatorCredentials
> {
  static readonly id = id;

  static readonly resources = statusGatorResources;

  static readonly schemas = schemasFromResources(statusGatorResources);

  static create(input: unknown, ctx?: ConnectorContext): StatusGatorConnector {
    const parsed = configFields.parse(input);
    return new StatusGatorConnector(
      {
        boardId: parsed.boardId,
        services: parsed.services,
        historyLookbackDays: parsed.historyLookbackDays,
        resources: parsed.resources,
      },
      { apiKey: parsed.apiKey },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = statusGatorCredentials;

  private resolvedBoards: SGBoard[] | null = null;

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.creds.apiKey}`,
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('statusgator'),
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

  private serviceFilter(): Set<string> | null {
    if (!this.settings.services || this.settings.services.length === 0) {
      return null;
    }
    return new Set(this.settings.services.map((s) => s.toLowerCase()));
  }

  private monitorMatches(
    monitor: SGMonitor,
    filter: Set<string> | null,
  ): boolean {
    if (filter === null) {
      return true;
    }
    const candidates = [
      monitor.display_name,
      monitor.service?.name,
      monitor.service?.slug,
    ];
    return candidates.some(
      (c) => typeof c === 'string' && filter.has(c.toLowerCase()),
    );
  }

  private eventMatches(
    event: SGHistoryEvent,
    filter: Set<string> | null,
  ): boolean {
    if (filter === null) {
      return true;
    }
    return (
      typeof event.name === 'string' && filter.has(event.name.toLowerCase())
    );
  }

  private activePhases(): StatusGatorPhase[] {
    return selectActivePhases<StatusGatorResource, StatusGatorPhase>(
      (r) => {
        switch (r) {
          case 'services':
            return 'services';
          case 'status_changes':
            return 'history';
        }
      },
      PHASE_ORDER,
      this.settings.resources,
    );
  }

  private allowedPath(phase: StatusGatorPhase, boardId: string): string {
    switch (phase) {
      case 'services':
        return `/api/v3/boards/${boardId}/monitors`;
      case 'history':
        return `/api/v3/boards/${boardId}/history`;
    }
  }

  private sanitizePageUrl(
    phase: StatusGatorPhase,
    boardId: string,
    pageUrl: string | null,
  ): string | null {
    if (pageUrl === null) {
      return null;
    }
    return sanitizeAllowedUrl({
      url: pageUrl,
      host: SG_API_HOST,
      pathname: this.allowedPath(phase, boardId),
    });
  }

  private buildMonitorsUrl(boardId: string, page: number): string {
    const u = new URL(`${SG_API_BASE}/boards/${boardId}/monitors`);
    u.searchParams.set('page', String(page));
    u.searchParams.set('per_page', String(PAGE_SIZE));
    return u.toString();
  }

  private buildHistoryUrl(
    boardId: string,
    startDate: string,
    endDate: string,
  ): string {
    const u = new URL(`${SG_API_BASE}/boards/${boardId}/history`);
    u.searchParams.set('start_date', startDate);
    u.searchParams.set('end_date', endDate);
    return u.toString();
  }

  private buildBoardsUrl(page: number): string {
    const u = new URL(`${SG_API_BASE}/boards`);
    u.searchParams.set('page', String(page));
    u.searchParams.set('per_page', String(PAGE_SIZE));
    return u.toString();
  }

  private pageNumberFromUrl(url: string): number {
    try {
      const raw = new URL(url).searchParams.get('page');
      const n = raw === null ? 1 : Number.parseInt(raw, 10);
      return Number.isFinite(n) && n >= 1 ? n : 1;
    } catch {
      return 1;
    }
  }

  private async resolveBoards(
    signal: AbortSignal | undefined,
  ): Promise<SGBoard[]> {
    if (this.resolvedBoards) {
      return this.resolvedBoards;
    }
    if (this.settings.boardId) {
      this.resolvedBoards = [{ id: this.settings.boardId }];
      return this.resolvedBoards;
    }
    const boards: SGBoard[] = [];
    for (let page = 1; page <= MAX_BOARD_PAGES; page++) {
      const res = await this.fetch<SGBoardsResponse>(
        this.buildBoardsUrl(page),
        'boards',
        signal,
      );
      const body = res.body;
      for (const b of body.data) {
        boards.push({ id: b.id, name: b.name });
      }
      const nextPage = body.pagination?.next_page ?? null;
      if (nextPage === null || body.data.length < PAGE_SIZE) {
        break;
      }
    }
    this.resolvedBoards = boards;
    return boards;
  }

  private computeHistorySinceMs(options: SyncOptions): number {
    if (options.since) {
      const ms = parseEpoch(options.since, 'iso');
      if (ms !== null) {
        return ms;
      }
    }
    const days =
      this.settings.historyLookbackDays ?? DEFAULT_HISTORY_LOOKBACK_DAYS;
    return Date.now() - days * MS_PER_DAY;
  }

  private isoDate(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
  }

  private async fetchMonitorsPage(
    board: SGBoard,
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<{ items: MonitorBatchItem[]; next: string | null }> {
    const url = page ?? this.buildMonitorsUrl(board.id, 1);
    const res = await this.fetch<z.infer<typeof monitorsResponseSchema>>(
      url,
      'monitors',
      signal,
    );
    const body = res.body;
    const monitors = body.data;
    const hasNext =
      monitors.length >= PAGE_SIZE &&
      (body.pagination?.next_page ?? null) !== null;
    const next = hasNext
      ? this.sanitizePageUrl(
          'services',
          board.id,
          this.buildMonitorsUrl(board.id, this.pageNumberFromUrl(url) + 1),
        )
      : null;
    return {
      items: monitors.map((monitor) => ({
        monitor,
        boardId: board.id,
        boardName: board.name ?? null,
      })),
      next,
    };
  }

  private async fetchHistory(
    board: SGBoard,
    sinceMs: number,
    signal: AbortSignal | undefined,
  ): Promise<{ items: HistoryBatchItem[]; next: string | null }> {
    const url = this.buildHistoryUrl(
      board.id,
      this.isoDate(sinceMs),
      this.isoDate(Date.now()),
    );
    const res = await this.fetch<z.infer<typeof historyResponseSchema>>(
      url,
      'history',
      signal,
    );
    return {
      items: res.body.data.map((event) => ({ event, boardId: board.id })),
      next: null,
    };
  }

  private parseTimestampMs(stamp: string | null | undefined): number | null {
    if (!stamp) {
      return null;
    }
    const ms = Date.parse(stamp);
    return Number.isFinite(ms) ? ms : null;
  }

  private async writeMonitors(
    storage: StorageHandle,
    items: MonitorBatchItem[],
    filter: Set<string> | null,
  ): Promise<void> {
    for (const { monitor, boardId, boardName } of items) {
      if (!this.monitorMatches(monitor, filter)) {
        continue;
      }
      const lastChangedAt =
        this.parseTimestampMs(monitor.checked_at) ??
        this.parseTimestampMs(monitor.updated_at) ??
        this.parseTimestampMs(monitor.created_at) ??
        Date.now();
      await storage.entity({
        type: 'statusgator_service',
        id: monitor.id,
        attributes: {
          name: monitor.display_name,
          currentStatus: monitor.filtered_status,
          unfilteredStatus: monitor.unfiltered_status ?? null,
          monitorType: monitor.monitor_type ?? null,
          serviceId: monitor.service?.id ?? null,
          serviceName: monitor.service?.name ?? null,
          serviceSlug: monitor.service?.slug ?? null,
          homepageUrl: monitor.service?.home_page_url ?? null,
          statusPageUrl: monitor.service?.status_page_url ?? null,
          iconUrl: monitor.service?.icon_url ?? null,
          boardId,
          boardName,
          lastMessage: monitor.last_message ?? null,
          earlyWarningSignal: monitor.early_warning_signal ?? false,
          lastChangedAt,
        },
        updated_at: lastChangedAt,
      });
    }
  }

  private async writeStatusChanges(
    storage: StorageHandle,
    items: HistoryBatchItem[],
    sinceMs: number,
    filter: Set<string> | null,
  ): Promise<void> {
    const byMonitor = new Map<string, HistoryBatchItem[]>();
    for (const item of items) {
      if (!this.eventMatches(item.event, filter)) {
        continue;
      }
      if (this.parseTimestampMs(item.event.started_at) === null) {
        continue;
      }
      const list = byMonitor.get(item.event.monitor_id);
      if (list) {
        list.push(item);
      } else {
        byMonitor.set(item.event.monitor_id, [item]);
      }
    }

    for (const list of byMonitor.values()) {
      list.sort(
        (a, b) =>
          this.parseTimestampMs(a.event.started_at)! -
          this.parseTimestampMs(b.event.started_at)!,
      );
      let prevStatus: string | null = null;
      for (const { event, boardId } of list) {
        const startMs = this.parseTimestampMs(event.started_at)!;
        const endMs = this.parseTimestampMs(event.ended_at);
        if (startMs >= sinceMs) {
          await storage.event({
            name: 'statusgator_status_change',
            start_ts: startMs,
            end_ts: endMs,
            attributes: {
              serviceId: event.monitor_id,
              serviceName: event.name ?? null,
              boardId,
              from: prevStatus,
              to: event.status,
              message: event.message ?? null,
              earlyWarningSignal: event.early_warning_signal ?? false,
            },
          });
        }
        prevStatus = event.status;
      }
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const boards = await this.resolveBoards(signal);
    if (boards.length === 0) {
      return { done: true };
    }

    const cursor = isStatusGatorSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';
    const phases = this.activePhases();
    const historySinceMs = this.computeHistorySinceMs(options);
    const filter = this.serviceFilter();

    return paginateChunked<StatusGatorPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      specCount: () => boards.length,
      fetchPage: async (phase, page, sig, spec) => {
        const board = boards[spec]!;
        switch (phase) {
          case 'services':
            return this.fetchMonitorsPage(
              board,
              this.sanitizePageUrl('services', board.id, page),
              sig,
            );
          case 'history':
            return this.fetchHistory(board, historySinceMs, sig);
        }
      },
      writeBatch: async (phase, items, page, spec) => {
        if (isFull && page === null && spec === 0) {
          switch (phase) {
            case 'services':
              if (this.isResourceEnabled('services')) {
                await storage.entities([], { types: ['statusgator_service'] });
              }
              break;
            case 'history':
              if (this.isResourceEnabled('status_changes')) {
                await storage.events([], {
                  names: ['statusgator_status_change'],
                });
              }
              break;
          }
        }
        switch (phase) {
          case 'services':
            if (!this.isResourceEnabled('services')) {
              return;
            }
            return this.writeMonitors(
              storage,
              items as MonitorBatchItem[],
              filter,
            );
          case 'history':
            if (!this.isResourceEnabled('status_changes')) {
              return;
            }
            return this.writeStatusChanges(
              storage,
              items as HistoryBatchItem[],
              historySinceMs,
              filter,
            );
        }
      },
    });
  }
}
