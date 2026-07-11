import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DiscordConnector,
  bucketMessagesPerDay,
  channelKindLabel,
  configFields,
  snowflakeToMs,
  startOfUtcDay,
} from './discord';

const GUILD = '123456789012345678';

describe('configFields', () => {
  it('parses a valid config', () => {
    const result = configFields.safeParse({
      botToken: { $secret: 'DISCORD_BOT_TOKEN' },
      guildId: GUILD,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a config missing botToken', () => {
    const result = configFields.safeParse({ guildId: GUILD });
    expect(result.success).toBe(false);
  });

  it('rejects a botToken passed as a plain string', () => {
    const result = configFields.safeParse({
      botToken: 'plain-token',
      guildId: GUILD,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a guildId that is not a snowflake', () => {
    const result = configFields.safeParse({
      botToken: { $secret: 'DISCORD_BOT_TOKEN' },
      guildId: 'not-a-snowflake',
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional lookbackDays and resources', () => {
    const result = configFields.safeParse({
      botToken: { $secret: 'DISCORD_BOT_TOKEN' },
      guildId: GUILD,
      lookbackDays: 14,
      resources: ['members'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lookbackDays).toBe(14);
      expect(result.data.resources).toEqual(['members']);
    }
  });

  it('rejects an empty resources array', () => {
    const result = configFields.safeParse({
      botToken: { $secret: 'DISCORD_BOT_TOKEN' },
      guildId: GUILD,
      resources: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('snowflakeToMs', () => {
  it('decodes the timestamp from a snowflake', () => {
    const ms = Date.UTC(2024, 0, 1);
    const snowflake = String(BigInt(ms - 1420070400000) << 22n);
    expect(snowflakeToMs(snowflake)).toBe(ms);
  });
});

describe('channelKindLabel', () => {
  it('maps known channel types', () => {
    expect(channelKindLabel(0)).toBe('text');
    expect(channelKindLabel(2)).toBe('voice');
    expect(channelKindLabel(4)).toBe('category');
    expect(channelKindLabel(5)).toBe('announcement');
    expect(channelKindLabel(15)).toBe('forum');
    expect(channelKindLabel(999)).toBe('other');
  });
});

describe('bucketMessagesPerDay', () => {
  it('buckets messages by UTC day and counts distinct authors', () => {
    const day = Date.UTC(2024, 5, 10);
    const windowStart = startOfUtcDay(day - 24 * 60 * 60 * 1000);
    const samples = bucketMessagesPerDay(
      [
        {
          id: 'C1',
          name: 'general',
          messages: [
            {
              id: '1',
              timestamp: new Date(day + 1000).toISOString(),
              author: { id: 'A' },
            },
            {
              id: '2',
              timestamp: new Date(day + 2000).toISOString(),
              author: { id: 'A' },
            },
            {
              id: '3',
              timestamp: new Date(day + 3000).toISOString(),
              author: { id: 'B' },
            },
          ],
        },
      ],
      windowStart,
    );
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      name: 'discord_messages_per_day',
      ts: day,
      value: 3,
      attributes: {
        channelId: 'C1',
        channelName: 'general',
        distinctAuthors: 2,
      },
    });
  });

  it('drops messages before the window start', () => {
    const day = Date.UTC(2024, 5, 10);
    const windowStart = startOfUtcDay(day);
    const samples = bucketMessagesPerDay(
      [
        {
          id: 'C1',
          name: 'general',
          messages: [
            {
              id: '1',
              timestamp: new Date(day - 5 * 24 * 60 * 60 * 1000).toISOString(),
              author: { id: 'A' },
            },
          ],
        },
      ],
      windowStart,
    );
    expect(samples).toHaveLength(0);
  });
});

function makeStorage() {
  return {
    event: vi.fn().mockResolvedValue(undefined),
    entity: vi.fn().mockResolvedValue(undefined),
    metric: vi.fn().mockResolvedValue(undefined),
    edge: vi.fn().mockResolvedValue(undefined),
    distribution: vi.fn().mockResolvedValue(undefined),
    events: vi.fn().mockResolvedValue(undefined),
    entities: vi.fn().mockResolvedValue(undefined),
    metrics: vi.fn().mockResolvedValue(undefined),
    edges: vi.fn().mockResolvedValue(undefined),
    distributions: vi.fn().mockResolvedValue(undefined),
    queryEvents: vi.fn().mockResolvedValue([]),
    getEntity: vi.fn().mockResolvedValue(null),
    queryEntities: vi.fn().mockResolvedValue([]),
    queryMetrics: vi.fn().mockResolvedValue([]),
    traverse: vi.fn().mockResolvedValue([]),
    queryDistributions: vi.fn().mockResolvedValue([]),
    deleteOlderThan: vi.fn().mockResolvedValue({ rowsDeleted: 0 }),
  };
}

const CREDS = {
  botToken: 'discord_secret' as unknown as { $secret: string },
};

interface RouteResponses {
  channels?: unknown;
  members?: unknown;
  audit?: unknown;
  messages?: unknown;
}

const EMPTY: Required<RouteResponses> = {
  channels: [],
  members: [],
  audit: { audit_log_entries: [], users: [] },
  messages: [],
};

function mockFetch(responses: RouteResponses = {}) {
  const merged = { ...EMPTY, ...responses };
  const messagesByCall: unknown[][] = Array.isArray(merged.messages)
    ? [merged.messages as unknown[], []]
    : [[]];
  let messagesCall = 0;
  const spy = vi.fn().mockImplementation((url: string | URL) => {
    const u = typeof url === 'string' ? url : url.toString();
    let body: unknown = {};
    if (/\/channels\/[^/]+\/messages/.test(u)) {
      body =
        messagesByCall[Math.min(messagesCall++, messagesByCall.length - 1)];
    } else if (u.includes('/audit-logs')) {
      body = merged.audit;
    } else if (u.includes('/members')) {
      body = merged.members;
    } else if (u.includes('/channels')) {
      body = merged.channels;
    }
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function makeConnector(settings: Record<string, unknown> = {}) {
  return new DiscordConnector({ guildId: GUILD, ...settings } as never, CREDS);
}

describe('DiscordConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes channels, members, join events, and message metrics', async () => {
    const joinedAt = '2024-01-05T00:00:00.000Z';
    mockFetch({
      channels: [
        { id: 'C1', name: 'general', type: 0, position: 0 },
        { id: 'C2', name: 'voice', type: 2, position: 1 },
      ],
      members: [
        {
          user: { id: 'U1', username: 'ada', bot: false },
          roles: ['R1'],
          joined_at: joinedAt,
        },
      ],
      messages: [
        {
          id: '1',
          timestamp: new Date().toISOString(),
          author: { id: 'U1' },
        },
      ],
    });

    const storage = makeStorage();
    const result = await makeConnector({ lookbackDays: 30 }).sync(
      { mode: 'full' },
      storage as never,
    );
    expect(result.done).toBe(true);

    const channel = storage.entity.mock.calls
      .map(
        (c) =>
          c[0] as {
            type: string;
            id: string;
            attributes: Record<string, unknown>;
          },
      )
      .find((e) => e.type === 'discord_channel' && e.id === 'C1');
    expect(channel?.attributes['kind']).toBe('text');

    const member = storage.entity.mock.calls
      .map((c) => c[0] as { type: string; attributes: Record<string, unknown> })
      .find((e) => e.type === 'discord_member');
    expect(member?.attributes['username']).toBe('ada');

    const join = storage.event.mock.calls
      .map((c) => c[0] as { name: string; attributes: Record<string, unknown> })
      .find((e) => e.attributes['action'] === 'join');
    expect(join?.attributes['userId']).toBe('U1');
    expect(new Date(joinedAt).getTime()).toBe(
      (join as unknown as { start_ts: number }).start_ts,
    );

    const metricCall = storage.metrics.mock.calls.at(-1);
    expect(metricCall?.[1]).toMatchObject({
      names: ['discord_messages_per_day'],
    });
    expect(metricCall?.[1].replaceWindow).toBeDefined();
    const samples = metricCall?.[0] as Array<{
      attributes: Record<string, unknown>;
    }>;
    expect(samples.some((s) => s.attributes['channelId'] === 'C1')).toBe(true);
  });

  it('writes kick and ban events from the audit log', async () => {
    const recent = String((BigInt(Date.now() - 1420070400000) << 22n) + 1n);
    const spy = mockFetch({
      audit: {
        audit_log_entries: [
          {
            id: recent,
            target_id: 'U9',
            user_id: 'MOD',
            action_type: 20,
            reason: 'spam',
          },
        ],
        users: [{ id: 'U9', username: 'baddie' }],
      },
    });
    const banId = String((BigInt(Date.now() - 1420070400000) << 22n) + 2n);

    const storage = makeStorage();
    await makeConnector({ resources: ['member_events'] }).sync(
      { mode: 'full' },
      storage as never,
    );

    const actions = storage.event.mock.calls.map(
      (c) =>
        (c[0] as { attributes: Record<string, unknown> }).attributes['action'],
    );
    expect(actions).toContain('kick');
    expect(spy).toHaveBeenCalled();
    expect(banId).toBeDefined();
  });

  it('only syncs the selected resources', async () => {
    mockFetch({
      channels: [{ id: 'C1', name: 'general', type: 0 }],
      members: [
        {
          user: { id: 'U1', username: 'ada' },
          joined_at: '2024-01-05T00:00:00.000Z',
        },
      ],
    });
    const storage = makeStorage();
    await makeConnector({ resources: ['channels'] }).sync(
      { mode: 'full' },
      storage as never,
    );
    const types = storage.entity.mock.calls.map(
      (c) => (c[0] as { type: string }).type,
    );
    expect(types).toContain('discord_channel');
    expect(types).not.toContain('discord_member');
    expect(storage.event).not.toHaveBeenCalled();
  });
});
