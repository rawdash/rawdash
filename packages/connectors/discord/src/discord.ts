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
  type Entity,
  type Event,
  type JSONValue,
  type MetricSample,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
  defineConnectorDoc,
  defineResources,
  makeChunkedCursorGuard,
  paginateChunked,
  schemasFromResources,
} from '@rawdash/core';
import { z } from 'zod';

const guildId = z
  .string()
  .regex(/^\d{17,20}$/, 'Guild ID is a Discord snowflake (17-20 digits).');

export const configFields = defineConfigFields(
  z.object({
    botToken: z.object({ $secret: z.string() }).meta({
      label: 'Bot token',
      description:
        'Discord bot token for a bot installed in the guild. Create an application at the Discord Developer Portal, add a bot, and copy its token.',
      placeholder: 'MTIzNDU2Nzg5...',
      secret: true,
    }),
    guildId: guildId.meta({
      label: 'Guild ID',
      description:
        'The Discord server (guild) ID to sync. Enable Developer Mode in Discord, then right-click the server and choose "Copy Server ID".',
      placeholder: '123456789012345678',
    }),
    lookbackDays: z.number().int().positive().optional().meta({
      label: 'Lookback days',
      description:
        'How many days of message volume and member-removal events to sync. Defaults to 7. Message metrics are rewritten over this rolling window on every sync.',
      placeholder: '7',
    }),
    maxMessagesPerChannel: z.number().int().positive().optional().meta({
      label: 'Max messages per channel',
      description:
        'Safety cap on how many recent messages are scanned per channel per sync. Defaults to 2000.',
      placeholder: '2000',
    }),
    messageChannelIds: z.array(guildId).nonempty().optional().meta({
      label: 'Message channel IDs',
      description:
        'Restrict message-volume scanning to these channel IDs. Omit to scan every readable text channel in the guild.',
    }),
    resources: z
      .array(
        z.enum(['members', 'member_events', 'messages_per_day', 'channels']),
      )
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          "Which Discord resources to sync. Omit to sync all of them. 'member_events' join events are derived from the member scan, so enabling it walks members even when 'members' is not selected.",
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Discord',
  category: 'marketing',
  brandColor: '#5865F2',
  tagline:
    'Sync Discord members, joins and removals, channels, and per-channel message volume for community-health dashboards.',
  vendor: {
    name: 'Discord',
    domain: 'discord.com',
    apiDocs: 'https://discord.com/developers/docs/intro',
    website: 'https://discord.com',
  },
  auth: {
    summary:
      'Authenticates with a bot token sent as a `Bot` credential. The bot must be a member of the guild and, to enumerate members, must have the privileged Server Members Intent enabled and the View Audit Log permission to read member removals.',
    setup: [
      'Open the Discord Developer Portal (https://discord.com/developers/applications) and create an application.',
      'Under Bot, add a bot and copy its token. Enable the "Server Members Intent" toggle so the members endpoint returns data.',
      'Under OAuth2 -> URL Generator, select the `bot` scope with at least "View Channels", "Read Message History", and "View Audit Log" permissions, then install the bot into your server.',
      'Store the token as a secret and reference it from the connector config as `botToken: secret("DISCORD_BOT_TOKEN")`.',
      'Enable Developer Mode in Discord (Settings -> Advanced), right-click your server, choose "Copy Server ID", and set it as `guildId`.',
    ],
  },
  rateLimit:
    'Discord enforces dynamic per-route rate limits and returns HTTP 429 with a Retry-After header when exceeded; the shared HTTP client honors it with backoff. Message-volume scanning fetches recent messages per text channel, so request volume scales with channel count and the lookback window.',
  limitations: [
    'Message volume is derived from the REST message-history endpoint over a rolling lookback window (default 7 days) and is rewritten on every sync, so per-day counts outside the window age out. Scanning is capped per channel by `maxMessagesPerChannel`.',
    "Member join events are derived from each current member's join timestamp; voluntary leaves are only observable via the realtime gateway and are out of scope. Kicks and bans are read from the audit log within the lookback window.",
    'The members endpoint requires the privileged Server Members Intent; without it Discord returns no members and the member and join-event resources stay empty.',
  ],
});

export type DiscordResource =
  | 'members'
  | 'member_events'
  | 'messages_per_day'
  | 'channels';

export interface DiscordSettings {
  guildId: string;
  lookbackDays?: number;
  maxMessagesPerChannel?: number;
  messageChannelIds?: readonly string[];
  resources?: readonly DiscordResource[];
}

const discordCredentials = {
  botToken: {
    description: 'Discord bot token',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type DiscordCredentials = typeof discordCredentials;

const PHASE_ORDER = ['channels', 'members', 'audit', 'messages'] as const;

type DiscordPhase = (typeof PHASE_ORDER)[number];

const isDiscordSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const MEMBER_ENTITY = 'discord_member';
const MEMBER_EVENT = 'discord_member_event';
const CHANNEL_ENTITY = 'discord_channel';
const MESSAGES_METRIC = 'discord_messages_per_day';

const userSchema = z.object({
  id: z.string(),
  username: z.string().nullish(),
  global_name: z.string().nullish(),
  bot: z.boolean().nullish(),
});

const memberSchema = z.object({
  user: userSchema.nullish(),
  nick: z.string().nullish(),
  roles: z.array(z.string()).nullish(),
  joined_at: z.string().nullish(),
});

const membersResponseSchema = z.array(memberSchema);

const channelSchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  type: z.number(),
  position: z.number().nullish(),
  parent_id: z.string().nullish(),
  topic: z.string().nullish(),
  nsfw: z.boolean().nullish(),
});

const channelsResponseSchema = z.array(channelSchema);

const auditEntrySchema = z.object({
  id: z.string(),
  target_id: z.string().nullish(),
  user_id: z.string().nullish(),
  action_type: z.number(),
  reason: z.string().nullish(),
});

const auditLogResponseSchema = z.object({
  audit_log_entries: z.array(auditEntrySchema),
  users: z.array(userSchema).nullish(),
});

const messageSchema = z.object({
  id: z.string(),
  timestamp: z.string().nullish(),
  author: userSchema.nullish(),
});

const messagesResponseSchema = z.array(messageSchema);

type MemberRecord = z.infer<typeof memberSchema>;
type ChannelRecord = z.infer<typeof channelSchema>;
type AuditEntryRecord = z.infer<typeof auditEntrySchema>;
type UserRecord = z.infer<typeof userSchema>;
type MessageRecord = z.infer<typeof messageSchema>;

export const discordResources = defineResources({
  [CHANNEL_ENTITY]: {
    shape: 'entity',
    filterable: [{ field: 'kind', ops: ['eq'] }],
    description:
      'Guild channels with name, kind (text, voice, category, announcement, forum, stage), position, parent category, and topic.',
    endpoint: 'GET /guilds/{guildId}/channels',
    fields: [
      { name: 'name', description: 'Channel name.' },
      {
        name: 'kind',
        description:
          'Channel kind label (text, voice, category, announcement, forum, stage, thread, other).',
      },
      { name: 'type', description: 'Raw Discord channel type number.' },
      { name: 'position', description: 'Sort position within the guild.' },
      { name: 'parentId', description: 'Parent category channel ID, if any.' },
      { name: 'topic', description: 'Channel topic.' },
      { name: 'nsfw', description: 'Whether the channel is marked NSFW.' },
    ],
    responses: { channels: channelsResponseSchema },
  },
  [MEMBER_ENTITY]: {
    shape: 'entity',
    filterable: [{ field: 'isBot', ops: ['eq'] }],
    description:
      'Guild members with username, display name, nickname, join time, roles, and bot flag.',
    endpoint: 'GET /guilds/{guildId}/members',
    notes:
      'Requires the privileged Server Members Intent. Paginated with the `after` cursor. joinedAt is Unix epoch milliseconds.',
    fields: [
      { name: 'username', description: 'Discord username.' },
      { name: 'globalName', description: 'Global display name, if set.' },
      { name: 'nick', description: 'Guild-specific nickname, if set.' },
      { name: 'joinedAt', description: 'Join time (epoch ms).' },
      { name: 'roles', description: 'Role IDs assigned in the guild.' },
      { name: 'isBot', description: 'Whether the member is a bot.' },
    ],
    responses: { members: membersResponseSchema },
  },
  [MEMBER_EVENT]: {
    shape: 'event',
    filterable: [{ field: 'action', ops: ['eq'] }],
    description:
      'Member lifecycle events: joins (derived from member join timestamps) and removals (kicks and bans read from the audit log).',
    endpoint: 'GET /guilds/{guildId}/audit-logs',
    notes:
      'Join events are derived from the member scan and rewritten every sync. Kicks (action_type 20) and bans (action_type 22) come from the audit log within the lookback window. start_ts is the event time in Unix epoch milliseconds. Voluntary leaves require the realtime gateway and are out of scope.',
    fields: [
      {
        name: 'action',
        description: 'Event action: join, kick, or ban.',
      },
      { name: 'userId', description: 'ID of the member the event is about.' },
      { name: 'username', description: 'Username of the member, if known.' },
      {
        name: 'actorId',
        description: 'ID of the moderator who performed a kick or ban.',
      },
      { name: 'reason', description: 'Audit-log reason for a kick or ban.' },
    ],
    responses: { audit_log: auditLogResponseSchema },
  },
  [MESSAGES_METRIC]: {
    shape: 'metric',
    description:
      'Daily message volume per channel from the REST message-history endpoint, one sample per (day, channel). The sample value is the message count; distinct authors is exposed as an attribute.',
    endpoint: 'GET /channels/{channelId}/messages',
    unit: 'messages',
    granularity: '1d',
    notes:
      'Aggregated by UTC day over a rolling lookback window and rewritten on every sync. Only readable text and announcement channels are scanned, capped by maxMessagesPerChannel.',
    dimensions: [
      { name: 'channelId', description: 'Channel ID.' },
      { name: 'channelName', description: 'Channel name.' },
      {
        name: 'distinctAuthors',
        description: 'Number of distinct message authors that day.',
      },
    ],
    responses: { messages: messagesResponseSchema },
  },
});

const API_BASE = 'https://discord.com/api/v10';
const DISCORD_EPOCH = 1420070400000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_MAX_MESSAGES_PER_CHANNEL = 2000;
const MEMBERS_PAGE_SIZE = 1000;
const AUDIT_PAGE_SIZE = 100;
const MESSAGES_PAGE_SIZE = 100;

const AUDIT_ACTION_KICK = 20;
const AUDIT_ACTION_BAN = 22;
const AUDIT_SPECS = [
  { actionType: AUDIT_ACTION_KICK, action: 'kick' as const },
  { actionType: AUDIT_ACTION_BAN, action: 'ban' as const },
];

const TEXT_CHANNEL_TYPES: ReadonlySet<number> = new Set([0, 5]);

export function snowflakeToMs(id: string): number {
  return Number(BigInt(id) >> 22n) + DISCORD_EPOCH;
}

export function channelKindLabel(type: number): string {
  switch (type) {
    case 0:
      return 'text';
    case 1:
    case 3:
      return 'dm';
    case 2:
      return 'voice';
    case 4:
      return 'category';
    case 5:
      return 'announcement';
    case 10:
    case 11:
    case 12:
      return 'thread';
    case 13:
      return 'stage';
    case 15:
      return 'forum';
    default:
      return 'other';
  }
}

export function startOfUtcDay(ms: number): number {
  return Math.floor(ms / MS_PER_DAY) * MS_PER_DAY;
}

export function channelToEntity(record: ChannelRecord, now: number): Entity {
  return {
    type: CHANNEL_ENTITY,
    id: record.id,
    attributes: {
      name: record.name ?? null,
      kind: channelKindLabel(record.type),
      type: record.type,
      position: record.position ?? null,
      parentId: record.parent_id ?? null,
      topic: record.topic ?? null,
      nsfw: record.nsfw ?? null,
    } satisfies Record<string, JSONValue>,
    updated_at: now,
  };
}

export function memberToEntity(record: MemberRecord, now: number): Entity {
  const joinedAt = parseEpoch(record.joined_at ?? null, 'iso');
  return {
    type: MEMBER_ENTITY,
    id: record.user?.id ?? '',
    attributes: {
      username: record.user?.username ?? null,
      globalName: record.user?.global_name ?? null,
      nick: record.nick ?? null,
      joinedAt,
      roles: record.roles ?? [],
      isBot: record.user?.bot ?? false,
    } satisfies Record<string, JSONValue>,
    updated_at: joinedAt ?? now,
  };
}

export function memberToJoinEvent(record: MemberRecord): Event | null {
  const joinedAt = parseEpoch(record.joined_at ?? null, 'iso');
  if (joinedAt === null || !record.user?.id) {
    return null;
  }
  return {
    name: MEMBER_EVENT,
    start_ts: joinedAt,
    end_ts: null,
    attributes: {
      action: 'join',
      userId: record.user.id,
      username: record.user.username ?? null,
      actorId: null,
      reason: null,
    },
  };
}

export function auditEntryToEvent(
  entry: AuditEntryRecord,
  action: 'kick' | 'ban',
  users: Map<string, UserRecord>,
): Event | null {
  if (!entry.target_id) {
    return null;
  }
  return {
    name: MEMBER_EVENT,
    start_ts: snowflakeToMs(entry.id),
    end_ts: null,
    attributes: {
      action,
      userId: entry.target_id,
      username: users.get(entry.target_id)?.username ?? null,
      actorId: entry.user_id ?? null,
      reason: entry.reason ?? null,
    },
  };
}

interface MessageBucketKey {
  channelId: string;
  channelName: string | null;
  dayMs: number;
}

export function bucketMessagesPerDay(
  channels: Array<{
    id: string;
    name: string | null;
    messages: MessageRecord[];
  }>,
  windowStart: number,
): MetricSample[] {
  const counts = new Map<string, number>();
  const authors = new Map<string, Set<string>>();
  const meta = new Map<string, MessageBucketKey>();
  for (const channel of channels) {
    for (const message of channel.messages) {
      const ts = parseEpoch(message.timestamp ?? null, 'iso');
      if (ts === null || ts < windowStart) {
        continue;
      }
      const dayMs = startOfUtcDay(ts);
      const key = `${channel.id}|${dayMs}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!authors.has(key)) {
        authors.set(key, new Set<string>());
      }
      if (message.author?.id) {
        authors.get(key)!.add(message.author.id);
      }
      if (!meta.has(key)) {
        meta.set(key, {
          channelId: channel.id,
          channelName: channel.name,
          dayMs,
        });
      }
    }
  }
  const samples: MetricSample[] = [];
  for (const [key, info] of meta) {
    samples.push({
      name: MESSAGES_METRIC,
      ts: info.dayMs,
      value: counts.get(key) ?? 0,
      attributes: {
        channelId: info.channelId,
        channelName: info.channelName,
        distinctAuthors: authors.get(key)?.size ?? 0,
      },
    });
  }
  return samples;
}

export const id = 'discord';

export class DiscordConnector extends BaseConnector<
  DiscordSettings,
  DiscordCredentials
> {
  static readonly id = id;

  static readonly resources = discordResources;

  static readonly schemas = schemasFromResources(discordResources);

  static create(input: unknown, ctx?: ConnectorContext): DiscordConnector {
    const parsed = configFields.parse(input);
    return new DiscordConnector(
      {
        guildId: parsed.guildId,
        lookbackDays: parsed.lookbackDays,
        maxMessagesPerChannel: parsed.maxMessagesPerChannel,
        messageChannelIds: parsed.messageChannelIds,
        resources: parsed.resources,
      },
      { botToken: parsed.botToken },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = discordCredentials;

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bot ${this.creds.botToken}`,
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('discord'),
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

  private get lookbackDays(): number {
    return this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  }

  private get maxMessagesPerChannel(): number {
    return (
      this.settings.maxMessagesPerChannel ?? DEFAULT_MAX_MESSAGES_PER_CHANNEL
    );
  }

  private activePhases(): DiscordPhase[] {
    const wantChannels = this.isResourceEnabled('channels');
    const wantMembers = this.isResourceEnabled('members');
    const wantMemberEvents = this.isResourceEnabled('member_events');
    const wantMessages = this.isResourceEnabled('messages_per_day');
    return PHASE_ORDER.filter((phase) => {
      switch (phase) {
        case 'channels':
          return wantChannels;
        case 'members':
          return wantMembers || wantMemberEvents;
        case 'audit':
          return wantMemberEvents;
        case 'messages':
          return wantMessages;
      }
    });
  }

  private async fetchChannels(
    signal: AbortSignal | undefined,
  ): Promise<ChannelRecord[]> {
    const res = await this.fetch<z.infer<typeof channelsResponseSchema>>(
      `${API_BASE}/guilds/${this.settings.guildId}/channels`,
      'channels',
      signal,
    );
    return res.body;
  }

  private async fetchMembersPage(
    after: string | null,
    signal: AbortSignal | undefined,
  ): Promise<{ items: MemberRecord[]; next: string | null }> {
    const u = new URL(`${API_BASE}/guilds/${this.settings.guildId}/members`);
    u.searchParams.set('limit', String(MEMBERS_PAGE_SIZE));
    if (after !== null) {
      u.searchParams.set('after', after);
    }
    const res = await this.fetch<z.infer<typeof membersResponseSchema>>(
      u.toString(),
      'members',
      signal,
    );
    const items = res.body;
    const last = items[items.length - 1];
    const next =
      items.length < MEMBERS_PAGE_SIZE || !last?.user?.id ? null : last.user.id;
    return { items, next };
  }

  private async fetchAuditPage(
    actionType: number,
    before: string | null,
    windowStart: number,
    signal: AbortSignal | undefined,
  ): Promise<{ items: AuditEntryRecord[]; next: string | null }> {
    const u = new URL(`${API_BASE}/guilds/${this.settings.guildId}/audit-logs`);
    u.searchParams.set('action_type', String(actionType));
    u.searchParams.set('limit', String(AUDIT_PAGE_SIZE));
    if (before !== null) {
      u.searchParams.set('before', before);
    }
    const res = await this.fetch<z.infer<typeof auditLogResponseSchema>>(
      u.toString(),
      'audit_log',
      signal,
    );
    const users = new Map<string, UserRecord>();
    for (const user of res.body.users ?? []) {
      users.set(user.id, user);
    }
    (this.auditUsers ??= new Map<string, UserRecord>()).clear();
    for (const [uid, user] of users) {
      this.auditUsers.set(uid, user);
    }
    const inWindow = res.body.audit_log_entries.filter(
      (entry) => snowflakeToMs(entry.id) >= windowStart,
    );
    const last =
      res.body.audit_log_entries[res.body.audit_log_entries.length - 1];
    const reachedEnd =
      res.body.audit_log_entries.length < AUDIT_PAGE_SIZE ||
      inWindow.length < res.body.audit_log_entries.length ||
      !last;
    return { items: inWindow, next: reachedEnd ? null : last!.id };
  }

  private auditUsers: Map<string, UserRecord> | undefined;

  private async fetchMessageVolume(
    signal: AbortSignal | undefined,
  ): Promise<MetricSample[]> {
    const windowStart = startOfUtcDay(
      Date.now() - this.lookbackDays * MS_PER_DAY,
    );
    const channels = await this.fetchChannels(signal);
    const allow = this.settings.messageChannelIds
      ? new Set(this.settings.messageChannelIds)
      : null;
    const targets = channels.filter(
      (c) =>
        TEXT_CHANNEL_TYPES.has(c.type) && (allow === null || allow.has(c.id)),
    );
    const scanned: Array<{
      id: string;
      name: string | null;
      messages: MessageRecord[];
    }> = [];
    for (const channel of targets) {
      signal?.throwIfAborted();
      const messages = await this.fetchChannelMessages(
        channel.id,
        windowStart,
        signal,
      );
      scanned.push({ id: channel.id, name: channel.name ?? null, messages });
    }
    return bucketMessagesPerDay(scanned, windowStart);
  }

  private async fetchChannelMessages(
    channelId: string,
    windowStart: number,
    signal: AbortSignal | undefined,
  ): Promise<MessageRecord[]> {
    const out: MessageRecord[] = [];
    let before: string | null = null;
    while (out.length < this.maxMessagesPerChannel) {
      signal?.throwIfAborted();
      const u = new URL(`${API_BASE}/channels/${channelId}/messages`);
      u.searchParams.set('limit', String(MESSAGES_PAGE_SIZE));
      if (before !== null) {
        u.searchParams.set('before', before);
      }
      const res: HttpResponse<z.infer<typeof messagesResponseSchema>> =
        await this.fetch<z.infer<typeof messagesResponseSchema>>(
          u.toString(),
          'messages',
          signal,
        );
      const batch = res.body;
      if (batch.length === 0) {
        break;
      }
      let reachedWindow = false;
      for (const message of batch) {
        const ts = parseEpoch(message.timestamp ?? null, 'iso');
        if (ts !== null && ts < windowStart) {
          reachedWindow = true;
          continue;
        }
        out.push(message);
      }
      const last = batch[batch.length - 1];
      if (reachedWindow || batch.length < MESSAGES_PAGE_SIZE || !last) {
        break;
      }
      before = last.id;
    }
    return out;
  }

  private async writeChannels(
    storage: StorageHandle,
    items: ChannelRecord[],
  ): Promise<void> {
    const now = Date.now();
    for (const record of items) {
      await storage.entity(channelToEntity(record, now));
    }
  }

  private async writeMembers(
    storage: StorageHandle,
    items: MemberRecord[],
  ): Promise<void> {
    const writeEntities = this.isResourceEnabled('members');
    const writeJoins = this.isResourceEnabled('member_events');
    const now = Date.now();
    for (const record of items) {
      if (writeEntities && record.user?.id) {
        await storage.entity(memberToEntity(record, now));
      }
      if (writeJoins) {
        const join = memberToJoinEvent(record);
        if (join) {
          await storage.event(join);
        }
      }
    }
  }

  private async writeAudit(
    storage: StorageHandle,
    items: AuditEntryRecord[],
    action: 'kick' | 'ban',
  ): Promise<void> {
    const users = this.auditUsers ?? new Map<string, UserRecord>();
    for (const entry of items) {
      const event = auditEntryToEvent(entry, action, users);
      if (event) {
        await storage.event(event);
      }
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = isDiscordSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';
    const phases = this.activePhases();
    const messagesWindowStart = startOfUtcDay(
      Date.now() - this.lookbackDays * MS_PER_DAY,
    );

    return paginateChunked<DiscordPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      specCount: (phase) => (phase === 'audit' ? AUDIT_SPECS.length : 1),
      fetchPage: async (phase, page, sig, spec) => {
        switch (phase) {
          case 'channels':
            return { items: await this.fetchChannels(sig), next: null };
          case 'members':
            return this.fetchMembersPage(page, sig);
          case 'audit':
            return this.fetchAuditPage(
              AUDIT_SPECS[spec]!.actionType,
              page,
              messagesWindowStart,
              sig,
            );
          case 'messages':
            return { items: await this.fetchMessageVolume(sig), next: null };
        }
      },
      writeBatch: async (phase, items, page, spec) => {
        if (page === null) {
          switch (phase) {
            case 'channels':
              if (isFull) {
                await storage.entities([], { types: [CHANNEL_ENTITY] });
              }
              break;
            case 'members':
              if (isFull && this.isResourceEnabled('members')) {
                await storage.entities([], { types: [MEMBER_ENTITY] });
              }
              if (this.isResourceEnabled('member_events')) {
                await storage.events([], { names: [MEMBER_EVENT] });
              }
              break;
            case 'audit':
            case 'messages':
              break;
          }
        }
        switch (phase) {
          case 'channels':
            return this.writeChannels(storage, items as ChannelRecord[]);
          case 'members':
            return this.writeMembers(storage, items as MemberRecord[]);
          case 'audit':
            return this.writeAudit(
              storage,
              items as AuditEntryRecord[],
              AUDIT_SPECS[spec]!.action,
            );
          case 'messages':
            return storage.metrics(items as MetricSample[], {
              names: [MESSAGES_METRIC],
              replaceWindow: {
                start: messagesWindowStart,
                end: Date.now(),
              },
            });
        }
      },
    });
  }
}
