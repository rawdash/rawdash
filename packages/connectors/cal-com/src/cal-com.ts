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
    apiKey: z.object({ $secret: z.string() }).meta({
      label: 'API key',
      description:
        'Cal.com API key with read access. Create one under Settings -> Developer -> API keys. Keys are prefixed with cal_.',
      placeholder: 'cal_live_...',
      secret: true,
    }),
    apiBaseUrl: z.string().url().optional().meta({
      label: 'API base URL',
      description:
        'Base URL of the Cal.com API. Defaults to https://api.cal.com. Set this to your instance API URL when self-hosting.',
      placeholder: 'https://api.cal.com',
    }),
    lookbackDays: z.number().int().positive().optional().meta({
      label: 'Lookback days',
      description:
        'How many days of past bookings to sync. Defaults to 90. Bookings are synced over a rolling window and rewritten on every sync.',
      placeholder: '90',
    }),
    resources: z
      .array(z.enum(['event_types', 'bookings', 'cancellations']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          "Which Cal.com resources to sync. Omit to sync all of them. 'cancellations' is derived from the bookings scan, so enabling it without 'bookings' still walks bookings but only writes cancellation events.",
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Cal.com',
  category: 'sales',
  brandColor: '#292929',
  tagline:
    'Sync Cal.com event types, bookings, and cancellations for booking-volume, no-show, and meeting-mix dashboards.',
  vendor: {
    name: 'Cal.com',
    domain: 'cal.com',
    apiDocs: 'https://cal.com/docs/api-reference/v2/introduction',
    website: 'https://cal.com',
  },
  auth: {
    summary:
      'Authenticates with a Cal.com API key sent as a Bearer credential. The key inherits the permissions of the account that created it, so use an account with visibility into the event types and bookings you want to sync.',
    setup: [
      'Sign in to Cal.com and open Settings -> Developer -> API keys.',
      'Create an API key, give it a name, and copy the value (it is shown only once). Keys are prefixed with cal_.',
      'Store the key as a secret and reference it from the connector config as `apiKey: secret("CAL_API_KEY")`.',
      'When self-hosting Cal.com, set `apiBaseUrl` to your instance API URL (for example https://cal.example.com/api/v2 without the trailing /v2). It defaults to https://api.cal.com.',
    ],
  },
  rateLimit:
    'Cal.com enforces per-key rate limits and returns HTTP 429 with a Retry-After header when exceeded; the shared HTTP client honors it with backoff.',
  limitations: [
    'Bookings and cancellations are synced over a rolling window (lookbackDays back through 60 days ahead) and rewritten on every sync, so bookings outside the window age out.',
    'Cancellation events are timestamped at the booking-record update time, since Cal.com does not expose a distinct cancellation timestamp.',
    'No-show counts are read from the per-booking attendee absence flags, so they only reflect hosts marking attendees absent.',
  ],
});

export type CalComResource = 'event_types' | 'bookings' | 'cancellations';

export interface CalComSettings {
  apiBaseUrl?: string;
  lookbackDays?: number;
  resources?: readonly CalComResource[];
}

const calComCredentials = {
  apiKey: {
    description: 'Cal.com API key',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type CalComCredentials = typeof calComCredentials;

const PHASE_ORDER = ['event_types', 'bookings'] as const;

type CalComPhase = (typeof PHASE_ORDER)[number];

const isCalComSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const iso = z.string();

interface MeResponse {
  data?: {
    username?: string | null;
    id?: number | null;
    organizationId?: number | null;
  } | null;
}

const eventTypeSchema = z.object({
  id: z.number(),
  title: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  lengthInMinutes: z.number().nullable().optional(),
  hidden: z.boolean().nullable().optional(),
  price: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  ownerId: z.number().nullable().optional(),
});

const eventTypesResponseSchema = z.object({
  data: z.array(eventTypeSchema),
});

const attendeeSchema = z.object({
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  timeZone: z.string().nullable().optional(),
  absent: z.boolean().nullable().optional(),
  phoneNumber: z.string().nullable().optional(),
});

const hostSchema = z.object({
  id: z.number().nullable().optional(),
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  timeZone: z.string().nullable().optional(),
});

const bookingSchema = z.object({
  id: z.number().nullable().optional(),
  uid: z.string(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  start: iso,
  end: iso.nullable().optional(),
  duration: z.number().nullable().optional(),
  eventTypeId: z.number().nullable().optional(),
  eventType: z
    .object({
      id: z.number().nullable().optional(),
      slug: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  location: z.string().nullable().optional(),
  hosts: z.array(hostSchema).nullable().optional(),
  attendees: z.array(attendeeSchema).nullable().optional(),
  cancellationReason: z.string().nullable().optional(),
  cancelledByEmail: z.string().nullable().optional(),
  createdAt: iso.nullable().optional(),
  updatedAt: iso.nullable().optional(),
});

const paginationSchema = z
  .object({
    nextCursor: z.union([z.string(), z.number()]).nullable().optional(),
    hasMore: z.boolean().nullable().optional(),
  })
  .nullable()
  .optional();

const bookingsResponseSchema = z.object({
  data: z.array(bookingSchema),
  pagination: paginationSchema,
});

type EventTypeRecord = z.infer<typeof eventTypeSchema>;
type BookingRecord = z.infer<typeof bookingSchema>;

export const calComResources = defineResources({
  cal_com_event_type: {
    shape: 'entity',
    filterable: [{ field: 'hidden', ops: ['eq'] }],
    description:
      'Event types (meeting templates) owned by the account, with title, slug, length, price, and visibility.',
    endpoint: 'GET /v2/event-types',
    fields: [
      { name: 'title', description: 'Event type title.' },
      { name: 'slug', description: 'URL slug of the event type.' },
      { name: 'description', description: 'Event type description.' },
      { name: 'lengthMinutes', description: 'Default duration in minutes.' },
      { name: 'hidden', description: 'Whether the event type is hidden.' },
      { name: 'price', description: 'Booking price in minor currency units.' },
      { name: 'currency', description: 'Currency code for the price.' },
      { name: 'ownerId', description: 'Numeric id of the owning user.' },
    ],
    responses: { event_types: eventTypesResponseSchema },
  },
  cal_com_booking: {
    shape: 'event',
    filterable: [],
    description:
      'Bookings timestamped at their start time, carrying status, event type, host, attendee, and no-show info.',
    endpoint: 'GET /v2/bookings',
    notes:
      'start_ts is the booking start time, end_ts the end time. Attendee and no-show info come from the booking attendee list. Timestamps are Unix epoch milliseconds.',
    fields: [
      { name: 'uid', description: 'Cal.com booking uid.' },
      { name: 'title', description: 'Booking title.' },
      {
        name: 'status',
        description:
          'Booking status (accepted, pending, rejected, or cancelled).',
      },
      { name: 'cancelled', description: 'Whether the booking was cancelled.' },
      {
        name: 'eventTypeId',
        description: 'Numeric id of the booked event type.',
      },
      { name: 'eventTypeSlug', description: 'Slug of the booked event type.' },
      { name: 'attendeeEmail', description: 'Email of the primary attendee.' },
      { name: 'attendeeName', description: 'Name of the primary attendee.' },
      {
        name: 'attendeeCount',
        description: 'Number of attendees on the booking.',
      },
      {
        name: 'noShowCount',
        description: 'Number of attendees marked absent.',
      },
      { name: 'hostEmail', description: 'Email of the first host.' },
      { name: 'hostName', description: 'Name of the first host.' },
      { name: 'location', description: 'Meeting location or URL.' },
      { name: 'durationMinutes', description: 'Booking duration in minutes.' },
      { name: 'createdAt', description: 'Booking creation time (epoch ms).' },
      { name: 'updatedAt', description: 'Last update time (epoch ms).' },
    ],
    responses: { bookings: bookingsResponseSchema },
  },
  cal_com_cancellation: {
    shape: 'event',
    filterable: [],
    description:
      'Cancellation events derived from cancelled bookings, timestamped at cancellation time with reason and canceller.',
    endpoint: 'GET /v2/bookings',
    notes:
      'Derived from the bookings scan; one event per cancelled booking. start_ts is the booking update time (cancellation time). Timestamps are Unix epoch milliseconds.',
    fields: [
      { name: 'bookingUid', description: 'Uid of the cancelled booking.' },
      { name: 'title', description: 'Title of the cancelled booking.' },
      {
        name: 'eventTypeId',
        description: 'Numeric id of the booked event type.',
      },
      { name: 'reason', description: 'Cancellation reason, if provided.' },
      {
        name: 'cancelledByEmail',
        description: 'Email of who cancelled the booking.',
      },
      {
        name: 'bookingStartTime',
        description: 'Start time of the cancelled booking (epoch ms).',
      },
    ],
    responses: { booking_cancellations: bookingsResponseSchema },
  },
});

const API_BASE_DEFAULT = 'https://api.cal.com';
const ME_API_VERSION = '2024-06-14';
const EVENT_TYPES_API_VERSION = '2024-06-14';
const BOOKINGS_API_VERSION = '2024-08-13';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 90;
const FORWARD_HORIZON_DAYS = 60;
const BOOKINGS_PAGE_SIZE = 100;

interface BookingWindow {
  afterStart: string;
  beforeEnd: string;
}

export function getBookingWindow(
  lookbackDays: number,
  now: number = Date.now(),
): BookingWindow {
  return {
    afterStart: new Date(now - lookbackDays * MS_PER_DAY).toISOString(),
    beforeEnd: new Date(now + FORWARD_HORIZON_DAYS * MS_PER_DAY).toISOString(),
  };
}

function bookingEventTypeId(record: BookingRecord): number | null {
  return record.eventType?.id ?? record.eventTypeId ?? null;
}

export function eventTypeToEntity(record: EventTypeRecord, now: number) {
  return {
    type: 'cal_com_event_type' as const,
    id: String(record.id),
    attributes: {
      title: record.title ?? null,
      slug: record.slug ?? null,
      description: record.description ?? null,
      lengthMinutes: record.lengthInMinutes ?? null,
      hidden: record.hidden ?? null,
      price: record.price ?? null,
      currency: record.currency ?? null,
      ownerId: record.ownerId ?? null,
    } satisfies Record<string, JSONValue>,
    updated_at: now,
  };
}

export function bookingToEvent(record: BookingRecord) {
  const startMs = parseEpoch(record.start, 'iso') ?? 0;
  const attendees = record.attendees ?? [];
  const primary = attendees[0];
  const noShowCount = attendees.filter((a) => a.absent === true).length;
  const host = record.hosts?.[0];
  const attributes: Record<string, JSONValue> = {
    uid: record.uid,
    title: record.title ?? null,
    status: record.status ?? null,
    cancelled: record.status === 'cancelled',
    eventTypeId: bookingEventTypeId(record),
    eventTypeSlug: record.eventType?.slug ?? null,
    attendeeEmail: primary?.email ?? null,
    attendeeName: primary?.name ?? null,
    attendeeCount: attendees.length,
    noShowCount,
    hostEmail: host?.email ?? null,
    hostName: host?.name ?? null,
    location: record.location ?? null,
    durationMinutes: record.duration ?? null,
    createdAt: parseEpoch(record.createdAt ?? null, 'iso'),
    updatedAt: parseEpoch(record.updatedAt ?? null, 'iso'),
  };
  return {
    name: 'cal_com_booking' as const,
    start_ts: startMs,
    end_ts: parseEpoch(record.end ?? null, 'iso'),
    attributes,
  };
}

export function cancellationToEvent(record: BookingRecord) {
  if (record.status !== 'cancelled') {
    return null;
  }
  const startMs = parseEpoch(record.start, 'iso');
  const cancelledMs =
    parseEpoch(record.updatedAt ?? null, 'iso') ?? startMs ?? 0;
  const attributes: Record<string, JSONValue> = {
    bookingUid: record.uid,
    title: record.title ?? null,
    eventTypeId: bookingEventTypeId(record),
    reason: record.cancellationReason ?? null,
    cancelledByEmail: record.cancelledByEmail ?? null,
    bookingStartTime: startMs,
  };
  return {
    name: 'cal_com_cancellation' as const,
    start_ts: cancelledMs,
    end_ts: null,
    attributes,
  };
}

export const id = 'cal-com';

export class CalComConnector extends BaseConnector<
  CalComSettings,
  CalComCredentials
> {
  static readonly id = id;

  static readonly resources = calComResources;

  static readonly schemas = schemasFromResources(calComResources);

  static create(input: unknown, ctx?: ConnectorContext): CalComConnector {
    const parsed = configFields.parse(input);
    return new CalComConnector(
      {
        apiBaseUrl: parsed.apiBaseUrl,
        lookbackDays: parsed.lookbackDays,
        resources: parsed.resources,
      },
      { apiKey: parsed.apiKey },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = calComCredentials;

  private baseUrl(): string {
    return (this.settings.apiBaseUrl ?? API_BASE_DEFAULT).replace(/\/+$/, '');
  }

  private buildHeaders(version: string): Record<string, string> {
    return {
      Authorization: `Bearer ${this.creds.apiKey}`,
      Accept: 'application/json',
      'cal-api-version': version,
      'User-Agent': connectorUserAgent('cal-com'),
    };
  }

  private fetch<T>(
    url: string,
    resource: string,
    version: string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.get<T>(url, {
      resource,
      headers: this.buildHeaders(version),
      signal,
    });
  }

  private activePhases(): CalComPhase[] {
    return selectActivePhases<CalComResource, CalComPhase>(
      (r) => {
        switch (r) {
          case 'event_types':
            return 'event_types';
          case 'bookings':
          case 'cancellations':
            return 'bookings';
        }
      },
      PHASE_ORDER,
      this.settings.resources,
    );
  }

  private async resolveUsername(
    signal: AbortSignal | undefined,
  ): Promise<string | null> {
    const res = await this.fetch<MeResponse>(
      `${this.baseUrl()}/v2/me`,
      'me',
      ME_API_VERSION,
      signal,
    );
    return res.body.data?.username ?? null;
  }

  private async fetchEventTypesPage(
    signal: AbortSignal | undefined,
  ): Promise<{ items: EventTypeRecord[]; next: string | null }> {
    const username = await this.resolveUsername(signal);
    const u = new URL(`${this.baseUrl()}/v2/event-types`);
    if (username !== null) {
      u.searchParams.set('username', username);
    }
    const res = await this.fetch<z.infer<typeof eventTypesResponseSchema>>(
      u.toString(),
      'event_types',
      EVENT_TYPES_API_VERSION,
      signal,
    );
    return { items: res.body.data, next: null };
  }

  private async fetchBookingsPage(
    page: string | null,
    window: BookingWindow,
    signal: AbortSignal | undefined,
  ): Promise<{ items: BookingRecord[]; next: string | null }> {
    const u = new URL(`${this.baseUrl()}/v2/bookings`);
    u.searchParams.set('afterStart', window.afterStart);
    u.searchParams.set('beforeEnd', window.beforeEnd);
    u.searchParams.set('sortStart', 'asc');
    u.searchParams.set('limit', String(BOOKINGS_PAGE_SIZE));
    if (page !== null) {
      u.searchParams.set('cursor', page);
    }
    const res = await this.fetch<z.infer<typeof bookingsResponseSchema>>(
      u.toString(),
      'bookings',
      BOOKINGS_API_VERSION,
      signal,
    );
    const nextCursor = res.body.pagination?.nextCursor ?? null;
    const hasMore = res.body.pagination?.hasMore;
    const next =
      nextCursor === null || hasMore === false ? null : String(nextCursor);
    return { items: res.body.data, next };
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

  private async writeBookings(
    storage: StorageHandle,
    items: BookingRecord[],
  ): Promise<void> {
    const writeBookingEvents = this.isResourceEnabled('bookings');
    const writeCancellations = this.isResourceEnabled('cancellations');
    for (const record of items) {
      if (writeBookingEvents) {
        await storage.event(bookingToEvent(record));
      }
      if (writeCancellations) {
        const cancellation = cancellationToEvent(record);
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
    const cursor = isCalComSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';
    const lookbackDays = this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const window = getBookingWindow(lookbackDays);
    const phases = this.activePhases();

    return paginateChunked<CalComPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'event_types':
            return this.fetchEventTypesPage(sig);
          case 'bookings':
            return this.fetchBookingsPage(page, window, sig);
        }
      },
      writeBatch: async (phase, items, page) => {
        if (page === null) {
          switch (phase) {
            case 'event_types':
              if (isFull) {
                await storage.entities([], {
                  types: ['cal_com_event_type'],
                });
              }
              break;
            case 'bookings':
              if (this.isResourceEnabled('bookings')) {
                await storage.events([], { names: ['cal_com_booking'] });
              }
              if (this.isResourceEnabled('cancellations')) {
                await storage.events([], { names: ['cal_com_cancellation'] });
              }
              break;
          }
        }
        switch (phase) {
          case 'event_types':
            return this.writeEventTypes(storage, items as EventTypeRecord[]);
          case 'bookings':
            return this.writeBookings(storage, items as BookingRecord[]);
        }
      },
    });
  }
}
