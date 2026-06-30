import {
  entityStoreFor,
  eventStoreFor,
  installFetchMock,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ResendConnector, extractDomain } from './resend';

const CONNECTOR_ID = 'resend';
const KEY = 'RESEND_API_KEY' as unknown as { $secret: string };

interface StoredEvent {
  name: string;
  start_ts: number;
  end_ts: number | null;
  attributes: Record<string, unknown>;
}

interface StoredEntity {
  type: string;
  id: string;
  attributes: Record<string, unknown>;
}

function makeConnector(resources?: string[]) {
  return new ResendConnector(
    { resources: resources as never },
    { apiKey: KEY },
  );
}

function recentIso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

function emailEvents(storage: InMemoryStorage): StoredEvent[] {
  return eventStoreFor<StoredEvent>(storage, CONNECTOR_ID).filter(
    (e) => e.name === 'resend_email',
  );
}

function domainEntities(storage: InMemoryStorage): StoredEntity[] {
  const byType = entityStoreFor<StoredEntity>(storage, CONNECTOR_ID);
  return Array.from(byType.get('resend_domain')?.values() ?? []);
}

describe('extractDomain', () => {
  it('parses a bare address', () => {
    expect(extractDomain('hello@acme.com')).toBe('acme.com');
  });

  it('parses an address with a display name and lowercases the domain', () => {
    expect(extractDomain('Acme Team <hello@Acme.COM>')).toBe('acme.com');
  });

  it('returns null when there is no address', () => {
    expect(extractDomain('not-an-address')).toBeNull();
    expect(extractDomain(null)).toBeNull();
    expect(extractDomain(undefined)).toBeNull();
  });
});

describe('ResendConnector emails', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps each sent email to an event with derived attributes', async () => {
    installFetchMock(() => ({
      object: 'list',
      has_more: false,
      data: [
        {
          id: 'e_1',
          message_id: '<m1@resend.dev>',
          from: 'Acme <hello@acme.com>',
          to: ['a@example.com', 'b@example.com'],
          cc: ['c@example.com'],
          bcc: null,
          reply_to: null,
          subject: 'Welcome',
          created_at: recentIso(1),
          last_event: 'delivered',
          scheduled_at: null,
        },
      ],
    }));

    const storage = new InMemoryStorage();
    await makeConnector(['emails']).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const events = emailEvents(storage);
    expect(events).toHaveLength(1);
    const attrs = events[0]!.attributes;
    expect(attrs.emailId).toBe('e_1');
    expect(attrs.fromDomain).toBe('acme.com');
    expect(attrs.recipientCount).toBe(2);
    expect(attrs.hasCc).toBe(true);
    expect(attrs.hasBcc).toBe(false);
    expect(attrs.lastEvent).toBe('delivered');
    expect(events[0]!.end_ts).toBeNull();
    expect(events[0]!.start_ts).toBeGreaterThan(0);
  });

  it('pages newest-first through has_more using the last id as the after cursor', async () => {
    const fetchSpy = installFetchMock((url: string) => {
      const after = new URL(url).searchParams.get('after');
      if (after === null) {
        return {
          object: 'list',
          has_more: true,
          data: [
            { id: 'p1a', from: 'x@acme.com', to: [], created_at: recentIso(1) },
            { id: 'p1b', from: 'x@acme.com', to: [], created_at: recentIso(2) },
          ],
        };
      }
      expect(after).toBe('p1b');
      return {
        object: 'list',
        has_more: false,
        data: [
          { id: 'p2a', from: 'x@acme.com', to: [], created_at: recentIso(3) },
        ],
      };
    });

    const storage = new InMemoryStorage();
    await makeConnector(['emails']).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    expect(emailEvents(storage)).toHaveLength(3);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('stops incremental paging once a page predates the since watermark', async () => {
    const fetchSpy = installFetchMock(() => ({
      object: 'list',
      has_more: true,
      data: [
        { id: 'new', from: 'x@acme.com', to: [], created_at: recentIso(1) },
        { id: 'old', from: 'x@acme.com', to: [], created_at: recentIso(20) },
      ],
    }));

    const storage = new InMemoryStorage();
    await makeConnector(['emails']).sync(
      { mode: 'latest', since: recentIso(10) },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const events = emailEvents(storage);
    expect(events).toHaveLength(1);
    expect(events[0]!.attributes.emailId).toBe('new');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('ResendConnector domains', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps each domain to an entity carrying status and capabilities', async () => {
    installFetchMock(() => ({
      object: 'list',
      has_more: false,
      data: [
        {
          id: 'd_1',
          name: 'acme.com',
          status: 'verified',
          region: 'us-east-1',
          created_at: '2026-01-01T00:00:00.000Z',
          capabilities: { sending: 'enabled', receiving: 'disabled' },
        },
      ],
    }));

    const storage = new InMemoryStorage();
    await makeConnector(['domains']).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const domains = domainEntities(storage);
    expect(domains).toHaveLength(1);
    expect(domains[0]!.id).toBe('d_1');
    expect(domains[0]!.attributes.status).toBe('verified');
    expect(domains[0]!.attributes.sending).toBe('enabled');
    expect(domains[0]!.attributes.receiving).toBe('disabled');
  });

  it('skips the emails phase when resources excludes it', async () => {
    const fetchSpy = installFetchMock((url: string) => {
      if (url.includes('/emails')) {
        throw new Error('emails endpoint should not be called');
      }
      return { object: 'list', has_more: false, data: [] };
    });

    const storage = new InMemoryStorage();
    await makeConnector(['domains']).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).not.toContain('/emails');
    }
  });
});
