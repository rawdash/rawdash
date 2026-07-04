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

export const configFields = defineConfigFields(
  z.object({
    apiToken: z.object({ $secret: z.string() }).meta({
      label: 'Personal access token',
      description:
        'Calendly personal access token with read access. Create one under Integrations -> API & Webhooks -> Personal Access Tokens.',
      placeholder: 'eyJraWQiOi...',
      secret: true,
    }),
    organizationUri: z
      .string()
      .url()
      .regex(
        /\/organizations\/[^/]+$/,
        'Organization URI looks like https://api.calendly.com/organizations/AAAAAAAAAAAAAAAA.',
      )
      .meta({
        label: 'Organization URI',
        description:
          'The full Calendly organization URI to sync. Fetch it from GET https://api.calendly.com/users/me (current_organization).',
        placeholder: 'https://api.calendly.com/organizations/AAAAAAAAAAAAAAAA',
      }),
    lookbackDays: z.number().int().positive().optional().meta({
      label: 'Lookback days',
      description:
        'How many days of past scheduled events to sync. Defaults to 90. Events are synced over a rolling window and rewritten on every sync.',
      placeholder: '90',
    }),
    resources: z
      .array(z.enum(['event_types', 'scheduled_events', 'cancellations']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          "Which Calendly resources to sync. Omit to sync all of them. 'cancellations' is derived from the scheduled-events scan, so enabling it without 'scheduled_events' still walks scheduled events but only writes cancellation events.",
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Calendly',
  category: 'sales',
  brandColor: '#006BFF',
  tagline:
    'Sync Calendly event types, scheduled events, and cancellations for booking, no-show, and meeting-mix dashboards.',
  vendor: {
    name: 'Calendly',
    domain: 'calendly.com',
    apiDocs: 'https://developer.calendly.com/api-docs',
    website: 'https://calendly.com',
  },
  auth: {
    summary:
      'Authenticates with a personal access token sent as a Bearer credential. The token inherits the permissions of the account that created it, so use an organization admin to sync organization-wide scheduled events.',
    setup: [
      'Sign in to Calendly and open Integrations -> API & Webhooks -> Personal Access Tokens.',
      'Create a token, give it a name, and copy the value (it is shown only once).',
      'Store the token as a secret and reference it from the connector config as `apiToken: secret("CALENDLY_API_TOKEN")`.',
      'Fetch your organization URI from GET https://api.calendly.com/users/me (the `current_organization` field) and set it as `organizationUri`.',
    ],
  },
  rateLimit:
    'Calendly enforces per-token rate limits and returns HTTP 429 with a Retry-After header when exceeded; the shared HTTP client honors it with backoff. Enabling scheduled events fetches invitees per event, which increases request volume on large windows.',
  limitations: [
    'Scheduled events and cancellations are synced over a rolling window (lookbackDays back through 60 days ahead) and rewritten on every sync, so bookings outside the window age out.',
    'No-show and invitee email are read from the per-event invitees endpoint, so they are only populated when the scheduled_events resource is enabled.',
    'Cancellation events are derived from canceled scheduled events within the window; a cancellation of an event whose start time has aged out of the window is not retained.',
  ],
});

export type CalendlyResource =
  | 'event_types'
  | 'scheduled_events'
  | 'cancellations';

export interface CalendlySettings {
  organizationUri: string;
  lookbackDays?: number;
  resources?: readonly CalendlyResource[];
}

const calendlyCredentials = {
  apiToken: {
    description: 'Calendly personal access token',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type CalendlyCredentials = typeof calendlyCredentials;

const PHASE_ORDER = ['event_types', 'scheduled_events'] as const;

type CalendlyPhase = (typeof PHASE_ORDER)[number];

const isCalendlySyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const iso = z.string();
const uri = z.string().min(1);

const paginationSchema = z.object({
  next_page_token: z.string().nullable().optional(),
});

const eventTypesResponseSchema = z.object({
  collection: z.array(
    z.object({
      uri,
      name: z.string().nullable().optional(),
      active: z.boolean().nullable().optional(),
      slug: z.string().nullable().optional(),
      kind: z.string().nullable().optional(),
      pooling_type: z.string().nullable().optional(),
      duration: z.number().nullable().optional(),
      color: z.string().nullable().optional(),
      scheduling_url: z.string().nullable().optional(),
      created_at: iso.nullable().optional(),
      updated_at: iso,
      profile: z
        .object({
          type: z.string().nullable().optional(),
          name: z.string().nullable().optional(),
          owner: z.string().nullable().optional(),
        })
        .nullable()
        .optional(),
    }),
  ),
  pagination: paginationSchema,
});

const cancellationSchema = z
  .object({
    canceled_by: z.string().nullable().optional(),
    canceler_type: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
    created_at: iso.nullable().optional(),
  })
  .nullable()
  .optional();

const scheduledEventsResponseSchema = z.object({
  collection: z.array(
    z.object({
      uri,
      name: z.string().nullable().optional(),
      status: z.string().nullable().optional(),
      start_time: iso,
      end_time: iso.nullable().optional(),
      created_at: iso.nullable().optional(),
      updated_at: iso.nullable().optional(),
      event_type: z.string().nullable().optional(),
      location: z
        .object({ type: z.string().nullable().optional() })
        .nullable()
        .optional(),
      invitees_counter: z
        .object({
          total: z.number().nullable().optional(),
          active: z.number().nullable().optional(),
          limit: z.number().nullable().optional(),
        })
        .nullable()
        .optional(),
      event_memberships: z
        .array(
          z.object({
            user: z.string().nullable().optional(),
            user_email: z.string().nullable().optional(),
            user_name: z.string().nullable().optional(),
          }),
        )
        .nullable()
        .optional(),
      cancellation: cancellationSchema,
    }),
  ),
  pagination: paginationSchema,
});

const inviteesResponseSchema = z.object({
  collection: z.array(
    z.object({
      uri,
      email: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
      status: z.string().nullable().optional(),
      created_at: iso.nullable().optional(),
      no_show: z
        .object({
          uri: z.string().nullable().optional(),
          created_at: iso.nullable().optional(),
        })
        .nullable()
        .optional(),
    }),
  ),
  pagination: paginationSchema,
});

type EventTypeRecord = z.infer<
  typeof eventTypesResponseSchema
>['collection'][number];
type ScheduledEventRecord = z.infer<
  typeof scheduledEventsResponseSchema
>['collection'][number];
type InviteeRecord = z.infer<
  typeof inviteesResponseSchema
>['collection'][number];

interface ScheduledEventWithContext {
  event: ScheduledEventRecord;
  invitees: InviteeRecord[];
}

export const calendlyResources = defineResources({
  calendly_event_type: {
    shape: 'entity',
    filterable: [
      { field: 'active', ops: ['eq'] },
      { field: 'kind', ops: ['eq'] },
    ],
    description:
      'Event types (meeting templates) in the organization with name, active state, duration, kind, and owner.',
    endpoint: 'GET /event_types?organization={organizationUri}',
    fields: [
      { name: 'name', description: 'Event type name.' },
      { name: 'active', description: 'Whether the event type is active.' },
      { name: 'slug', description: 'URL slug of the event type.' },
      { name: 'kind', description: 'Event type kind (e.g. solo, group).' },
      {
        name: 'poolingType',
        description: 'Pooling type for round-robin/collective types.',
      },
      { name: 'durationMinutes', description: 'Default duration in minutes.' },
      { name: 'color', description: 'Display color.' },
      { name: 'schedulingUrl', description: 'Public scheduling URL.' },
      { name: 'ownerUri', description: 'URI of the owning user or team.' },
      { name: 'ownerType', description: 'Owner type (user or team).' },
      { name: 'createdAt', description: 'Creation time (epoch ms).' },
    ],
    responses: { event_types: eventTypesResponseSchema },
  },
  calendly_scheduled_event: {
    shape: 'event',
    filterable: [],
    description:
      'Scheduled events (bookings) timestamped at their start time, carrying status, event type, host, invitee, and no-show info.',
    endpoint: 'GET /scheduled_events?organization={organizationUri}',
    notes:
      'start_ts is the meeting start time, end_ts the meeting end time. Invitee email and no-show counts come from the per-event invitees endpoint. Timestamps are Unix epoch milliseconds.',
    fields: [
      { name: 'uri', description: 'Calendly scheduled event URI.' },
      { name: 'name', description: 'Event name.' },
      { name: 'eventTypeUri', description: 'URI of the booked event type.' },
      {
        name: 'status',
        description: 'Event status (active or canceled).',
      },
      { name: 'canceled', description: 'Whether the event was canceled.' },
      {
        name: 'inviteeEmail',
        description: 'Email of the primary invitee, if available.',
      },
      { name: 'inviteeName', description: 'Name of the primary invitee.' },
      { name: 'inviteeCount', description: 'Total invitees on the event.' },
      {
        name: 'activeInviteeCount',
        description: 'Invitees that have not canceled.',
      },
      {
        name: 'noShowCount',
        description: 'Number of invitees marked as no-show.',
      },
      { name: 'hostEmail', description: 'Email of the first host.' },
      { name: 'hostName', description: 'Name of the first host.' },
      { name: 'locationType', description: 'Meeting location type.' },
      { name: 'createdAt', description: 'Booking creation time (epoch ms).' },
      { name: 'updatedAt', description: 'Last update time (epoch ms).' },
    ],
    responses: {
      scheduled_events: scheduledEventsResponseSchema,
      event_invitees: inviteesResponseSchema,
    },
  },
  calendly_cancellation: {
    shape: 'event',
    filterable: [],
    description:
      'Cancellation events derived from canceled scheduled events, timestamped at cancellation time with reason and canceler.',
    endpoint: 'GET /scheduled_events?organization={organizationUri}',
    notes:
      'Derived from the scheduled-events scan; one event per canceled scheduled event. start_ts is the cancellation time. Timestamps are Unix epoch milliseconds.',
    fields: [
      { name: 'eventUri', description: 'URI of the canceled scheduled event.' },
      { name: 'eventName', description: 'Name of the canceled event.' },
      { name: 'eventTypeUri', description: 'URI of the booked event type.' },
      { name: 'reason', description: 'Cancellation reason, if provided.' },
      { name: 'canceledBy', description: 'Name of who canceled.' },
      {
        name: 'cancelerType',
        description: 'Whether the host or invitee canceled.',
      },
      {
        name: 'eventStartTime',
        description: 'Start time of the canceled event (epoch ms).',
      },
    ],
    responses: { scheduled_event_cancellations: scheduledEventsResponseSchema },
  },
});

const API_BASE = 'https://api.calendly.com';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 90;
const FORWARD_HORIZON_DAYS = 60;
const EVENT_TYPES_PAGE_SIZE = 100;
const SCHEDULED_EVENTS_PAGE_SIZE = 100;
const INVITEES_PAGE_SIZE = 100;

interface StartWindow {
  minStartTime: string;
  maxStartTime: string;
}

export function getStartWindow(
  lookbackDays: number,
  now: number = Date.now(),
): StartWindow {
  return {
    minStartTime: new Date(now - lookbackDays * MS_PER_DAY).toISOString(),
    maxStartTime: new Date(
      now + FORWARD_HORIZON_DAYS * MS_PER_DAY,
    ).toISOString(),
  };
}

function eventUuid(uri: string): string {
  const trimmed = uri.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export function eventTypeToEntity(record: EventTypeRecord, now: number) {
  return {
    type: 'calendly_event_type' as const,
    id: record.uri,
    attributes: {
      name: record.name ?? null,
      active: record.active ?? null,
      slug: record.slug ?? null,
      kind: record.kind ?? null,
      poolingType: record.pooling_type ?? null,
      durationMinutes: record.duration ?? null,
      color: record.color ?? null,
      schedulingUrl: record.scheduling_url ?? null,
      ownerUri: record.profile?.owner ?? null,
      ownerType: record.profile?.type ?? null,
      createdAt: parseEpoch(record.created_at ?? null, 'iso'),
    } satisfies Record<string, JSONValue>,
    updated_at: parseEpoch(record.updated_at, 'iso') ?? now,
  };
}

export function scheduledEventToEvent(ctx: ScheduledEventWithContext) {
  const { event, invitees } = ctx;
  const startMs = parseEpoch(event.start_time, 'iso') ?? 0;
  const primary = invitees[0];
  const noShowCount = invitees.filter((i) => i.no_show != null).length;
  const host = event.event_memberships?.[0];
  const attributes: Record<string, JSONValue> = {
    uri: event.uri,
    name: event.name ?? null,
    eventTypeUri: event.event_type ?? null,
    status: event.status ?? null,
    canceled: event.status === 'canceled',
    inviteeEmail: primary?.email ?? null,
    inviteeName: primary?.name ?? null,
    inviteeCount: event.invitees_counter?.total ?? invitees.length,
    activeInviteeCount: event.invitees_counter?.active ?? null,
    noShowCount,
    hostEmail: host?.user_email ?? null,
    hostName: host?.user_name ?? null,
    locationType: event.location?.type ?? null,
    createdAt: parseEpoch(event.created_at ?? null, 'iso'),
    updatedAt: parseEpoch(event.updated_at ?? null, 'iso'),
  };
  return {
    name: 'calendly_scheduled_event' as const,
    start_ts: startMs,
    end_ts: parseEpoch(event.end_time ?? null, 'iso'),
    attributes,
  };
}

export function cancellationToEvent(event: ScheduledEventRecord) {
  if (event.status !== 'canceled' || !event.cancellation) {
    return null;
  }
  const startMs = parseEpoch(event.start_time, 'iso');
  const canceledMs =
    parseEpoch(event.cancellation.created_at ?? null, 'iso') ?? startMs ?? 0;
  const attributes: Record<string, JSONValue> = {
    eventUri: event.uri,
    eventName: event.name ?? null,
    eventTypeUri: event.event_type ?? null,
    reason: event.cancellation.reason ?? null,
    canceledBy: event.cancellation.canceled_by ?? null,
    cancelerType: event.cancellation.canceler_type ?? null,
    eventStartTime: startMs,
  };
  return {
    name: 'calendly_cancellation' as const,
    start_ts: canceledMs,
    end_ts: null,
    attributes,
  };
}

export const id = 'calendly';

export class CalendlyConnector extends BaseConnector<
  CalendlySettings,
  CalendlyCredentials
> {
  static readonly id = id;

  static readonly resources = calendlyResources;

  static readonly schemas = schemasFromResources(calendlyResources);

  static create(input: unknown, ctx?: ConnectorContext): CalendlyConnector {
    const parsed = configFields.parse(input);
    return new CalendlyConnector(
      {
        organizationUri: parsed.organizationUri,
        lookbackDays: parsed.lookbackDays,
        resources: parsed.resources,
      },
      { apiToken: parsed.apiToken },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = calendlyCredentials;

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.creds.apiToken}`,
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('calendly'),
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

  private activePhases(): CalendlyPhase[] {
    return selectActivePhases<CalendlyResource, CalendlyPhase>(
      (r) => {
        switch (r) {
          case 'event_types':
            return 'event_types';
          case 'scheduled_events':
          case 'cancellations':
            return 'scheduled_events';
        }
      },
      PHASE_ORDER,
      this.settings.resources,
    );
  }

  private async fetchEventTypesPage(
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<{ items: EventTypeRecord[]; next: string | null }> {
    const u = new URL(`${API_BASE}/event_types`);
    u.searchParams.set('organization', this.settings.organizationUri);
    u.searchParams.set('sort', 'updated_at:desc');
    u.searchParams.set('count', String(EVENT_TYPES_PAGE_SIZE));
    if (page !== null) {
      u.searchParams.set('page_token', page);
    }
    const res = await this.fetch<z.infer<typeof eventTypesResponseSchema>>(
      u.toString(),
      'event_types',
      signal,
    );
    return {
      items: res.body.collection,
      next: res.body.pagination.next_page_token ?? null,
    };
  }

  private async fetchInvitees(
    eventUri: string,
    signal: AbortSignal | undefined,
  ): Promise<InviteeRecord[]> {
    const out: InviteeRecord[] = [];
    let pageToken: string | null = null;
    do {
      signal?.throwIfAborted();
      const u = new URL(
        `${API_BASE}/scheduled_events/${eventUuid(eventUri)}/invitees`,
      );
      u.searchParams.set('count', String(INVITEES_PAGE_SIZE));
      if (pageToken !== null) {
        u.searchParams.set('page_token', pageToken);
      }
      const res: HttpResponse<z.infer<typeof inviteesResponseSchema>> =
        await this.fetch<z.infer<typeof inviteesResponseSchema>>(
          u.toString(),
          'event_invitees',
          signal,
        );
      out.push(...res.body.collection);
      pageToken = res.body.pagination.next_page_token ?? null;
    } while (pageToken !== null);
    return out;
  }

  private async fetchScheduledEventsPage(
    page: string | null,
    window: StartWindow,
    signal: AbortSignal | undefined,
  ): Promise<{ items: ScheduledEventWithContext[]; next: string | null }> {
    const wantInvitees = this.isResourceEnabled('scheduled_events');
    const u = new URL(`${API_BASE}/scheduled_events`);
    u.searchParams.set('organization', this.settings.organizationUri);
    u.searchParams.set('sort', 'start_time:asc');
    u.searchParams.set('min_start_time', window.minStartTime);
    u.searchParams.set('max_start_time', window.maxStartTime);
    u.searchParams.set('count', String(SCHEDULED_EVENTS_PAGE_SIZE));
    if (page !== null) {
      u.searchParams.set('page_token', page);
    }
    const res = await this.fetch<z.infer<typeof scheduledEventsResponseSchema>>(
      u.toString(),
      'scheduled_events',
      signal,
    );
    const items: ScheduledEventWithContext[] = [];
    for (const event of res.body.collection) {
      const invitees = wantInvitees
        ? await this.fetchInvitees(event.uri, signal)
        : [];
      items.push({ event, invitees });
    }
    return {
      items,
      next: res.body.pagination.next_page_token ?? null,
    };
  }

  private async writeEventTypes(
    storage: StorageHandle,
    items: EventTypeRecord[],
  ): Promise<void> {
    const now = Date.now();
    for (const record of items) {
      await storage.entity(eventTypeToEntity(record, now));
    }
  }

  private async writeScheduledEvents(
    storage: StorageHandle,
    items: ScheduledEventWithContext[],
  ): Promise<void> {
    const writeEvents = this.isResourceEnabled('scheduled_events');
    const writeCancellations = this.isResourceEnabled('cancellations');
    for (const ctx of items) {
      if (writeEvents) {
        await storage.event(scheduledEventToEvent(ctx));
      }
      if (writeCancellations) {
        const cancellation = cancellationToEvent(ctx.event);
        if (cancellation) {
          await storage.event(cancellation);
        }
      }
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = isCalendlySyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';
    const lookbackDays = this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const window = getStartWindow(lookbackDays);
    const phases = this.activePhases();

    return paginateChunked<CalendlyPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'event_types':
            return this.fetchEventTypesPage(page, sig);
          case 'scheduled_events':
            return this.fetchScheduledEventsPage(page, window, sig);
        }
      },
      writeBatch: async (phase, items, page) => {
        if (page === null) {
          switch (phase) {
            case 'event_types':
              if (isFull) {
                await storage.entities([], {
                  types: ['calendly_event_type'],
                });
              }
              break;
            case 'scheduled_events':
              if (this.isResourceEnabled('scheduled_events')) {
                await storage.events([], {
                  names: ['calendly_scheduled_event'],
                });
              }
              if (this.isResourceEnabled('cancellations')) {
                await storage.events([], {
                  names: ['calendly_cancellation'],
                });
              }
              break;
          }
        }
        switch (phase) {
          case 'event_types':
            return this.writeEventTypes(storage, items as EventTypeRecord[]);
          case 'scheduled_events':
            return this.writeScheduledEvents(
              storage,
              items as ScheduledEventWithContext[],
            );
        }
      },
    });
  }
}
