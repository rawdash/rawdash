import {
  type InvariantViolation,
  type MockResponseInit,
  connectorResourceShapeViolations,
  installFetchMockAdvanced,
  runPropertySyncTest,
  entityStoreFor as sharedEntityStoreFor,
  eventStoreFor as sharedEventStoreFor,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { NetlifyConnector } from './netlify';

const CONNECTOR_ID = 'netlify';
const SITE_ID = 'site_1';

type StoredEntity = {
  type: string;
  id: string;
  attributes: Record<string, unknown>;
};

const installFetchMock = installFetchMockAdvanced;

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    NetlifyConnector.resources,
    storage,
    connectorId,
  );

function eventStoreFor(storage: InMemoryStorage): Array<{ name: string }> {
  return sharedEventStoreFor<{ name: string }>(storage, CONNECTOR_ID);
}

function entityStoreFor(
  storage: InMemoryStorage,
): Map<string, Map<string, StoredEntity>> {
  return sharedEntityStoreFor<StoredEntity>(storage, CONNECTOR_ID);
}

function lastByKey<T>(items: T[], keyFn: (item: T) => string): Map<string, T> {
  const out = new Map<string, T>();
  for (const item of items) {
    out.set(keyFn(item), item);
  }
  return out;
}

function buildConnector(): NetlifyConnector {
  return new NetlifyConnector(
    { siteIds: [SITE_ID] },
    { apiToken: 'nfp_test' as unknown as { $secret: string } },
  );
}

function safeDefaultResponse(url: string): MockResponseInit {
  if (url.match(/\/api\/v1\/sites\/[^/]+\/deploys/)) {
    return { body: [] };
  }
  if (url.includes('/api/v1/sites')) {
    return { body: [] };
  }
  return { body: [] };
}

describe('NetlifyConnector property tests', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sites: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: z.infer<typeof NetlifyConnector.schemas.sites>,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const lastById = lastByKey(sample, (s) => s.id);
      const stored = entityStoreFor(storage).get('netlify_site') ?? new Map();
      if (stored.size !== lastById.size) {
        violations.push({
          invariant: 'one netlify_site entity per unique site id',
          location: 'sites phase',
          detail: `expected ${lastById.size} entities, got ${stored.size}`,
        });
      }
      for (const [key, site] of lastById) {
        const e = stored.get(key);
        if (!e) {
          violations.push({
            invariant: 'no data loss: every unique site is stored',
            location: 'sites phase',
            detail: `missing netlify_site entity for ${key}`,
          });
          continue;
        }
        if (e.attributes.name !== site.name || e.attributes.url !== site.url) {
          violations.push({
            invariant: 'last-write-wins: stored attributes match latest copy',
            location: 'sites phase',
            detail: `site ${key} stored attrs do not match last input`,
          });
        }
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: NetlifyConnector,
      resource: 'sites',
      connectorId: CONNECTOR_ID,
      runs: 40,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock((url) => {
          if (url.includes('/api/v1/sites') && !url.includes('/deploys')) {
            return { body: sample };
          }
          return safeDefaultResponse(url);
        });
        // No siteIds restriction: sync all discovered sites.
        const connector = new NetlifyConnector(
          { resources: ['sites'] },
          { apiToken: 'nfp_test' as unknown as { $secret: string } },
        );
        await connector.sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('deploys: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: z.infer<typeof NetlifyConnector.schemas.deploys>,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const lastById = lastByKey(sample, (d) => d.id);
      const stored = entityStoreFor(storage).get('netlify_deploy') ?? new Map();
      if (stored.size !== lastById.size) {
        violations.push({
          invariant: 'one netlify_deploy entity per unique deploy id',
          location: 'deploys phase',
          detail: `expected ${lastById.size} entities, got ${stored.size}`,
        });
      }
      const events = eventStoreFor(storage).filter(
        (e) => e.name === 'netlify_deploy_event',
      );
      if (events.length !== lastById.size) {
        violations.push({
          invariant: 'one netlify_deploy_event per unique deploy id',
          location: 'deploys phase',
          detail: `expected ${lastById.size} events, got ${events.length}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: NetlifyConnector,
      resource: 'deploys',
      connectorId: CONNECTOR_ID,
      runs: 40,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock((url) => {
          if (url.match(/\/api\/v1\/sites\/[^/]+\/deploys/)) {
            return { body: sample };
          }
          return safeDefaultResponse(url);
        });
        await buildConnector().sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });
});
