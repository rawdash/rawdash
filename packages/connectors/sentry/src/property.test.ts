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

type IssuesSample = z.infer<typeof SentryConnector.schemas.issues>;
type ReleasesSample = z.infer<typeof SentryConnector.schemas.releases>;

describe('SentryConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('issues: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: IssuesSample,
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
      connectorClass: SentryConnector,
      resource: 'issues',
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
      sample: ReleasesSample,
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
      connectorClass: SentryConnector,
      resource: 'releases',
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
