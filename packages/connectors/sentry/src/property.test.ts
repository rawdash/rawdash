import {
  type InvariantViolation,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { SentryConnector } from './sentry';

const CONNECTOR_ID = 'sentry';

function mockResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

function installFetchMock(
  routeBody: (url: string) => unknown,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn().mockImplementation((url: string | URL) => {
    const u = typeof url === 'string' ? url : url.toString();
    return Promise.resolve(mockResponse(routeBody(u)));
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function entityStoreFor(
  storage: InMemoryStorage,
): Map<string, Map<string, { type: string; id: string }>> {
  return (
    (
      storage as unknown as {
        entityStore: Map<
          string,
          Map<string, Map<string, { type: string; id: string }>>
        >;
      }
    ).entityStore.get(CONNECTOR_ID) ?? new Map()
  );
}

const idString = z.string().min(1);

const issuesSchema = z.array(
  z.object({
    id: idString,
    shortId: z.string(),
    title: z.string(),
    level: z.enum(['debug', 'info', 'warning', 'error', 'fatal']),
    status: z.enum(['resolved', 'unresolved', 'ignored']),
    firstSeen: z.iso.datetime(),
    lastSeen: z.iso.datetime(),
    count: z.number().int().nonnegative(),
    userCount: z.number().int().nonnegative(),
    project: z.object({ slug: z.string().min(1) }),
  }),
);

const releasesSchema = z.array(
  z.object({
    version: idString,
    dateCreated: z.iso.datetime(),
    dateReleased: z.iso.datetime().nullable(),
    lastEvent: z.iso.datetime().nullable(),
    projects: z.array(z.object({ slug: z.string().min(1) })),
  }),
);

describe('SentryConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('issues: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: z.infer<typeof issuesSchema>,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.map((i) => i.id)).size;
      const written = entityStoreFor(storage).get('sentry_issue')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one sentry_issue entity per unique issue id',
          location: 'issues phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      schema: issuesSchema,
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [extra],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        const connector = new SentryConnector(
          { organization: 'acme', resources: ['issues'] },
          { authToken: 'sntrys_test' as unknown as { $secret: string } },
        );
        await connector.sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('releases: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: z.infer<typeof releasesSchema>,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.map((r) => r.version)).size;
      const written = entityStoreFor(storage).get('sentry_release')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one sentry_release entity per unique version',
          location: 'releases phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      schema: releasesSchema,
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [extra],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        const connector = new SentryConnector(
          { organization: 'acme', resources: ['releases'] },
          { authToken: 'sntrys_test' as unknown as { $secret: string } },
        );
        await connector.sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });
});
